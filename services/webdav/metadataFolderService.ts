/**
 * Metadata Folder Service (v3: manifest + chunks)
 *
 * 管理 WebDAV Metadata/ 文件夹中的双层元数据缓存：
 *
 *   Metadata/
 *     _manifest.json        — 轻量校验索引（含列表展示文本，不含封面/歌词）
 *     _chunk_0001.json      — 重量详情（封面 data URL + 歌词），每块 ≤ DEFAULT_CHUNK_SIZE 首
 *     _chunk_0002.json
 *     ...
 *
 * 设计目标：
 * - 校验/增量比对只需拉轻量 manifest（几十 KB），无需下载完整详情
 * - 增量只重写受影响的 1 个 chunk + manifest，不重传整个大文件
 * - 清缓存后恢复：manifest 秒出列表（占位封面），chunk 分批补真封面
 * - 一致性：chunk-first/manifest-last，最坏情况是 manifest 漏一次更新（下次自愈），
 *   不会出现 manifest 指向损坏 chunk
 *
 * 123云盘的低并发瓶颈由分块规避：233 首只需 5 个 chunk 请求（分批并发），
 * 而非 233 个独立封面文件。
 */

import { webdavClient } from '../webdavClient';
import { logger } from '../logger';

/** 每个 chunk 最多多少首歌曲。持久化进 manifest，恢复时计数用 manifest 值。 */
export const DEFAULT_CHUNK_SIZE = 50;

export interface ManifestEntry {
  // 列表展示所需的轻量字段（无需下载 chunk 即可显示）
  title: string;
  artist: string;
  album: string;
  duration: number;
  fileSize: number;
  fileName: string;
  lastModified: string;
  /** 详情所在 chunk，如 "0001" */
  chunkId: string;
  // chunk 派生标志，避免仅为判断而拉取 chunk
  hasCover: boolean;
  hasLyrics: boolean;
  hasSyncedLyrics: boolean;
}

export interface Manifest {
  version: 3;
  generatedAt: string;
  /** 每个 chunk 的容量上限（恢复时计数用此值，不读 DEFAULT_CHUNK_SIZE） */
  chunkSize: number;
  entries: Record<string, ManifestEntry>;
}

export interface ChunkEntry {
  /** 封面 data URL（重量，按 chunk 分散存储） */
  coverUrl?: string;
  lyrics?: string;
  syncedLyrics?: { time: number; text: string }[];
}

export interface Chunk {
  /** 冗余但自描述，用于交叉校验部分写入截断 */
  chunkId: string;
  entries: Record<string, ChunkEntry>;
}

interface V2Index {
  version: 2;
  generatedAt: string;
  entries: Record<string, {
    title: string;
    artist: string;
    album: string;
    duration: number;
    coverUrl?: string;
    lyrics?: string;
    syncedLyrics?: { time: number; text: string }[];
    fileSize: number;
    fileName: string;
    lastModified: string;
  }>;
}

function padChunkId(n: number): string {
  return String(n).padStart(4, '0');
}

/**
 * 为新路径分配 chunkId。
 * - 已有路径：保留原 chunkId（原地更新）
 * - 新路径：找 chunkId 数值最大且引用数 < chunkSize 的开放 chunk，满了开下一个
 */
export function assignChunkId(
  path: string,
  manifest: Manifest | null,
  chunkSize: number,
): string {
  const existing = manifest?.entries[path];
  if (existing) return existing.chunkId;

  if (!manifest) return padChunkId(1);

  // 统计每个 chunkId 的引用数，找数值最大的
  const counts = new Map<string, number>();
  let maxNum = 0;
  for (const entry of Object.values(manifest.entries)) {
    counts.set(entry.chunkId, (counts.get(entry.chunkId) ?? 0) + 1);
    const n = parseInt(entry.chunkId, 10);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  }

  // manifest 有定义但无有效 chunkId（空或非数值）时从 1 开始
  if (maxNum === 0) return padChunkId(1);

  const maxId = padChunkId(maxNum);
  const maxCount = counts.get(maxId) ?? 0;
  if (maxCount < chunkSize) return maxId;        // 开放 chunk 还有空位
  return padChunkId(maxNum + 1);                  // 开新 chunk
}

