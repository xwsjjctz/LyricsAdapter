import { useState, useCallback, useRef } from 'react';
import type { Track } from '../types';
import { webdavClient, WebDAVFile } from '../services/webdavClient';
import { logger } from '../services/logger';
import { indexedDBStorage } from '../services/indexedDBStorage';
import { getEffectiveConfig } from '../services/webdav/providerConfig';
import { metadataFolderService, Manifest } from '../services/webdav/metadataFolderService';
import { storeCoverLocally } from '../services/webdav/coverStore';
import { loadMetadataCache, migrateCachedCover, saveMetadataCache } from '../services/webdav/metadataCache';
import { createMetadataReader } from '../services/webdav/metadataReader';
import { createManifestSync } from '../services/webdav/manifestSync';
import { populateDetailsFromChunks } from '../services/webdav/chunkDetails';
import {
  buildFileListSnapshot,
  diffFileLists,
  enrichFromManifest,
  enrichTrack,
  fallbackToFilename,
  fileToPlaceholderTrack,
  isCacheValid,
  type CachedMetadata,
  type WebDAVDiffResult,
} from '../services/webdav/trackMapping';

export type { WebDAVDiffResult } from '../services/webdav/trackMapping';

interface UseWebDAVOptions {
  /** 当异步补全（封面/歌词从 chunk 拉取完成）后，把更新后的 tracks 回传上层。
   *  解决：loadWebDAVFiles 返回占位列表后，chunk 异步补的封面无法触达上层的问题。 */
  onTracksUpdated?: (tracks: Track[]) => void;
}

/**
 * Loads the WebDAV library: lists the server, diffs it against the last
 * snapshot, fills metadata from caches / the server manifest / audio headers,
 * and keeps the server-side /Metadata/ cache in sync. Parsing, cover storage
 * and manifest merging live in services/webdav; this hook owns React state
 * and the load sequence.
 */
