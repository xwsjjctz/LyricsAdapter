import { useState, useCallback, useRef } from 'react';
import { Track, MetaJson } from '../types';
import { webdavClient, WebDAVFile } from '../services/webdavClient';
import { parseMetadataFromBuffer, parseCoverFromRange, parseVorbisComment } from '../services/metadataService';
import { logger } from '../services/logger';
import { indexedDBStorage } from '../services/indexedDBStorage';
import { getEffectiveConfig } from '../services/webdav/providerConfig';
import { metadataFolderService, MetadataFolderEntry } from '../services/webdav/metadataFolderService';

const RANGE_SIZE = 1048576;

export type WebDAVDiffResult =
  | { type: 'full'; tracks: Track[] }
  | { type: 'diff'; added: Track[]; removed: string[]; updated: Track[] };

interface FileDiff {
  added: WebDAVFile[];
  removed: string[];
  changed: WebDAVFile[];
  unchanged: string[];
}

function diffFileLists(
  remoteFiles: WebDAVFile[],
  snapshot: Map<string, { size: number; lastModified: string }>
): FileDiff {
  const remotePaths = new Set(remoteFiles.map(f => f.path));
  const added: WebDAVFile[] = [];
  const removed: string[] = [];
  const changed: WebDAVFile[] = [];
  const unchanged: string[] = [];

  for (const file of remoteFiles) {
    const snap = snapshot.get(file.path);
    if (!snap) {
      added.push(file);
    } else if (snap.size !== file.size || snap.lastModified !== file.lastModified) {
      changed.push(file);
    } else {
      unchanged.push(file.path);
    }
  }

  for (const [path] of snapshot) {
    if (!remotePaths.has(path)) {
      removed.push(path);
    }
  }

  return { added, removed, changed, unchanged };
}

async function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  if (!blobUrl || !blobUrl.startsWith('blob:')) return blobUrl;
  try {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(blobUrl);
      reader.readAsDataURL(blob);
    });
  } catch {
    return blobUrl;
  }
}

interface CachedMetadata {
  title: string;
  artist: string;
  album: string;
  /** 封面 data URL（从文件头解析得到或从 Metadata/_covers/ 拉取） */
  coverUrl?: string;
  /** 封面内容 hash（用于 Metadata/_covers/ 中的文件名，仅服务端缓存用） */
  coverHash?: string;
  /** 封面 MIME 类型 */
  coverMime?: string;
  duration: number;
  lyrics?: string;
  syncedLyrics?: { time: number; text: string }[];
  fileSize: number;
  lastModified: string;
}

function isMetaJsonValid(meta: MetaJson, file: WebDAVFile): boolean {
  return meta.fileSize === file.size && meta.lastModified === file.lastModified;
}

function parseArtistTitleFromFilename(filename: string): { artist: string; title: string } {
  const name = filename.replace(/\.[^/.]+$/, '');
  const patterns = [
    /^(.+?)\s*[-–—]\s*(.+)$/,
    /^(.+?)\s*_\s*(.+)$/,
  ];
  for (const p of patterns) {
    const match = name.match(p);
    if (match) {
      return { artist: match[1]!.trim(), title: match[2]!.trim() };
    }
  }
  return { artist: 'Unknown Artist', title: name };
}

function fileToPlaceholderTrack(file: WebDAVFile): Track {
  const { artist, title } = parseArtistTitleFromFilename(file.name);
  return {
    id: `webdav-${file.path}`,
    title,
    artist,
    album: 'Unknown Album',
    duration: 0,
    coverUrl: `https://picsum.photos/seed/${encodeURIComponent(file.name)}/1000/1000`,
    audioUrl: '',
    source: 'webdav',
    webdavPath: file.path,
    fileName: file.name,
    fileSize: file.size,
  };
}