class MetadataFolderService {
  private manifestCache: Manifest | null = null;
  private chunkCache: Map<string, Chunk> = new Map();
  private migrating = false;

  get manifestPath(): string {
    return '/Metadata/_manifest.json';
  }

  get legacyIndexPath(): string {
    return '/Metadata/_metadata.json';
  }

  chunkPath(chunkId: string): string {
    return `/Metadata/_chunk_${chunkId}.json`;
  }

  /**
   * 加载 manifest。缓存结果。
   * 顺序：① GET _manifest.json → v3 返回；
   * ② 否则（且 allowMigrate）GET _metadata.json → v2 迁移；
   * ③ 都没有 → null（冷启动）。
   *
   * allowMigrate：是否执行 v2→v3 迁移（迁移要写文件）。只读模式传 false，
   * 遇到 v2 旧文件不迁移，直接当无 manifest 处理（逐首解析存本地）。
   */
  async loadManifest(allowMigrate = true): Promise<Manifest | null> {
    if (this.manifestCache) return this.manifestCache;
    if (this.migrating) return null;

    // ① 尝试 v3 manifest
    const manifestText = await webdavClient.fetchTextFile(this.manifestPath);
    if (manifestText) {
      try {
        const parsed: Manifest = JSON.parse(manifestText);
        if (parsed?.version === 3 && parsed?.entries) {
          this.manifestCache = parsed;
          return parsed;
        }
      } catch {
        logger.warn('[MetadataFolder] Failed to parse _manifest.json');
      }
    }

    // ② 尝试 v2 单文件迁移（仅可写时，迁移要写文件）
    if (allowMigrate) {
      const migrated = await this.migrateFromV2();
      if (migrated) return migrated;
    }

    return null;
  }

  /**
   * v2→v3 一次性迁移：读旧 _metadata.json → 内存拆分 → 先写所有 chunk 再写 manifest。
   * 迁移成功后填充缓存并返回 manifest。
   */
  private async migrateFromV2(): Promise<Manifest | null> {
    this.migrating = true;
    try {
      const legacyText = await webdavClient.fetchTextFile(this.legacyIndexPath);
      if (!legacyText) return null;

      let v2: V2Index;
      try {
        v2 = JSON.parse(legacyText);
      } catch {
        return null;
      }
      if (v2?.version !== 2 || !v2.entries) return null;

      logger.info(`[MetadataFolder] Migrating v2 index (${Object.keys(v2.entries).length} entries) → v3 manifest+chunks`);

      // 按 path 排序，确保 chunk 成员确定性
      const paths = Object.keys(v2.entries).sort();

      const manifestEntries: Record<string, ManifestEntry> = {};
      // chunkId → { entries }
      const chunks: Map<string, Chunk> = new Map();
      let chunkNum = 0;
      let inChunk = 0;
      let currentChunkId = '';
      let currentChunk: Chunk | null = null;

      for (const path of paths) {
        const e = v2.entries[path];
        if (!e) continue;

        if (!currentChunk || inChunk >= DEFAULT_CHUNK_SIZE) {
          chunkNum += 1;
          inChunk = 0;
          currentChunkId = padChunkId(chunkNum);
          currentChunk = { chunkId: currentChunkId, entries: {} };
          chunks.set(currentChunkId, currentChunk);
        }

        const hasCover = !!e.coverUrl;
        const hasLyrics = !!e.lyrics;
        const hasSynced = !!e.syncedLyrics && e.syncedLyrics.length > 0;

        manifestEntries[path] = {
          title: e.title,
          artist: e.artist,
          album: e.album,
          duration: e.duration,
          fileSize: e.fileSize,
          fileName: e.fileName,
          lastModified: e.lastModified,
          chunkId: currentChunkId,
          hasCover,
          hasLyrics,
          hasSyncedLyrics: hasSynced,
        };

        // 仅当有重量数据时才写入 chunk entry（空 ChunkEntry 也允许）
        currentChunk.entries[path] = {
          ...(e.coverUrl ? { coverUrl: e.coverUrl } : {}),
          ...(e.lyrics ? { lyrics: e.lyrics } : {}),
          ...(e.syncedLyrics ? { syncedLyrics: e.syncedLyrics } : {}),
        };
        inChunk += 1;
      }

      const manifest: Manifest = {
        version: 3,
        generatedAt: new Date().toISOString(),
        chunkSize: DEFAULT_CHUNK_SIZE,
        entries: manifestEntries,
      };

      // 一致性：先写所有 chunk，全部成功才写 manifest
      const ok = await this.saveChunksAndManifest(chunks, manifest);
      if (!ok) {
        logger.warn('[MetadataFolder] v2→v3 migration write failed');
        return null;
      }

      logger.info(`[MetadataFolder] v2→v3 migration done: ${paths.length} entries, ${chunks.size} chunks`);
      return manifest;
    } catch (e) {
      logger.warn('[MetadataFolder] v2→v3 migration error:', e);
      return null;
    } finally {
      this.migrating = false;
    }
  }

