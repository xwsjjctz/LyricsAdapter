/**
 * Metadata Folder Service
 *
 * 管理 WebDAV Metadata/ 文件夹中的元数据缓存。
 * 结构：
 *   Metadata/
 *     _metadata.json        — 全局索引（纯文本，不含封面）
 *     _covers/
 *       <contentHash>.jpg   — 封面文件（按内容 hash 去重）
 *       <contentHash>.png
 *
 * 设计目标：
 * - 首次加载解析完毕后，统一打包上传到 Metadata/ 文件夹
 * - 后续加载仅需 1 个 GET 请求拉取 _metadata.json 即可恢复全部文本元数据
 * - 封面按 hash 存储，去重；需要时单独拉取
 * - 增删歌曲时，增量更新索引
 */

import { webdavClient } from '../webdavClient';
import { logger } from '../logger';

export interface MetadataFolderEntry {
  title: string;
  artist: string;
  album: string;
  duration: number;
  lyrics?: string;
  syncedLyrics?: { time: number; text: string }[];
  coverHash?: string;
  coverMime?: string;
  fileSize: number;
  fileName: string;
  lastModified: string;
}

interface MetadataIndex {
  version: number;
  generatedAt: string;
  entries: Record<string, MetadataFolderEntry>;
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return map[mime] || 'jpg';
}

/**
 * 从 data URL 中提取 base64 数据和 MIME 类型。
 * 格式: data:image/jpeg;base64,/9j/4AAQ...
 */
function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1]!, base64: match[2]! };
}

/**
 * 对封面数据进行简单哈希，用于去重标识。
 */
function hashCoverData(base64: string): string {
  let hash = 0;
  // 取前 8192 字节计算即可满足去重需求
  const len = Math.min(base64.length, 8192);
  for (let i = 0; i < len; i++) {
    const char = base64.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

class MetadataFolderService {
  private indexCache: MetadataIndex | null = null;

  get indexPath(): string {
    return '/Metadata/_metadata.json';
  }

  getCoverPath(hash: string, mime: string): string {
    return `/Metadata/_covers/${hash}.${extFromMime(mime)}`;
  }

  /**
   * 加载全局索引。缓存结果，同次会话内不重复请求。
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
   * 上传封面文件到 Metadata/_covers/。
   * dataUrl 格式: data:image/jpeg;base64,...
   * 返回 { hash, mime } 供索引引用。
   */
  async uploadCover(dataUrl: string): Promise<{ hash: string; mime: string } | null> {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return null;

    const hash = hashCoverData(parsed.base64);
    const mime = parsed.mime;
    const coverPath = this.getCoverPath(hash, mime);

    // 尝试用 PROPFIND 检查文件是否已存在（避免重复上传）
    const existingPaths = await webdavClient.listMetaJsonPaths('/Metadata/_covers/');
    if (existingPaths.has(coverPath)) {
      return { hash, mime };
    }

    // base64 → ArrayBuffer
    const binaryStr = atob(parsed.base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const result = await webdavClient.uploadFile(coverPath, bytes.buffer, mime);
    if (result.success) {
      logger.debug('[MetadataFolder] Uploaded cover:', coverPath);
      return { hash, mime };
    }

    logger.warn('[MetadataFolder] Failed to upload cover:', coverPath);
    return null;
  }

  /**
   * 从 Metadata/_covers/ 拉取封面，返回 data URL。
   */
  async fetchCover(hash: string, mime: string): Promise<string | null> {
    const coverPath = this.getCoverPath(hash, mime);
    const buffer = await webdavClient.fetchFileRangeDirect(coverPath, -1, -1);
    if (!buffer) return null;

    // ArrayBuffer → base64 → data URL
    const bytes = new Uint8Array(buffer);
    // Uint8Array 可能有 noUncheckedIndexedAccess 限制，用 forEach 避免
    let binary = '';
    bytes.forEach(byte => {
      binary += String.fromCharCode(byte);
    });
    const base64 = btoa(binary);
    return `data:${mime};base64,${base64}`;
  }

  /**
   * 清空内存缓存（当远程数据可能变化时调用）。
   */
  clearCache(): void {
    this.indexCache = null;
  }
}

export const metadataFolderService = new MetadataFolderService();
