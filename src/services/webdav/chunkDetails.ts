import type { Track } from '../../types';
import { logger } from '../logger';
import type { WebDAVFile } from '../webdavClient';
import { readLocalCoverAsDataUrl, storeCoverLocally } from './coverStore';
import { saveMetadataCache } from './metadataCache';
import { metadataFolderService, type ChunkEntry, type Manifest } from './metadataFolderService';
import { enrichFromChunk, trackToWebDAVFile, type CachedMetadata } from './trackMapping';

interface ChunkDetailOptions {
  batchSize: number;
  readCover(file: WebDAVFile): Promise<string | undefined>;
  /** False once a newer load has started; stale results are then dropped. */
  isCurrent(): boolean;
  /** Receives the tracks after each batch, so covers appear progressively. */
  onTracks(tracks: Track[]): void;
  /** Writes manifest corrections back to the server. */
  persist(paths: Set<string>, context: string): Promise<unknown>;
}

/**
 * Resolves a chunk's cover to a local cover://. Portable data: covers are
 * stored locally. A legacy cover:// pointer written by another machine is
 * reused when the file exists here, otherwise re-extracted from the audio.
 */
async function localChunkEntry(
  entry: ChunkEntry,
  path: string,
  track: Track | undefined,
  readCover: ChunkDetailOptions['readCover'],
): Promise<{ entry: ChunkEntry; healed: boolean }> {
  const cover = entry.coverUrl;
  if (cover?.startsWith('data:')) {
    const local = await storeCoverLocally(cover, path);
    return { entry: local === cover ? entry : { ...entry, coverUrl: local }, healed: false };
  }
  if (!cover?.startsWith('cover://')) return { entry, healed: false };
  const localDataUrl = await readLocalCoverAsDataUrl(cover);
  if (localDataUrl) {
    return { entry: { ...entry, coverUrl: await storeCoverLocally(localDataUrl, path) }, healed: false };
  }
  logger.info('[WebDAVChunks] Legacy cover pointer dangling locally, re-extracting from audio:', path);
  const reextracted = track ? await readCover(trackToWebDAVFile(track)) : undefined;
  // 重新解析也失败（音频本就无封面）→ 保留原 cover://，TrackCover 兜底显示占位符
  return reextracted ? { entry: { ...entry, coverUrl: reextracted }, healed: true } : { entry, healed: false };
}

/**
 * 饥饿式分批从 chunks 拉取封面/歌词，补全 tracks。
 * manifest 命中但缺 coverUrl 的曲目，按 chunkId 分组，受 batchSize 限制并发拉取。
 * 每批到齐后回传 tracks；结束后更新 IndexedDB，并把 manifest 修正回写服务端。
 */
export async function populateDetailsFromChunks(
  tracks: Track[],
  manifest: Manifest,
  cache: Map<string, CachedMetadata>,
  options: ChunkDetailOptions,
): Promise<void> {
  // 防御性拷贝：不直接修改传入数组（可能正在被上层使用）
  const workingTracks = [...tracks];
  const workingCache = new Map(cache);

  // 只补还有意义的（有封面/歌词的）
  const needDetails: { trackIndex: number; path: string; chunkId: string }[] = [];
  workingTracks.forEach((track, trackIndex) => {
    const path = track.webdavPath;
    const entry = path ? manifest.entries[path] : undefined;
    if (path && entry && (entry.hasCover || entry.hasLyrics || entry.hasSyncedLyrics)) {
      needDetails.push({ trackIndex, path, chunkId: entry.chunkId });
    }
  });
  if (needDetails.length === 0) return;
  logger.info('[WebDAVChunks] Populating details from chunks for', needDetails.length, 'tracks');

  // 旧版不可移植 cover:// 条目被治愈时，回写服务端切片为 data:，让缓存自愈成可移植。
  let legacyHealedCount = 0;
  const chunkIds = [...new Set(needDetails.map(d => d.chunkId))];
  for (let bi = 0; bi < chunkIds.length; bi += options.batchSize) {
    const batchIds = chunkIds.slice(bi, bi + options.batchSize);
    const chunkResults = await Promise.allSettled(
      batchIds.map(async cid => ({ cid, chunk: await metadataFolderService.loadChunk(cid) })),
    );

    let updated = false;
    for (const result of chunkResults) {
      if (result.status !== 'fulfilled' || !result.value.chunk) continue;
      const { cid, chunk } = result.value;
      for (const detail of needDetails) {
        if (detail.chunkId !== cid) continue;
        const rawEntry = chunk.entries[detail.path];
        if (!rawEntry) continue;
        const { entry, healed } = await localChunkEntry(rawEntry, detail.path, workingTracks[detail.trackIndex], options.readCover);
        if (healed) legacyHealedCount += 1;
        if (workingTracks[detail.trackIndex]) {
          workingTracks[detail.trackIndex] = enrichFromChunk(workingTracks[detail.trackIndex]!, entry);
          updated = true;
        }
        const cached = workingCache.get(detail.path);
        if (cached) {
          workingCache.set(detail.path, {
            ...cached,
            ...(entry.coverUrl ? { coverUrl: entry.coverUrl } : {}),
            ...(entry.lyrics ? { lyrics: entry.lyrics } : {}),
            ...(entry.syncedLyrics ? { syncedLyrics: entry.syncedLyrics } : {}),
          });
        }
      }
    }
    if (updated) {
      if (!options.isCurrent()) {
        logger.info('[WebDAVChunks] Skipping a stale detail update');
        return;
      }
      options.onTracks([...workingTracks]);
    }
  }

  if (!options.isCurrent()) return;
  await saveMetadataCache(workingCache);
  logger.info('[WebDAVChunks] Detail population done, legacyHealedCount=' + legacyHealedCount);

  // Fix 4：manifest 标记 hasCover=true 但 chunk 实际无封面时纠正，
  // 否则下次冷启动仍走 manifest 秒出路径，永远看不到封面（"谎言固化"）。
  const needPersistPaths = new Set<string>();
  for (const detail of needDetails) {
    const entry = manifest.entries[detail.path];
    if (entry?.hasCover && !workingCache.get(detail.path)?.coverUrl) {
      manifest.entries[detail.path] = { ...entry, hasCover: false };
      logger.info('[WebDAVChunks] Fixed hasCover false positive:', detail.path);
      needPersistPaths.add(detail.path);
    }
  }
  if (legacyHealedCount > 0) {
    for (const track of workingTracks) if (track.webdavPath) needPersistPaths.add(track.webdavPath);
  }
  if (needPersistPaths.size > 0) {
    const context = legacyHealedCount > 0
      ? 'Failed to write back healed portable covers and hasCover fixes'
      : 'Failed to write back hasCover fixes';
    logger.info(`[WebDAVChunks] Writing back manifest corrections: ${needPersistPaths.size} paths (legacyHealed=${legacyHealedCount})`);
    await options.persist(needPersistPaths, context);
  }
}