export const useWebDAV = () => {
  const [webdavTracks, setWebdavTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const abortRef = useRef(false);

  // Detect WebDAV provider strategy from server URL
  const davConfig = webdavClient.getConfig();
  const providerConfig = getEffectiveConfig(davConfig?.serverUrl || '', davConfig?.readonly);
  const BATCH_SIZE = providerConfig.batchSize;

  const loadMetadataCache = async (): Promise<Map<string, CachedMetadata>> => {
    try {
      await indexedDBStorage.initialize();
      const entries = await indexedDBStorage.getAllWebdavMetadata();
      return new Map(Object.entries(entries));
    } catch (e) {
      logger.error('[useWebDAV] Failed to load metadata cache from IndexedDB:', e);
      return new Map();
    }
  };

  const saveMetadataCache = async (cache: Map<string, CachedMetadata>) => {
    try {
      await indexedDBStorage.initialize();
      // 先清空再全量写入，确保已删除文件的条目被清理
      await indexedDBStorage.clearWebdavMetadata();
      for (const [key, value] of cache) {
        await indexedDBStorage.setWebdavMetadata(key, value);
      }
    } catch (e) {
      logger.error('[useWebDAV] Failed to save metadata cache to IndexedDB:', e);
    }
  };

  const isCacheValid = (cached: CachedMetadata, file: WebDAVFile): boolean => {
    return cached.fileSize === file.size && cached.lastModified === file.lastModified;
  };

  /**
   * 从 Metadata/_covers/ 补全 tracks 的封面。
   * 当通过服务器索引加载时（本地无缓存），track 有 coverHash 但无 coverUrl，
   * 此函数在后台拉取封面并更新 track 状态。
   */
  const populateCoversFromServer = async (
    tracks: Track[],
    cache: Map<string, CachedMetadata>
  ): Promise<void> => {
    if (!providerConfig.useMetadataFolder) return;

    const toPopulate: { trackIndex: number; path: string }[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const path = tracks[i]?.webdavPath;
      if (!path) continue;
      const entry = cache.get(path);
      if (entry?.coverHash && entry?.coverMime && !entry.coverUrl) {
        toPopulate.push({ trackIndex: i, path });
      }
    }
    if (toPopulate.length === 0) return;

    logger.info('[useWebDAV] Populating covers for', toPopulate.length, 'tracks from Metadata/_covers/');

    for (let batch = 0; batch < toPopulate.length; batch += BATCH_SIZE) {
      const batchItems = toPopulate.slice(batch, batch + BATCH_SIZE);
      let updated = false;
      await Promise.allSettled(
        batchItems.map(async ({ trackIndex, path }) => {
          const entry = cache.get(path);
          if (!entry?.coverHash || !entry?.coverMime) return;
          const dataUrl = await metadataFolderService.fetchCover(entry.coverHash, entry.coverMime);
          if (!dataUrl) return;
          entry.coverUrl = dataUrl;
          if (tracks[trackIndex]) {
            tracks[trackIndex] = { ...tracks[trackIndex]!, coverUrl: dataUrl };
            updated = true;
          }
        })
      );
      if (updated) {
        setWebdavTracks([...tracks]);
      }
    }

    await saveMetadataCache(cache);
    logger.info('[useWebDAV] Cover population done for', toPopulate.length, 'tracks');
  };

  /** 带重试的文件头读取（网络抖动时自动重试，最多 2 次） */
  const fetchHeaderWithRetry = async (file: WebDAVFile, offset: number, length: number): Promise<ArrayBuffer | null> => {
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const buffer = providerConfig.skipCdnForHeaderRead
          ? await webdavClient.fetchFileRangeDirect(file.path, offset, offset + length)
          : await webdavClient.fetchFileRange(file.path, offset, offset + length);
        if (buffer) return buffer;
      } catch (err) {
        logger.warn(`[useWebDAV] Header fetch failed for ${file.name} (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, err);
      }
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    return null;
  };

  /** 文件名降级兜底：从文件名解析 artist/title，返回 duration=0 的 CachedMetadata */
  const fallbackToFilename = (file: WebDAVFile): CachedMetadata => {
    const { artist, title } = parseArtistTitleFromFilename(file.name);
    return { artist, title, album: 'Unknown Album', duration: 0, fileSize: file.size, lastModified: file.lastModified };
  };

  /**
   * 只读阶段：解析元数据（含封面），不上传服务端缓存。
   * - 封面一并拉取（通常在首 1MB buffer 内，额外 Range 仅极少数大封面）
   * - 结果转为 data URL 便于 IndexedDB 持久化
   * - 当 skipCdnForHeaderRead=true 时直连服务器读取文件头
   */
  const fetchTextMetadata = async (file: WebDAVFile): Promise<CachedMetadata> => {
    const resultBase = { fileSize: file.size, lastModified: file.lastModified };

    // Try meta.json sidecar first (fast path)
    if (providerConfig.autoUploadMetaJson) {
      const sidecarMeta = await webdavClient.fetchMetaJson(file.path);
      if (sidecarMeta && isMetaJsonValid(sidecarMeta, file) && sidecarMeta.duration > 0) {
        logger.info('[useWebDAV] meta.json hit for', file.name, 'duration:', sidecarMeta.duration);
        return {
          title: sidecarMeta.title,
          artist: sidecarMeta.artist,
          album: sidecarMeta.album,
          duration: sidecarMeta.duration,
          ...(sidecarMeta.lyrics != null && { lyrics: sidecarMeta.lyrics }),
          ...(sidecarMeta.syncedLyrics != null && { syncedLyrics: sidecarMeta.syncedLyrics }),
          ...resultBase,
        };
      }
    }

    // Fallback: parse audio header
    const buffer = await fetchHeaderWithRetry(file, 0, RANGE_SIZE);
    logger.info('[useWebDAV] fetch header for', file.name, '→ buffer:', buffer ? `${buffer.byteLength} bytes` : 'null', 'via', providerConfig.skipCdnForHeaderRead ? 'direct' : 'cdn');
    if (!buffer) {
      logger.warn('[useWebDAV] Header fetch returned null for', file.name, '- falling back to filename');
      return fallbackToFilename(file);
    }

    const parsed = parseMetadataFromBuffer(buffer, file.name, file.size);
    logger.info('[useWebDAV] parseMetadataFromBuffer for', file.name, '→ album:', parsed.album, 'lyrics:', parsed.lyrics ? 'found' : 'none', 'vcTruncated:', !!parsed.vorbisCommentNeededRange);
    const { artist, title } = parseArtistTitleFromFilename(file.name);

    // VORBIS_COMMENT 截断：拉取完整块再解析
    if (parsed.vorbisCommentNeededRange) {
      const { offset: vcOffset, length: vcLength } = parsed.vorbisCommentNeededRange;
      logger.info('[useWebDAV] VORBIS_COMMENT truncated, fetching range:', vcOffset, '-', vcOffset + vcLength);
      const vcBuffer = await fetchHeaderWithRetry(file, vcOffset, vcLength);
      if (vcBuffer) {
        logger.info('[useWebDAV] VORBIS_COMMENT refetch got', vcBuffer.byteLength, 'bytes');
        const vcResult = parseVorbisComment(vcBuffer);
        if (vcResult.title) parsed.title = vcResult.title;
        if (vcResult.artist) parsed.artist = vcResult.artist;
        if (vcResult.album) parsed.album = vcResult.album;
        if (vcResult.lyrics) parsed.lyrics = vcResult.lyrics;
        if (vcResult.syncedLyrics) parsed.syncedLyrics = vcResult.syncedLyrics;
        logger.info('[useWebDAV] After VORBIS_COMMENT refetch:', parsed.album, parsed.lyrics ? 'lyrics found' : 'no lyrics');
      } else {
        logger.warn('[useWebDAV] VORBIS_COMMENT refetch returned null for', file.name);
      }
    }

    // 封面解析：首 1MB 已包含→直接转 data URL；被截断→额外 Range 拉取
    let coverUrl = parsed.coverUrl || '';
    if (!coverUrl && parsed.coverNeededRange) {
      const { offset: coverOffset, length: coverLength } = parsed.coverNeededRange;
      logger.info('[useWebDAV] Cover truncated, fetching range:', coverOffset, '-', coverOffset + coverLength);
      const coverBuffer = await fetchHeaderWithRetry(file, coverOffset, coverLength);
      if (coverBuffer) {
        coverUrl = parseCoverFromRange(coverBuffer, file.name, coverOffset);
      }
    }

    // 转 data URL 以便持久化到 IndexedDB，同时计算 coverHash 供 Metadata/ _covers/ 引用
    let coverHash: string | undefined;
    let coverMime: string | undefined;
    if (coverUrl) {
      const dataUrl = await blobUrlToDataUrl(coverUrl);
      if (dataUrl.startsWith('data:')) {
        coverUrl = dataUrl;
        // 从 data URL 提取 MIME 并计算 hash
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          coverMime = match[1]!;
          const b64 = match[2]!;
          let hash = 0;
          const len = Math.min(b64.length, 8192);
          for (let i = 0; i < len; i++) {
            hash = ((hash << 5) - hash) + b64.charCodeAt(i);
            hash |= 0;
          }
          coverHash = Math.abs(hash).toString(16);
        }
      } else {
        coverUrl = '';
      }
    }

    return {
      title: parsed.title || title,
      artist: parsed.artist || artist,
      album: parsed.album || 'Unknown Album',
      duration: parsed.duration || 0,
      ...(coverUrl ? { coverUrl, coverHash: coverHash!, coverMime: coverMime! } : {}),
      ...(parsed.lyrics !== undefined && { lyrics: parsed.lyrics }),
      ...(parsed.syncedLyrics !== undefined && { syncedLyrics: parsed.syncedLyrics }),
      ...resultBase,
    };
  };

  /**
   * 补充封面加载（兜底）：为 IndexedDB 中缺少 coverUrl 的曲目补充封面。
   * 按优先级：
   * 1. IndexedDB 已有 coverUrl → 直接返回
   * 2. 有 coverHash（来自 Metadata/ 文件夹）→ 从 _covers/ 拉取
   * 3. 回退：拉取文件头重新解析封面
   */
  const lazyLoadCover = useCallback(async (file: WebDAVFile): Promise<string | undefined> => {
    try {
      await indexedDBStorage.initialize();
      const cached = await indexedDBStorage.getWebdavMetadata(file.path);
      if (cached?.coverUrl) return cached.coverUrl;

      // 有 coverHash → 从 Metadata/ 文件夹拉取封面
      if (cached?.coverHash && cached?.coverMime) {
        const dataUrl = await metadataFolderService.fetchCover(cached.coverHash, cached.coverMime);
        if (dataUrl) {
          await indexedDBStorage.setWebdavMetadata(file.path, { ...cached, coverUrl: dataUrl });
          return dataUrl;
        }
      }

      // 回退：拉取文件头重新解析封面
      const buffer = await fetchHeaderWithRetry(file, 0, RANGE_SIZE);
      if (!buffer) return undefined;

      const parsed = parseMetadataFromBuffer(buffer, file.name, file.size);
      let coverUrl = parsed.coverUrl || '';

      if (!coverUrl && parsed.coverNeededRange) {
        const { offset, length } = parsed.coverNeededRange;
        const coverBuffer = await fetchHeaderWithRetry(file, offset, length);
        if (coverBuffer) coverUrl = parseCoverFromRange(coverBuffer, file.name, offset);
      }

      if (!coverUrl) return undefined;
      const dataUrl = await blobUrlToDataUrl(coverUrl);
      if (!dataUrl.startsWith('data:')) return undefined;

      await indexedDBStorage.setWebdavMetadata(file.path, { ...cached, coverUrl: dataUrl });
      return dataUrl;
    } catch (e) {
      logger.warn('[useWebDAV] lazyLoadCover failed for', file.name, e);
      return undefined;
    }
  }, [providerConfig]);

  const enrichTrack = (track: Track, meta: CachedMetadata): Track => ({
    ...track,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    duration: meta.duration,
    coverUrl: meta.coverUrl ?? track.coverUrl,
    lyrics: meta.lyrics,
    syncedLyrics: meta.syncedLyrics,
  });

  /** 上传服务端缓存（fire-and-forget）。
   *  根据厂家配置，选择上传到 Metadata/ 文件夹或根目录索引。 */
  const uploadMetadataIndex = async (): Promise<void> => {
    if (!providerConfig.autoUploadMetaJson && !providerConfig.useMetadataFolder) return;
    const allEntries = await loadMetadataCache();
    if (allEntries.size === 0) return;

    if (providerConfig.useMetadataFolder) {
      // 上传到 Metadata/ 文件夹
      const folderEntries: Record<string, MetadataFolderEntry> = {};
      const coverUploads: Promise<void>[] = [];

      for (const [path, meta] of allEntries) {
        const entry: MetadataFolderEntry = {
          title: meta.title,
          artist: meta.artist,
          album: meta.album || 'Unknown Album',
          duration: meta.duration || 0,
          fileSize: meta.fileSize,
          fileName: path.split('/').pop() || 'audio.flac',
          lastModified: meta.lastModified,
          ...(meta.lyrics !== undefined && { lyrics: meta.lyrics }),
          ...(meta.syncedLyrics !== undefined && { syncedLyrics: meta.syncedLyrics }),
        };

        // 上传封面到 _covers/ 并记录 hash
        if (meta.coverUrl) {
          coverUploads.push(
            metadataFolderService.uploadCover(meta.coverUrl).then(result => {
              if (result) {
                folderEntries[path] = {
                  ...entry,
                  coverHash: result.hash,
                  coverMime: result.mime,
                };
              } else {
                folderEntries[path] = entry;
              }
            })
          );
          // 用已 promise 占位，后续覆盖
          continue;
        }

        folderEntries[path] = entry;
      }

      // 等待封面上传完成
      await Promise.allSettled(coverUploads);

      // 上传索引
      await metadataFolderService.saveIndex(folderEntries);
      logger.info('[useWebDAV] Metadata/ folder cache uploaded:', Object.keys(folderEntries).length, 'entries');
    }

    // 旧方式：根目录 _metadata_index.json（兼容非 MetadataFolder 厂家）
    if (providerConfig.useMetadataIndex) {
      const indexData: Record<string, CachedMetadata> = {};
      for (const [path, meta] of allEntries) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { coverUrl: _cover, ...textMeta } = meta;
        indexData[path] = textMeta;
      }
      webdavClient.uploadIndex(indexData);
    }
  };

  const loadWebDAVFiles = useCallback(async (): Promise<WebDAVDiffResult> => {
    if (!webdavClient.hasConfig()) {
      setError('WebDAV not configured');
      return { type: 'full', tracks: [] };
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
      const currentTracks = webdavTracks;

      if (!snapshotRaw || currentTracks.length === 0) {
        return await loadFullMode(audioFiles);
      }

      const snapshot = new Map(Object.entries(snapshotRaw));
      const diff = diffFileLists(audioFiles, snapshot);

      logger.info('[useWebDAV] Diff result: added=' + diff.added.length + ' removed=' + diff.removed.length + ' changed=' + diff.changed.length + ' unchanged=' + diff.unchanged.length);

      // 无需逐个检查 .meta.json 文件——依赖聚合索引 _metadata_index.json
      // 仅在 loadFullMode 中尝试拉取索引，此处不做重复检查

      if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
        setIsLoading(false);
        const newSnapshot: Record<string, { size: number; lastModified: string }> = {};
        for (const file of audioFiles) {
          newSnapshot[file.path] = { size: file.size, lastModified: file.lastModified };
        }
        await indexedDBStorage.setFileListSnapshot(newSnapshot);
        return { type: 'diff', added: [], removed: [], updated: [] };
      }

      const filesToFetch: WebDAVFile[] = [...diff.added, ...diff.changed];
      const newPlaceholderMap = new Map<string, Track>();
      for (const file of filesToFetch) {
        newPlaceholderMap.set(file.path, fileToPlaceholderTrack(file));
      }

      const metadataCache = await loadMetadataCache();
      const toFetch: WebDAVFile[] = [];
      const enrichedNewTracks: Track[] = [];

      for (const file of filesToFetch) {
        const cached = metadataCache.get(file.path);
        const placeholder = newPlaceholderMap.get(file.path)!;
        if (cached && isCacheValid(cached, file) && cached.duration > 0) {
          const enriched = enrichTrack(placeholder, cached);
          enrichedNewTracks.push(enriched);
        } else {
          toFetch.push(file);
        }
      }

      const removedIds = diff.removed.map(path => `webdav-${path}`);

      if (toFetch.length === 0) {
        setLoadProgress(null);
        setIsLoading(false);
        const updatedTracks = enrichedNewTracks.filter(t =>
          diff.changed.some(f => f.path === (t.webdavPath || ''))
        );
        const addedTracks = enrichedNewTracks.filter(t => diff.added.some(f => f.path === (t.webdavPath || '')));
        const newSnapshot: Record<string, { size: number; lastModified: string }> = {};
        for (const file of audioFiles) {
          newSnapshot[file.path] = { size: file.size, lastModified: file.lastModified };
        }
        await indexedDBStorage.setFileListSnapshot(newSnapshot);
        uploadMetadataIndex(); // fire-and-forget
        return { type: 'diff', added: addedTracks, removed: removedIds, updated: updatedTracks };
      }

      setLoadProgress({ loaded: enrichedNewTracks.length, total: filesToFetch.length });

      let fetched = enrichedNewTracks.length;

      for (let batch = 0; batch < toFetch.length; batch += BATCH_SIZE) {
        if (abortRef.current) return { type: 'full', tracks: [] };

        const batchItems = toFetch.slice(batch, batch + BATCH_SIZE);
        const results = await Promise.allSettled(
          batchItems.map(async (file) => {
            try {
              const meta = await fetchTextMetadata(file);
              metadataCache.set(file.path, meta);
              return { file, meta };
            } catch (err) {
              logger.error(`[useWebDAV] Failed to parse ${file.name}, falling back to filename:`, err);
              const fallback = fallbackToFilename(file);
              metadataCache.set(file.path, fallback);
              return { file, meta: fallback };
            }
          })
        );

        fetched += batchItems.length;
        setLoadProgress({ loaded: Math.min(fetched, filesToFetch.length), total: filesToFetch.length });

        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { file, meta } = result.value;
            const placeholder = newPlaceholderMap.get(file.path)!;
            const enriched = enrichTrack(placeholder, meta);
            enrichedNewTracks.push(enriched);
          }
        }
      }

      await saveMetadataCache(metadataCache);
      uploadMetadataIndex(); // fire-and-forget

      const newSnapshot: Record<string, { size: number; lastModified: string }> = {};
      for (const file of audioFiles) {
        newSnapshot[file.path] = { size: file.size, lastModified: file.lastModified };
      }
      await indexedDBStorage.setFileListSnapshot(newSnapshot);

      setLoadProgress(null);
      setIsLoading(false);

      const updatedTracks = enrichedNewTracks.filter(t =>
        diff.changed.some(f => f.path === (t.webdavPath || ''))
      );
      const addedTracks = enrichedNewTracks.filter(t => diff.added.some(f => f.path === (t.webdavPath || '')));
      return { type: 'diff', added: addedTracks, removed: removedIds, updated: updatedTracks };
    } catch (e: any) {
      logger.error('[useWebDAV] Failed to load files:', e);
      setError(e.message || 'Failed to load WebDAV files');
      return { type: 'full', tracks: [] };
    } finally {
      setIsLoading(false);
    }
  }, [webdavTracks]);

  const loadFullMode = async (audioFiles: WebDAVFile[]): Promise<WebDAVDiffResult> => {
    const placeholderTracks = audioFiles.map(fileToPlaceholderTrack);
    setWebdavTracks(placeholderTracks);

    // 加载服务端缓存，作为比对基准
    let metadataFolderEntries: Record<string, MetadataFolderEntry> | null = null;
    if (providerConfig.useMetadataFolder) {
      metadataFolderEntries = await metadataFolderService.loadIndex();
      if (metadataFolderEntries) {
        logger.info('[useWebDAV] loadFullMode: loaded Metadata/ folder index with', Object.keys(metadataFolderEntries).length, 'entries');
      }
    }
    const indexEntries = !metadataFolderEntries && providerConfig.useMetadataIndex ? await webdavClient.fetchIndex() : null;

    // 计算被删除的文件（在 index 中但不在 PROPFIND 结果中）
    const audioPaths = new Set(audioFiles.map(f => f.path));
    const removedFromIndex: string[] = [];
    if (metadataFolderEntries) {
      for (const path of Object.keys(metadataFolderEntries)) {
        if (!audioPaths.has(path)) {
          removedFromIndex.push(path);
        }
      }
      if (removedFromIndex.length > 0) {
        logger.info('[useWebDAV] loadFullMode:', removedFromIndex.length, 'files removed from server, will clean up index');
      }
    }

    const metadataCache = await loadMetadataCache();
    const toFetch: { file: WebDAVFile; index: number }[] = [];

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      if (!file) continue;

      // 1. 服务端缓存（1 请求恢复全部）
      const serverEntry = metadataFolderEntries?.[file.path] ?? indexEntries?.[file.path];
      if (serverEntry && serverEntry.fileSize === file.size && serverEntry.lastModified === file.lastModified && serverEntry.duration > 0) {
        metadataCache.set(file.path, serverEntry);
        placeholderTracks[i] = enrichTrack(placeholderTracks[i]!, serverEntry);
        continue;
      }

      // 2. 本地 IndexedDB 缓存
      const cached = metadataCache.get(file.path);
      if (cached && isCacheValid(cached, file) && cached.duration > 0) {
        placeholderTracks[i] = enrichTrack(placeholderTracks[i]!, cached);
      } else {
        toFetch.push({ file, index: i });
      }
    }

    // 从 IndexedDB 中清理已删除文件的条目
    for (const path of removedFromIndex) {
      metadataCache.delete(path);
    }

    if (toFetch.length === 0) {
      setWebdavTracks(placeholderTracks);
      setIsLoading(false);
      setLoadProgress(null);
      await saveMetadataCache(metadataCache);
      uploadMetadataIndex();
      populateCoversFromServer(placeholderTracks, metadataCache);
      return { type: 'full', tracks: [...placeholderTracks] };
    }

    setLoadProgress({ loaded: audioFiles.length - toFetch.length, total: audioFiles.length });
    setWebdavTracks([...placeholderTracks]);

    let fetched = audioFiles.length - toFetch.length;

    for (let batch = 0; batch < toFetch.length; batch += BATCH_SIZE) {
      if (abortRef.current) return { type: 'full', tracks: [] };

      const batchItems = toFetch.slice(batch, batch + BATCH_SIZE);
      const results = await Promise.allSettled(
        batchItems.map(async ({ file, index }) => {
          try {
            const meta = await fetchTextMetadata(file);
            metadataCache.set(file.path, meta);
            return { index, meta };
          } catch (err) {
            logger.error(`[useWebDAV] Failed to parse ${file.name}, falling back to filename:`, err);
            const fallback = fallbackToFilename(file);
            metadataCache.set(file.path, fallback);
            return { index, meta: fallback };
          }
        })
      );

      fetched += batchItems.length;
      setLoadProgress({ loaded: Math.min(fetched, audioFiles.length), total: audioFiles.length });

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { index, meta } = result.value;
          placeholderTracks[index] = enrichTrack(placeholderTracks[index]!, meta);
        }
      }

      setWebdavTracks([...placeholderTracks]);
    }

    await saveMetadataCache(metadataCache);
    uploadMetadataIndex(); // fire-and-forget，包含已删除文件的清理

    setLoadProgress(null);
    const finalTracks = [...placeholderTracks];
    setWebdavTracks(finalTracks);
    // 后台补充封面（从 Metadata/_covers/ 拉取）
    populateCoversFromServer(finalTracks, metadataCache);
    return { type: 'full', tracks: finalTracks };
  };

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
