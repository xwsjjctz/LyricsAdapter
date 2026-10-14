import { logger } from '../logger';
import type { WebDAVFile } from '../webdavClient';
import { materializePortableCover } from './coverStore';
import { loadMetadataCache } from './metadataCache';
import {
  assignChunkId,
  DEFAULT_CHUNK_SIZE,
  filterManifestEntries,
  manifestEntriesEqual,
  metadataFolderService,
  type Chunk,
  type ChunkEntry,
  type Manifest,
  type ManifestEntry,
} from './metadataFolderService';
import type { getEffectiveConfig } from './providerConfig';
import { metaToWebDAVFile, type CachedMetadata } from './trackMapping';

type WebDAVProvider = ReturnType<typeof getEffectiveConfig>;

interface ManifestSyncOptions {
  /** The provider strategy at upload time (the WebDAV config can change between uploads). */
  getProvider(): WebDAVProvider;
  /** Recovers a cover from the audio file when the local copy is gone. */
  readCover(file: WebDAVFile): Promise<string | undefined>;
}

const COVER_CONCURRENCY = 8;

/**
 * Fix 1：写入前把本机 cover:// 指针还原为可移植 data:。
 * /Metadata/ 切片是跨机器的可移植边界，只允许存自包含的 data: 封面，
 * 否则其他机器拿到指向本机磁盘的悬空 cover://（必然 404）。
 * 本机封面文件缺失时（清缓存/换机），回退从 webdav 音频重新解析——
 * 即"从 webdav 拉封面"，避免只告警就放弃、把封面丢出切片。
 */
async function portableCovers(
  entries: [string, CachedMetadata][],
  readCover: ManifestSyncOptions['readCover'],
): Promise<Map<string, string | undefined>> {
  const covers = new Map<string, string | undefined>();
  const withCover = entries.filter(([, meta]) => !!meta.coverUrl);
  for (let i = 0; i < withCover.length; i += COVER_CONCURRENCY) {
    await Promise.all(withCover.slice(i, i + COVER_CONCURRENCY).map(async ([path, meta]) => {
      let portable = await materializePortableCover(meta.coverUrl);
      if (!portable && meta.coverUrl?.startsWith('cover://')) {
        logger.info('[WebDAVManifest] Local cover missing, recovering from webdav audio:', path);
        const recovered = await readCover(metaToWebDAVFile(path, meta));
        if (recovered) portable = recovered;
      }
      covers.set(path, portable);
    }));
  }
  return covers;
}

/** Rewrites each affected chunk with its updates; drops entries the manifest no longer references. */
async function mergeChunks(
  affectedChunkIds: Set<string>,
  heavyUpdates: Record<string, { chunkId: string; entry: ChunkEntry }>,
  manifestEntries: Record<string, ManifestEntry>,
): Promise<Map<string, Chunk>> {
  const chunksToSave = new Map<string, Chunk>();
  for (const chunkId of affectedChunkIds) {
    const existingChunk = await metadataFolderService.loadChunk(chunkId);
    const mergedEntries: Record<string, ChunkEntry> = { ...(existingChunk?.entries ?? {}) };
    for (const [path, update] of Object.entries(heavyUpdates)) {
      if (update.chunkId !== chunkId) continue;
      // 防覆盖：本次没有可移植封面（本机缺失且重新解析也失败）时，
      // 保留切片里已有的 data: 封面，避免把好封面清空。
      const existingCover = existingChunk?.entries[path]?.coverUrl;
      mergedEntries[path] = !update.entry.coverUrl && existingCover?.startsWith('data:')
        ? { ...update.entry, coverUrl: existingCover }
        : update.entry;
    }
    // Fix 6：清理孤儿 chunk 条目——manifest 已不存在的路径一并删除，避免 chunk 无限膨胀。
    // chunk-first/manifest-last 协议保证清理安全：manifest 已不引用这些路径。
    for (const path of Object.keys(mergedEntries)) {
      if (!manifestEntries[path]) delete mergedEntries[path];
    }
    chunksToSave.set(chunkId, { chunkId, entries: mergedEntries });
  }
  return chunksToSave;
}

