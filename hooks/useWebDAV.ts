import { useState, useCallback, useRef } from 'react';
import { Track, MetaJson } from '../types';
import { webdavClient, webdavCoverId, WebDAVFile } from '../services/webdavClient';
import { parseMetadataFromBuffer, parseCoverFromRange, parseVorbisComment } from '../services/metadataService';
import { logger } from '../services/logger';
import { indexedDBStorage } from '../services/indexedDBStorage';
import { getDesktopAPIAsync } from '../services/desktopAdapter';
import { getEffectiveConfig } from '../services/webdav/providerConfig';
import { metadataFolderService, Manifest, ManifestEntry, Chunk, ChunkEntry, assignChunkId, DEFAULT_CHUNK_SIZE } from '../services/webdav/metadataFolderService';

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
  /** 封面 data URL（从文件头解析得到或从 chunk 拉取） */
  coverUrl?: string;
  duration: number;
  lyrics?: string;
  syncedLyrics?: { time: number; text: string }[];
  fileSize: number;
  lastModified: string;
  /** 详情所在 chunkId（恢复时记录，增量上传时保留分配） */
  chunkId?: string;
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

interface UseWebDAVOptions {
  /** 当异步补全（封面/歌词从 chunk 拉取完成）后，把更新后的 tracks 回传上层。
   *  解决：loadWebDAVFiles 返回占位列表后，chunk 异步补的封面无法触达上层的问题。 */
  onTracksUpdated?: (tracks: Track[]) => void;
}

