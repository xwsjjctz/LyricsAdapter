/**
 * Metadata Folder Service
 *
 * 管理 WebDAV Metadata/ 文件夹中的元数据缓存。
 *
 *   Metadata/
 *     _metadata.json   — 全局索引（含全部文本元数据 + 封面 data URL）
 *
 * 设计目标：
 * - 首次加载解析完毕后，统一打包上传到单个 _metadata.json
 * - 后续加载仅需 1 个 GET 请求即可恢复全部元数据（含封面）
 * - 增删歌曲时，调用方负责合并 existingIndex 后整体覆盖写入
 *
 * 注：封面内联进 index（以 coverUrl data URL 形式），不再有独立的 _covers/ 文件夹。
 * 这是为了绕开低并发厂家（如 123云盘）的并发瓶颈——把 N 次封面请求压成 1 次索引请求。
 */

import { webdavClient } from '../webdavClient';
import { logger } from '../logger';

export interface MetadataFolderEntry {
  title: string;
  artist: string;
  album: string;
  duration: number;
  /** 封面 data URL（data:image/...;base64,...），内联进索引 */
  coverUrl?: string;
  lyrics?: string;
  syncedLyrics?: { time: number; text: string }[];
  fileSize: number;
  fileName: string;
  lastModified: string;
}

interface MetadataIndex {
  version: number;
  generatedAt: string;
  entries: Record<string, MetadataFolderEntry>;
}

class MetadataFolderService {
  private indexCache: MetadataIndex | null = null;

  get indexPath(): string {
    return '/Metadata/_metadata.json';
  }

  /**
   * 加载全局索引。缓存结果，同次会话内不重复请求。
   * 调用 clearCache() 可强制下次重新从服务器拉取。
   */
  async loadIndex(): Promise<Record<string, MetadataFolderEntry> | null> {
    if (this.indexCache) return this.indexCache.entries;

    const text = await webdavClient.fetchTextFile(this.indexPath);
    if (!text) return null;

    try {
      const parsed: MetadataIndex = JSON.parse(text);
      if (parsed?.version === 2 && parsed?.entries) {
        this.indexCache = parsed;
        return parsed.entries;
      }
      return null;
    } catch {
      logger.warn('[MetadataFolder] Failed to parse _metadata.json');
      return null;
    }
  }

  /**
   * 上传全局索引（覆盖写入）。
   * 调用方负责合并 existingIndex（避免覆盖未变化条目）后再传入完整 entries。
   */
  async saveIndex(entries: Record<string, MetadataFolderEntry>): Promise<boolean> {
    const data: MetadataIndex = {
      version: 2,
      generatedAt: new Date().toISOString(),
      entries,
    };
    this.indexCache = data;
    const json = JSON.stringify(data);
    const result = await webdavClient.uploadTextFile(this.indexPath, json);
    return result.success;
  }

  /**
   * 清空内存缓存（当远程数据可能变化时调用，如 clear_webdav_cache 后）。
   */
  clearCache(): void {
    this.indexCache = null;
  }
}

export const metadataFolderService = new MetadataFolderService();