/**
 * Uploads the server-side metadata cache (/Metadata/ manifest + chunks) on a
 * serial queue.
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
export function createManifestSync({ getProvider, readCover }: ManifestSyncOptions) {
  let queue: Promise<void> = Promise.resolve();

  const upload = async (audioPathSet: Set<string> | undefined): Promise<void> => {
    const provider = getProvider();
    // 写入需要 allowWrite（只读模式跳过上传，但仍可读 manifest）
    if (!provider.allowWrite() || !provider.useMetadataFolder()) return;
    const allEntries = await loadMetadataCache();

    const existingManifest = await metadataFolderService.loadManifest();
    const chunkSize = existingManifest?.chunkSize ?? DEFAULT_CHUNK_SIZE;

    // 最终 manifest entries：以服务端为基线，并记录仅裁剪 manifest 的变化
    const filteredManifest = filterManifestEntries(existingManifest, audioPathSet);
    const manifestEntries: Record<string, ManifestEntry> = filteredManifest.entries;
    let manifestChanged = filteredManifest.changed;

    const inScope = [...allEntries.entries()].filter(([path]) => !audioPathSet || audioPathSet.has(path));
    const covers = await portableCovers(inScope, readCover);

    // IndexedDB 中有更新（含 coverUrl）的条目覆盖基线；新条目分配 chunkId
    const affectedChunkIds = new Set<string>();
    const heavyUpdates: Record<string, { chunkId: string; entry: ChunkEntry }> = {};
    for (const [path, meta] of inScope) {
      const existingEntry = manifestEntries[path];
      const chunkId = existingEntry?.chunkId ?? assignChunkId(path, existingManifest, chunkSize);
      const portableCover = covers.get(path);
      // hasCover：有可移植封面→true；IndexedDB 无 coverUrl 但服务端已标 hasCover=true→保留服务端值。
      // 新机器首连时 IndexedDB 尚无 coverUrl（封面待 chunk 补全/重新解析），
      // 若因此把服务端 hasCover 清成 false，会导致 manifest 误判"无封面"并触发下游反复重解析。
      const nextEntry: ManifestEntry = {
        title: meta.title,
        artist: meta.artist,
        album: meta.album || 'Unknown Album',
        duration: meta.duration || 0,
        fileSize: meta.fileSize,
        fileName: path.split('/').pop() || 'audio.flac',
        lastModified: meta.lastModified,
        chunkId,
        hasCover: portableCover ? true : (existingEntry?.hasCover ?? false),
        hasLyrics: !!meta.lyrics,
        hasSyncedLyrics: !!(meta.syncedLyrics && meta.syncedLyrics.length > 0),
      };
      if (!manifestEntriesEqual(existingEntry, nextEntry)) manifestChanged = true;
      manifestEntries[path] = nextEntry;

      // 有重量数据 → 记录为该 chunk 的更新（封面只用可移植 data:，绝不写本机 cover:// 指针）
      if (portableCover || meta.lyrics || meta.syncedLyrics) {
        heavyUpdates[path] = {
          chunkId,
          entry: {
            ...(portableCover ? { coverUrl: portableCover } : {}),
            ...(meta.lyrics ? { lyrics: meta.lyrics } : {}),
            ...(meta.syncedLyrics ? { syncedLyrics: meta.syncedLyrics } : {}),
          },
        };
        affectedChunkIds.add(chunkId);
      }
    }

    // 服务端已有数据且无更新 → 不重传
    if (Object.keys(existingManifest?.entries ?? {}).length > 0 && affectedChunkIds.size === 0 && !manifestChanged) return;

    const chunksToSave = await mergeChunks(affectedChunkIds, heavyUpdates, manifestEntries);
    const manifest: Manifest = { version: 3, generatedAt: new Date().toISOString(), chunkSize, entries: manifestEntries };
    if (!await metadataFolderService.saveChunksAndManifest(chunksToSave, manifest)) {
      throw new Error('Failed to upload WebDAV Metadata manifest');
    }
    const coverCount = Object.values(manifestEntries).filter(e => e.hasCover).length;
    logger.info(`[WebDAVManifest] Metadata/ uploaded: ${Object.keys(manifestEntries).length} entries, ${chunksToSave.size} chunks (withCover=${coverCount})`);
  };

  return {
    /** Queued after any upload in flight; rejects when the server write fails. */
    upload(audioPathSet?: Set<string>): Promise<void> {
      const paths = audioPathSet ? new Set(audioPathSet) : undefined;
      const queued = queue.catch(() => undefined).then(() => upload(paths));
      queue = queued.catch(() => undefined);
      return queued;
    },
  };
}