export const useWebDAV = ({ onTracksUpdated }: UseWebDAVOptions = {}) => {
  const [webdavTracks, setWebdavTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const abortRef = useRef(false);
  const manifestUploadQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Detect WebDAV provider strategy from server URL
  const davConfig = webdavClient.getConfig();
  const provider = getEffectiveConfig(davConfig?.serverUrl || '', davConfig?.readonly);
  const BATCH_SIZE = provider.batchSize();

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

  /** 迁移旧 data: 封面到本地磁盘，返回 cover:// URL */
  const migrateCoverToDisk = async (meta: CachedMetadata, webdavPath: string): Promise<CachedMetadata> => {
    if (!meta.coverUrl?.startsWith('data:')) return meta;
    try {
      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI?.saveCoverThumbnail) return meta;
      const mimeMatch = meta.coverUrl.match(/^data:(\w+\/\w+);base64,/);
      const base64Match = meta.coverUrl.match(/^data:\w+\/\w+;base64,(.+)$/);
      if (!mimeMatch || !base64Match) return meta;
      const result = await desktopAPI.saveCoverThumbnail({
        id: webdavCoverId(webdavPath),
        data: base64Match[1]!,
        mime: mimeMatch[1]!,
      });
      if (result?.success && result.coverUrl) {
        return { ...meta, coverUrl: result.coverUrl };
      }
    } catch (error) {
      logger.warn('[useWebDAV] Failed to migrate data: cover to disk:', error);
    }
    return meta;
  };

  /** 带重试的文件头读取（网络抖动时自动重试，最多 2 次） */
  const fetchHeaderWithRetry = async (file: WebDAVFile, offset: number, length: number): Promise<ArrayBuffer | null> => {
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const buffer = provider.useDirectHeaderRead()
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
    if (provider.autoUploadMetaJson()) {
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
    logger.info('[useWebDAV] fetch header for', file.name, '→ buffer:', buffer ? `${buffer.byteLength} bytes` : 'null', 'via', provider.useDirectHeaderRead() ? 'direct' : 'cdn');
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

    // 转 data URL 以便持久化到 IndexedDB
    if (coverUrl) {
      const dataUrl = await blobUrlToDataUrl(coverUrl);
      coverUrl = dataUrl.startsWith('data:') ? dataUrl : '';
    }

    // 将封面保存到本地磁盘，后续通过 cover:// 协议懒加载，避免 data: URL 常驻内存
    if (coverUrl && coverUrl.startsWith('data:')) {
      try {
        const desktopAPI = await getDesktopAPIAsync();
        if (desktopAPI?.saveCoverThumbnail) {
          const mimeMatch = coverUrl.match(/^data:(\w+\/\w+);base64,/);
          const base64Match = coverUrl.match(/^data:\w+\/\w+;base64,(.+)$/);
          if (mimeMatch && base64Match) {
            // Cover id 用 webdavPath 的稳定 hash 前缀，避免 sanitizeTrackId 清洗
            // 后不同路径碰撞（如 "/a/1" 与 "/a1" 都成 "a1"）。与上传流程复用同一 id。
            const result = await desktopAPI.saveCoverThumbnail({
              id: webdavCoverId(file.path),
              data: base64Match[1]!,
              mime: mimeMatch[1]!,
            });
            if (result?.success && result.coverUrl) {
              logger.info('[useWebDAV] ✓ Cover saved to disk:', result.coverUrl, 'for', file.name);
              coverUrl = result.coverUrl; // data: → cover://
            } else {
              logger.warn('[useWebDAV] saveCoverThumbnail failed:', result?.error, 'for', file.name);
            }
          } else {
            logger.warn('[useWebDAV] Cover regex did not match for', file.name, 'mime:', mimeMatch, 'base64:', !!base64Match);
          }
        } else {
          logger.warn('[useWebDAV] saveCoverThumbnail not available');
        }
      } catch (error) {
        logger.warn('[useWebDAV] Failed to save cover to disk:', error);
      }
    }

    return {
      title: parsed.title || title,
      artist: parsed.artist || artist,
      album: parsed.album || 'Unknown Album',
      duration: parsed.duration || 0,
      ...(coverUrl ? { coverUrl } : {}),
      ...(parsed.lyrics !== undefined && { lyrics: parsed.lyrics }),
      ...(parsed.syncedLyrics !== undefined && { syncedLyrics: parsed.syncedLyrics }),
      ...resultBase,
    };
  };

  /**
   * 补充封面加载（兜底）：为 IndexedDB 中缺少 coverUrl 的曲目补充封面。
   * 拉取文件头重新解析封面。
   */
  const lazyLoadCover = useCallback(async (file: WebDAVFile): Promise<string | undefined> => {
    try {
      await indexedDBStorage.initialize();
      const cached = await indexedDBStorage.getWebdavMetadata(file.path);
      if (cached?.coverUrl) return cached.coverUrl;

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
  }, [provider]);

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

  /** 从 manifest entry 丰富 track（无封面，列表展示用，秒出）。 */
  const enrichFromManifest = (track: Track, entry: ManifestEntry): Track => ({
    ...track,
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    duration: entry.duration,
    // 封面留占位（manifest 不含），待 chunk 拉取后用 enrichFromChunk 补
  });

  /** 从 chunk entry 补全封面/歌词。manifest entry 提供 chunkId 关联。 */
  const enrichFromChunk = (track: Track, chunkEntry: ChunkEntry): Track => ({
    ...track,
    coverUrl: chunkEntry.coverUrl ?? track.coverUrl,
    lyrics: chunkEntry.lyrics ?? track.lyrics,
    syncedLyrics: chunkEntry.syncedLyrics ?? track.syncedLyrics,
  });

  /**
   * 饥饿式分批从 chunks 拉取封面/歌词，补全 tracks。
   * manifest 命中但缺 coverUrl 的曲目，按 chunkId 分组，受 BATCH_SIZE 限制并发拉取。
   * 每批到齐后更新 React 状态 + IndexedDB。
   */
  const populateDetailsFromChunks = async (
    tracks: Track[],
    manifest: Manifest,
    cache: Map<string, CachedMetadata>,
  ): Promise<void> => {
    // 收集需要补详情的 (trackIndex, path, chunkId)
    const needDetails: { trackIndex: number; path: string; chunkId: string }[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const path = tracks[i]?.webdavPath;
      if (!path) continue;
      const entry = manifest.entries[path];
      if (!entry) continue;
      // 只补还有意义的（有封面/歌词的）
      if (!entry.hasCover && !entry.hasLyrics && !entry.hasSyncedLyrics) continue;
      needDetails.push({ trackIndex: i, path, chunkId: entry.chunkId });
    }
    if (needDetails.length === 0) return;

    logger.info('[useWebDAV] Populating details from chunks for', needDetails.length, 'tracks');

    // 按 chunkId 去重，逐批拉取
    const chunkIds = [...new Set(needDetails.map(d => d.chunkId))];
    for (let bi = 0; bi < chunkIds.length; bi += BATCH_SIZE) {
      const batchIds = chunkIds.slice(bi, bi + BATCH_SIZE);
      const chunkResults = await Promise.allSettled(
        batchIds.map(async (cid) => ({ cid, chunk: await metadataFolderService.loadChunk(cid) }))
      );

      // 应用本批 chunk 的详情
      let updated = false;
      for (const r of chunkResults) {
        if (r.status !== 'fulfilled' || !r.value.chunk) continue;
        const { cid, chunk } = r.value;
        for (const d of needDetails) {
          if (d.chunkId !== cid) continue;
          const rawChunkEntry = chunk.entries[d.path];
          if (!rawChunkEntry) continue;
          let chunkEntry: ChunkEntry = rawChunkEntry;
          if (chunkEntry.coverUrl?.startsWith('data:')) {
            const migrated = await migrateCoverToDisk(
              { coverUrl: chunkEntry.coverUrl } as CachedMetadata,
              d.path
            );
            if (migrated.coverUrl !== chunkEntry.coverUrl) {
              chunkEntry = { ...chunkEntry, coverUrl: migrated.coverUrl! };
            }
          }
          if (tracks[d.trackIndex]) {
            tracks[d.trackIndex] = enrichFromChunk(tracks[d.trackIndex]!, chunkEntry);
            updated = true;
          }
          // 更新 IndexedDB cache 条目
          const cached = cache.get(d.path);
          if (cached) {
            cache.set(d.path, {
              ...cached,
              ...(chunkEntry.coverUrl ? { coverUrl: chunkEntry.coverUrl } : {}),
              ...(chunkEntry.lyrics ? { lyrics: chunkEntry.lyrics } : {}),
              ...(chunkEntry.syncedLyrics ? { syncedLyrics: chunkEntry.syncedLyrics } : {}),
            });
          }
        }
      }
      if (updated) {
        setWebdavTracks([...tracks]);
        // 逐批回传：封面分批出现，视觉更友好
        onTracksUpdated?.(tracks);
      }
    }

    await saveMetadataCache(cache);
    logger.info('[useWebDAV] Detail population done');
  };

  const runQueuedManifestUpload = (task: () => Promise<void>): Promise<void> => {
    const queuedUpload = manifestUploadQueueRef.current
      .catch(() => undefined)
      .then(task);
    manifestUploadQueueRef.current = queuedUpload.catch(() => undefined);
    return queuedUpload;
  };

  /**
   * 上传服务端缓存（串行队列）：manifest + chunks。
   *
   * 语义：把 IndexedDB 中**比服务端 manifest 更新的条目**合并进服务端，
   * 服务端已有的条目（含 hasCover 标志）保留不动，避免恢复过程中 IndexedDB
   * 状态不完整（封面待补）导致 hasCover 被误清。
   *
   * - 服务端 manifest 中存在且 IndexedDB 无更新 → 保留服务端条目原样
   * - IndexedDB 有 coverUrl（新解析/已补全） → 更新该条目 + 其 chunk
   * - IndexedDB 无 coverUrl 但服务端 hasCover=true → 保留服务端（封面在 chunk，IndexedDB 待补）
   * - PROPFIND 过滤：不在 audioPathSet 的（已删）→ 从 manifest 删除
   */
  const uploadManifestAndChunks = async (audioPathSet?: Set<string>): Promise<void> => {
    const queuedAudioPathSet = audioPathSet ? new Set(audioPathSet) : undefined;

    await runQueuedManifestUpload(async () => {
      // 写入需要 allowWrite（只读模式跳过上传，但仍可读 manifest）
      if (!provider.allowWrite() || !provider.useMetadataFolder()) return;
      const allEntries = await loadMetadataCache();

      const existingManifest = await metadataFolderService.loadManifest();
      const chunkSize = existingManifest?.chunkSize ?? DEFAULT_CHUNK_SIZE;

      // 最终 manifest entries：以服务端为基线
      const manifestEntries: Record<string, ManifestEntry> = {};
      if (existingManifest) {
        for (const [path, e] of Object.entries(existingManifest.entries)) {
          if (queuedAudioPathSet && !queuedAudioPathSet.has(path)) continue; // bug 3：已删，丢弃
          manifestEntries[path] = e;
        }
      }

      // IndexedDB 中有更新（含 coverUrl）的条目覆盖基线；新条目分配 chunkId
      const affectedChunkIds = new Set<string>();
      const heavyUpdates: Record<string, { chunkId: string; entry: ChunkEntry; manifest: ManifestEntry }> = {};
      for (const [path, meta] of allEntries) {
        if (queuedAudioPathSet && !queuedAudioPathSet.has(path)) continue;
        const priorChunkId = manifestEntries[path]?.chunkId;
        const chunkId = priorChunkId ?? assignChunkId(path, existingManifest, chunkSize);
        const hasCover = !!meta.coverUrl;
        const hasLyrics = !!meta.lyrics;
        const hasSynced = !!(meta.syncedLyrics && meta.syncedLyrics.length > 0);

        manifestEntries[path] = {
          title: meta.title,
          artist: meta.artist,
          album: meta.album || 'Unknown Album',
          duration: meta.duration || 0,
          fileSize: meta.fileSize,
          fileName: path.split('/').pop() || 'audio.flac',
          lastModified: meta.lastModified,
          chunkId,
          hasCover,
          hasLyrics,
          hasSyncedLyrics: hasSynced,
        };

        // 有重量数据 → 记录为该 chunk 的更新
        if (meta.coverUrl || meta.lyrics || meta.syncedLyrics) {
          heavyUpdates[path] = {
            chunkId,
            entry: {
              ...(meta.coverUrl ? { coverUrl: meta.coverUrl } : {}),
              ...(meta.lyrics ? { lyrics: meta.lyrics } : {}),
              ...(meta.syncedLyrics ? { syncedLyrics: meta.syncedLyrics } : {}),
            },
            manifest: manifestEntries[path]!,
          };
          affectedChunkIds.add(chunkId);
        }
      }

      if (Object.keys(existingManifest?.entries ?? {}).length > 0 && affectedChunkIds.size === 0) {
        // 服务端已有数据且无更新 → 不重传
        return;
      }

      // 构建受影响 chunk：拉取现有 chunk，合并 heavyUpdates 后完整重写
      const chunksToSave: Map<string, Chunk> = new Map();
      for (const chunkId of affectedChunkIds) {
        const existingChunk = await metadataFolderService.loadChunk(chunkId);
        const mergedEntries: Record<string, ChunkEntry> = { ...(existingChunk?.entries ?? {}) };
        for (const [path, upd] of Object.entries(heavyUpdates)) {
          if (upd.chunkId === chunkId) mergedEntries[path] = upd.entry;
        }
        chunksToSave.set(chunkId, { chunkId, entries: mergedEntries });
      }

      const manifest: Manifest = {
        version: 3,
        generatedAt: new Date().toISOString(),
        chunkSize,
        entries: manifestEntries,
      };

      const ok = await metadataFolderService.saveChunksAndManifest(chunksToSave, manifest);
      if (!ok) {
        throw new Error('Failed to upload WebDAV Metadata manifest');
      }

      const coverCount = Object.values(manifestEntries).filter(e => e.hasCover).length;
      logger.info(`[useWebDAV] Metadata/ uploaded: ${Object.keys(manifestEntries).length} entries, ${chunksToSave.size} chunks (withCover=${coverCount})`);
    });
  };

  const persistManifestAndChunks = async (audioPathSet: Set<string>, context: string): Promise<void> => {
    try {
      await uploadManifestAndChunks(audioPathSet);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to upload WebDAV metadata';
      logger.error(`[useWebDAV] ${context}:`, e);
      setError(`WebDAV metadata upload failed: ${message}`);
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

      // 无 snapshot（首次启动/清缓存后）→ 冷启动 loadFullMode
      if (!snapshotRaw) {
        return await loadFullMode(audioFiles);
      }

      const snapshot = new Map(Object.entries(snapshotRaw));
      const diff = diffFileLists(audioFiles, snapshot);

      logger.info('[useWebDAV] Diff result: added=' + diff.added.length + ' removed=' + diff.removed.length + ' changed=' + diff.changed.length + ' unchanged=' + diff.unchanged.length);

      const audioPaths = new Set(audioFiles.map(f => f.path));

      // bug 3 修复：清理已删歌曲（即使 added/changed 为空，removed 也要处理）
      if (diff.removed.length > 0) {
        const metaCacheForCleanup = await loadMetadataCache();
        for (const path of diff.removed) {
          metaCacheForCleanup.delete(path);
        }
        await saveMetadataCache(metaCacheForCleanup);
        // 让服务端 manifest 也清理这些条目（孤儿 chunk 无害，不清理）
        await persistManifestAndChunks(audioPaths, 'Failed to upload Metadata/ after removing stale files');
      }

      // 三方（PROPFIND/snapshot/IndexedDB）全都对得上：从缓存构建列表，零网络请求
      if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
        const metaCache = await loadMetadataCache();
        const cachedTracks: Track[] = [];
        let allCached = true;
        for (const file of audioFiles) {
          const cached = metaCache.get(file.path);
          if (cached && cached.duration > 0) {
            cachedTracks.push(enrichTrack(fileToPlaceholderTrack(file), cached));
          } else {
            allCached = false;
            break;
          }
        }
        if (allCached) {
          setWebdavTracks(cachedTracks);
          setIsLoading(false);
          setLoadProgress(null);
          // 如果缓存中没有封面，触发后台补全（manifest 命中时 IndexedDB 只有纯文本）
          const needsCover = cachedTracks.some(t => !t.coverUrl || !t.coverUrl.startsWith('data:'));
          if (needsCover && provider.useMetadataFolder()) {
            const manifest = await metadataFolderService.loadManifest(false);
            if (manifest) populateDetailsFromChunks(cachedTracks, manifest, metaCache);
          }
          return { type: 'full', tracks: cachedTracks };
        }
        // 缓存不完整 → 走 loadFullMode 重新加载 manifest + chunk
        return await loadFullMode(audioFiles);
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
          // 迁移旧 data: 封面到磁盘，换成 cover:// URL
          const migrated = cached.coverUrl?.startsWith('data:')
            ? await migrateCoverToDisk(cached, file.path)
            : cached;
          if (migrated !== cached) metadataCache.set(file.path, migrated);
          const enriched = enrichTrack(placeholder, migrated);
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
        await persistManifestAndChunks(audioPaths, 'Failed to upload Metadata/ after cached diff load');
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
      await persistManifestAndChunks(audioPaths, 'Failed to upload Metadata/ after diff load');

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

      // 1. 服务端 manifest 命中（指纹匹配 + duration>0）→ 秒出列表（无封面）
      const serverEntry = manifest?.entries[file.path];
      if (serverEntry && serverEntry.fileSize === file.size && serverEntry.lastModified === file.lastModified && serverEntry.duration > 0) {
        // 记录到 cache（封面待 chunk 补全）
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

      // 2. 本地 IndexedDB 缓存（含已补全的封面）
      const cached = metadataCache.get(file.path);
      if (cached && isCacheValid(cached, file) && cached.duration > 0) {
        // 迁移旧 data: 封面到磁盘
        const migrated = cached.coverUrl?.startsWith('data:')
          ? await migrateCoverToDisk(cached, file.path)
          : cached;
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
      await persistManifestAndChunks(audioPaths, 'Failed to upload Metadata/ after full cache load');
      const snapshot: Record<string, { size: number; lastModified: string }> = {};
      for (const file of audioFiles) {
        snapshot[file.path] = { size: file.size, lastModified: file.lastModified };
      }
      await indexedDBStorage.setFileListSnapshot(snapshot);
      // 后台补全封面/歌词（从 chunks 饥饿式拉取）
      if (manifest) populateDetailsFromChunks(placeholderTracks, manifest, metadataCache);
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
    await persistManifestAndChunks(audioPaths, 'Failed to upload Metadata/ after full load');

    setLoadProgress(null);
    const finalTracks = [...placeholderTracks];
    setWebdavTracks(finalTracks);
    const snapshot: Record<string, { size: number; lastModified: string }> = {};
    for (const file of audioFiles) {
      snapshot[file.path] = { size: file.size, lastModified: file.lastModified };
    }
    await indexedDBStorage.setFileListSnapshot(snapshot);
    // 后台补全封面/歌词（对 manifest 命中但缺封面的曲目）
    if (manifest) populateDetailsFromChunks(finalTracks, manifest, metadataCache);
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