  /** 覆盖写入 manifest。调用方必须已成功写入所有引用的 chunk。 */
  async saveManifest(manifest: Manifest): Promise<boolean> {
    const json = JSON.stringify(manifest);
    const result = await webdavClient.uploadTextFile(this.manifestPath, json);
    if (result.success) {
      this.manifestCache = manifest;
    }
    return result.success;
  }

  /** 加载单个 chunk。缓存结果。返回 null 表示缺失/损坏。 */
  async loadChunk(chunkId: string): Promise<Chunk | null> {
    const cached = this.chunkCache.get(chunkId);
    if (cached) return cached;

    const text = await webdavClient.fetchTextFile(this.chunkPath(chunkId));
    if (!text) return null;
    try {
      const parsed: Chunk = JSON.parse(text);
      // 交叉校验：chunkId 必须匹配（捕获部分写入截断）
      if (parsed?.chunkId !== chunkId || !parsed?.entries) return null;
      this.chunkCache.set(chunkId, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  /** 覆盖写入 chunk。更新缓存。 */
  async saveChunk(chunkId: string, chunk: Chunk): Promise<boolean> {
    const json = JSON.stringify(chunk);
    const result = await webdavClient.uploadTextFile(this.chunkPath(chunkId), json);
    if (result.success) {
      this.chunkCache.set(chunkId, chunk);
    }
    return result.success;
  }

  /**
   * 一致性协议：chunk-first/manifest-last。
   * 先逐个 PUT 所有 chunk，全部成功才 PUT manifest。任一 chunk 失败则中止、不写 manifest。
   * 最坏情况是 manifest 漏一次更新（下次扫描自愈），不会出现 manifest 指向损坏 chunk。
   * 已成功写入的孤儿 chunk 无害，下次 forceAll 回收。
   */
  async saveChunksAndManifest(chunks: Map<string, Chunk>, manifest: Manifest): Promise<boolean> {
    for (const [id, chunk] of chunks) {
      const ok = await this.saveChunk(id, chunk);
      if (!ok) {
        logger.warn(`[MetadataFolder] chunk ${id} write failed, aborting manifest write`);
        return false;
      }
    }
    const ok = await this.saveManifest(manifest);
    if (!ok) logger.warn('[MetadataFolder] manifest write failed (orphan chunks may remain)');
    return ok;
  }

  /** 清空内存缓存（clear_webdav_cache 后，或远程写入后强制下次重读）。 */
  clearCache(): void {
    this.manifestCache = null;
    this.chunkCache.clear();
  }
}

export const metadataFolderService = new MetadataFolderService();