export const useWebDAV = ({ onTracksUpdated }: UseWebDAVOptions = {}) => {
  const [webdavTracks, setWebdavTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const abortRef = useRef(false);
  /** 递增代际计数器，防止 populateDetailsFromChunks 在并发 loadWebDAVFiles 后覆盖新状态 */
  const populateGenRef = useRef(0);

  // Detect WebDAV provider strategy from server URL
  const davConfig = webdavClient.getConfig();
  const provider = getEffectiveConfig(davConfig?.serverUrl || '', davConfig?.readonly);
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const BATCH_SIZE = provider.batchSize();
  const reader = createMetadataReader(provider);
  const lazyLoadCover = useCallback(
    (file: WebDAVFile) => createMetadataReader(providerRef.current).readCover(file),
    [],
  );
  const manifestSyncRef = useRef<ReturnType<typeof createManifestSync> | null>(null);
  manifestSyncRef.current ??= createManifestSync({ getProvider: () => providerRef.current, readCover: lazyLoadCover });

  /**
   * 上传 manifest + chunks 到服务端。
   * 成功返回 true（含 readonly 跳过的情况），失败返回 false。
   * 调用方依赖返回值决定是否写入 snapshot：manifest 失败时不写 snapshot，
   * 避免 snapshot 与 manifest 不一致导致下次启动走"三方一致"快速路径却读到旧 manifest。
   */
  const persistManifestAndChunks = async (audioPathSet: Set<string>, context: string): Promise<boolean> => {
    try {
      await manifestSyncRef.current!.upload(audioPathSet);
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to upload WebDAV metadata';
      logger.error(`[useWebDAV] ${context}:`, e);
      setError(`WebDAV metadata upload failed: ${message}`);
      return false;
    }
  };

  /** Records the listing once the manifest is consistent with it. */
  const persistSnapshotAfterManifest = async (audioFiles: WebDAVFile[], audioPaths: Set<string>, context: string) => {
    if (await persistManifestAndChunks(audioPaths, context)) {
      await indexedDBStorage.setFileListSnapshot(buildFileListSnapshot(audioFiles));
    }
  };

  const fillDetailsInBackground = (tracks: Track[], manifest: Manifest, cache: Map<string, CachedMetadata>) => {
    const gen = ++populateGenRef.current;
    void populateDetailsFromChunks(tracks, manifest, cache, {
      batchSize: BATCH_SIZE,
      readCover: lazyLoadCover,
      isCurrent: () => gen === populateGenRef.current,
      onTracks: updated => {
        setWebdavTracks(updated);
        // 逐批回传：封面分批出现，视觉更友好
        onTracksUpdated?.(updated);
      },
      persist: (paths, context) => persistManifestAndChunks(paths, context),
    });
  };

  /** Parses files in provider-sized batches, reporting progress; aborts on cancel. */
  const fetchInBatches = async (
    files: WebDAVFile[],
    metadataCache: Map<string, CachedMetadata>,
    progress: { done: number; total: number },
    onBatch: (results: { file: WebDAVFile; meta: CachedMetadata }[]) => void,
  ): Promise<boolean> => {
    for (let batch = 0; batch < files.length; batch += BATCH_SIZE) {
      if (abortRef.current) return false;
      const batchItems = files.slice(batch, batch + BATCH_SIZE);
      const results = await Promise.all(batchItems.map(async file => {
        let meta: CachedMetadata;
        try {
          meta = await reader.readMetadata(file);
        } catch (err) {
          logger.error(`[useWebDAV] Failed to parse ${file.name}, falling back to filename:`, err);
          meta = fallbackToFilename(file);
        }
        metadataCache.set(file.path, meta);
        return { file, meta };
      }));
      progress.done += batchItems.length;
      setLoadProgress({ loaded: Math.min(progress.done, progress.total), total: progress.total });
      onBatch(results);
    }
    return true;
  };

  const loadFullMode = async (audioFiles: WebDAVFile[]): Promise<WebDAVDiffResult> => {
    const placeholderTracks = audioFiles.map(fileToPlaceholderTrack);
    setWebdavTracks(placeholderTracks);

    const audioPaths = new Set(audioFiles.map(f => f.path));

    // 加载服务端 manifest（含 v2→v3 迁移；只读模式不迁移，只读 v3）
    let manifest: Manifest | null = null;
    if (provider.useMetadataFolder()) {
      manifest = await metadataFolderService.loadManifest(provider.allowWrite());
      if (manifest) {
        logger.info('[useWebDAV] loadFullMode: loaded manifest with', Object.keys(manifest.entries).length, 'entries');
      }
    }

    const metadataCache = await loadMetadataCache();
    const toFetch: { file: WebDAVFile; index: number }[] = [];

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      if (!file) continue;

      // 1. 服务端 manifest 命中（指纹匹配 + duration>0 且有封面）→ 秒出列表（封面待 chunk 补全）
      const serverEntry = manifest?.entries[file.path];
      if (serverEntry && serverEntry.fileSize === file.size && serverEntry.lastModified === file.lastModified && serverEntry.duration > 0) {
        if (serverEntry.hasCover) {
          metadataCache.set(file.path, {
            title: serverEntry.title,
            artist: serverEntry.artist,
            album: serverEntry.album,
            duration: serverEntry.duration,
            fileSize: serverEntry.fileSize,
            lastModified: serverEntry.lastModified,
            chunkId: serverEntry.chunkId,
          });
          placeholderTracks[i] = enrichFromManifest(placeholderTracks[i]!, serverEntry);
          continue;
        }
        // hasCover=false：服务端明确无封面。本地已有解析结果则直接使用，避免每次冷启动重新解析；
        // 无缓存 → 重新解析（可能是历史 scan 解析失败/新文件未解析过）。
        const localEntry = metadataCache.get(file.path);
        if (localEntry && isCacheValid(localEntry, file) && localEntry.duration > 0) {
          placeholderTracks[i] = enrichTrack(placeholderTracks[i]!, localEntry);
        } else {
          toFetch.push({ file, index: i });
        }
        continue;
      }

      // 2. 本地 IndexedDB 缓存（含已补全的封面），迁移旧 data: 封面到磁盘
      const cached = metadataCache.get(file.path);
      if (cached && isCacheValid(cached, file) && cached.duration > 0) {
        const migrated = await migrateCachedCover(cached, file.path, storeCoverLocally);
        if (migrated !== cached) metadataCache.set(file.path, migrated);
        placeholderTracks[i] = enrichTrack(placeholderTracks[i]!, migrated);
      } else {
        toFetch.push({ file, index: i });
      }
    }

    // 从 IndexedDB 清理已删文件（在 manifest 中但不在 PROPFIND 结果中）
    if (manifest) {
      for (const path of Object.keys(manifest.entries)) {
        if (!audioPaths.has(path)) metadataCache.delete(path);
      }
    }

    if (toFetch.length === 0) {
      setWebdavTracks(placeholderTracks);
      setIsLoading(false);
      setLoadProgress(null);
      await saveMetadataCache(metadataCache);
      await persistSnapshotAfterManifest(audioFiles, audioPaths, 'Failed to upload Metadata/ after full cache load');
      // 后台补全封面/歌词（从 chunks 饥饿式拉取）
      if (manifest) fillDetailsInBackground(placeholderTracks, manifest, metadataCache);
      return { type: 'full', tracks: [...placeholderTracks] };
    }

    setLoadProgress({ loaded: audioFiles.length - toFetch.length, total: audioFiles.length });
    setWebdavTracks([...placeholderTracks]);

    const indexByPath = new Map(toFetch.map(({ file, index }) => [file.path, index]));
    const completed = await fetchInBatches(
      toFetch.map(({ file }) => file),
      metadataCache,
      { done: audioFiles.length - toFetch.length, total: audioFiles.length },
      results => {
        for (const { file, meta } of results) {
          const index = indexByPath.get(file.path)!;
          placeholderTracks[index] = enrichTrack(placeholderTracks[index]!, meta);
        }
        setWebdavTracks([...placeholderTracks]);
      },
    );
    if (!completed) return { type: 'error', error: 'WebDAV load cancelled' };

    await saveMetadataCache(metadataCache);
    setLoadProgress(null);
    const finalTracks = [...placeholderTracks];
    setWebdavTracks(finalTracks);
    await persistSnapshotAfterManifest(audioFiles, audioPaths, 'Failed to upload Metadata/ after full load');
    // 后台补全封面/歌词（对 manifest 命中但缺封面的曲目）
    if (manifest) fillDetailsInBackground(finalTracks, manifest, metadataCache);
    return { type: 'full', tracks: finalTracks };
  };

  /** PROPFIND, snapshot and IndexedDB all agree: build the list from cache without network reads. */
  const loadFromConsistentCache = async (audioFiles: WebDAVFile[], audioPaths: Set<string>): Promise<WebDAVDiffResult> => {
    const metaCache = await loadMetadataCache();
    const cachedTracks: Track[] = [];
    for (const file of audioFiles) {
      const cached = metaCache.get(file.path);
      // 缓存不完整 → 走 loadFullMode 重新加载 manifest + chunk
      if (!cached || cached.duration <= 0) return loadFullMode(audioFiles);
      cachedTracks.push(enrichTrack(fileToPlaceholderTrack(file), cached));
    }
    if (provider.useMetadataFolder()) {
      // manifest 模式：若服务端存在 hasCover=false 的条目（历史 scan 失败遗留），
      // 转 loadFullMode 重新解析修复——常规刷新也自愈，无需手动 scan_webdav_audio。
      const repairManifest = await metadataFolderService.loadManifest(false);
      const hasMissingCover = repairManifest && cachedTracks.some(t => {
        const entry = repairManifest.entries[t.webdavPath || ''];
        return !!entry && !entry.hasCover;
      });
      if (hasMissingCover) return loadFullMode(audioFiles);
    }
    setWebdavTracks(cachedTracks);
    setIsLoading(false);
    setLoadProgress(null);
    // 如果缓存中没有封面，触发后台补全（manifest 命中时 IndexedDB 只有纯文本）
    const needsCover = cachedTracks.some(t => !t.coverUrl || !t.coverUrl.startsWith('data:'));
    if (needsCover && provider.useMetadataFolder()) {
      const manifest = await metadataFolderService.loadManifest(false);
      if (manifest) fillDetailsInBackground(cachedTracks, manifest, metaCache);
    }
    // 即使三方一致，manifest 可能残留陈旧条目（上次清理不完整），用 filterManifestEntries 清理。
    await persistManifestAndChunks(audioPaths, 'Failed to sync Metadata/ after fast-path load');
    return { type: 'full', tracks: cachedTracks };
  };

  const loadWebDAVFiles = useCallback(async (): Promise<WebDAVDiffResult> => {
    if (!webdavClient.hasConfig()) {
      const message = 'WebDAV not configured';
      setError(message);
      return { type: 'error', error: message };
    }

    abortRef.current = false;
    setIsLoading(true);
    setError(null);

    try {
      const files = await webdavClient.listFiles('/');
      const audioFiles = files.filter(f => !f.isDirectory);

      if (audioFiles.length === 0) {
        setWebdavTracks([]);
        setIsLoading(false);
        await indexedDBStorage.setFileListSnapshot({});
        return { type: 'full', tracks: [] };
      }

      const snapshotRaw = await indexedDBStorage.getFileListSnapshot();
      // 无 snapshot（首次启动/清缓存后）→ 冷启动 loadFullMode
      if (!snapshotRaw) return await loadFullMode(audioFiles);

      const diff = diffFileLists(audioFiles, new Map(Object.entries(snapshotRaw)));
      logger.info('[useWebDAV] Diff result: added=' + diff.added.length + ' removed=' + diff.removed.length + ' changed=' + diff.changed.length + ' unchanged=' + diff.unchanged.length);

      const audioPaths = new Set(audioFiles.map(f => f.path));

      // 清理已删歌曲（即使 added/changed 为空，removed 也要处理）
      if (diff.removed.length > 0) {
        const metaCacheForCleanup = await loadMetadataCache();
        for (const path of diff.removed) metaCacheForCleanup.delete(path);
        await saveMetadataCache(metaCacheForCleanup);
        // 让服务端 manifest 也清理这些条目（孤儿 chunk 无害，不清理）
        await persistManifestAndChunks(audioPaths, 'Failed to upload Metadata/ after removing stale files');
      }

      if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
        return await loadFromConsistentCache(audioFiles, audioPaths);
      }

      const filesToFetch: WebDAVFile[] = [...diff.added, ...diff.changed];
      const metadataCache = await loadMetadataCache();
      const toFetch: WebDAVFile[] = [];
      const enrichedNewTracks: Track[] = [];

      for (const file of filesToFetch) {
        const cached = metadataCache.get(file.path);
        if (cached && isCacheValid(cached, file) && cached.duration > 0) {
          // 迁移旧 data: 封面到磁盘，换成 cover:// URL
          const migrated = await migrateCachedCover(cached, file.path, storeCoverLocally);
          if (migrated !== cached) metadataCache.set(file.path, migrated);
          enrichedNewTracks.push(enrichTrack(fileToPlaceholderTrack(file), migrated));
        } else {
          toFetch.push(file);
        }
      }

      const removedIds = diff.removed.map(path => `webdav-${path}`);
      const splitByDiff = () => ({
        added: enrichedNewTracks.filter(t => diff.added.some(f => f.path === (t.webdavPath || ''))),
        updated: enrichedNewTracks.filter(t => diff.changed.some(f => f.path === (t.webdavPath || ''))),
      });

      if (toFetch.length === 0) {
        setLoadProgress(null);
        setIsLoading(false);
        // 先写 manifest，成功后再写 snapshot（保证三层一致）
        await persistSnapshotAfterManifest(audioFiles, audioPaths, 'Failed to upload Metadata/ after cached diff load');
        return { type: 'diff', ...splitByDiff(), removed: removedIds };
      }

      setLoadProgress({ loaded: enrichedNewTracks.length, total: filesToFetch.length });
      const completed = await fetchInBatches(
        toFetch,
        metadataCache,
        { done: enrichedNewTracks.length, total: filesToFetch.length },
        results => {
          for (const { file, meta } of results) enrichedNewTracks.push(enrichTrack(fileToPlaceholderTrack(file), meta));
        },
      );
      if (!completed) return { type: 'error', error: 'WebDAV load cancelled' };

      await saveMetadataCache(metadataCache);
      await persistSnapshotAfterManifest(audioFiles, audioPaths, 'Failed to upload Metadata/ after diff load');
      setLoadProgress(null);
      setIsLoading(false);
      return { type: 'diff', ...splitByDiff(), removed: removedIds };
    } catch (e: unknown) {
      logger.error('[useWebDAV] Failed to load files:', e);
      const message = (e instanceof Error && e.message) || 'Failed to load WebDAV files';
      setError(message);
      return { type: 'error', error: message };
    } finally {
      setIsLoading(false);
    }
  }, [webdavTracks]);

  const clearWebdavCache = useCallback(async () => {
    try {
      await indexedDBStorage.initialize();
      await indexedDBStorage.clearWebdavMetadata();
      await indexedDBStorage.clearFileListSnapshot();
    } catch (e) {
      logger.warn('[useWebDAV] Failed to clear IndexedDB cache:', e);
    }
    metadataFolderService.clearCache();
    webdavClient.clearCdnCache();
    setWebdavTracks([]);
    logger.info('[useWebDAV] Cache cleared');
  }, []);

  const forceReload = useCallback(() => {
    setWebdavTracks([]);
    setIsLoading(false);
    setError(null);
    setLoadProgress(null);
  }, []);

  const cancelLoad = useCallback(() => {
    abortRef.current = true;
  }, []);

  return {
    webdavTracks,
    isLoading,
    error,
    loadProgress,
    loadWebDAVFiles,
    cancelLoad,
    clearWebdavCache,
    forceReload,
    lazyLoadCover,
  };
};
