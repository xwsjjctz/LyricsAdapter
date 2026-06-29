import { logger } from './logger';
import { getDesktopAPI } from './desktopAdapter';
import { buildWebDAVUrl, webDAVHrefToPath } from './webdavPath';

const WEBDAV_CONFIG_KEY = 'webdav-config';
const CDN_CACHE_KEY = 'webdav-cdn-cache';
const CDN_TTL = 30 * 60 * 1000;

export interface WebDAVConfig {
  serverUrl: string;
  username: string;
  password: string;
  readonly?: boolean;
}

export interface WebDAVFile {
  name: string;
  path: string;
  size: number;
  lastModified: string;
  isDirectory: boolean;
}

/** WebDAV 可写性检测结果。reason 用于 UI 文案与日志诊断。 */
export interface WritableCheckResult {
  writable: boolean;
  reason?: 'not-configured' | 'readonly-config' | 'api-unavailable' | 'write-denied';
  error?: string | undefined;
}

/**
 * 云 Track 封面缓存的磁盘 id。
 * 用 webdavPath 计算稳定 hash 前缀，避免 sanitizeTrackId 把不同路径折叠成同名
 * （如 "/a/1" 与 "/a1" 都被清洗成 "a1"）。hash 仅含 [0-9a-z]，清洗后保留。
 * 上传时立即落盘与后续扫描落盘复用同一 id，避免重复封面。
 */
export function webdavCoverId(webdavPath: string): string {
  const pathHash = Math.abs([...webdavPath].reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0)).toString(36);
  return `${pathHash}-${webdavPath}`;
}

interface CdnCacheEntry {
  url: string;
  expiry: number;
}

const AUDIO_EXTENSIONS = ['.flac', '.mp3', '.m4a', '.wav', '.ogg', '.aac'];

class WebDAVClient {
  private config: WebDAVConfig | null = null;
  private cdnCache: Map<string, CdnCacheEntry> = new Map();
  private writableCache: { signature: string; result: WritableCheckResult } | null = null;

  constructor() {
    this.loadConfig();
    this.loadCdnCache();
  }

  private loadConfig(): void {
    try {
      const saved = localStorage.getItem(WEBDAV_CONFIG_KEY);
      if (saved) {
        this.config = JSON.parse(saved);
      }
    } catch (e) {
      logger.error('[WebDAV] Failed to load config:', e);
    }
  }

  private loadCdnCache(): void {
    try {
      const saved = localStorage.getItem(CDN_CACHE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.cdnCache = new Map(Object.entries(parsed));
        const now = Date.now();
        for (const [key, entry] of this.cdnCache) {
          if (entry.expiry < now) {
            this.cdnCache.delete(key);
          }
        }
      }
    } catch (e) {
      logger.error('[WebDAV] Failed to load CDN cache:', e);
    }
  }

  private saveCdnCache(): void {
    try {
      const obj = Object.fromEntries(this.cdnCache);
      localStorage.setItem(CDN_CACHE_KEY, JSON.stringify(obj));
    } catch (e) {
      logger.error('[WebDAV] Failed to save CDN cache:', e);
    }
  }

  private buildAuthHeader(): string {
    if (!this.config) return '';
    const credentials = btoa(`${this.config.username}:${this.config.password}`);
    return `Basic ${credentials}`;
  }

  private buildUrl(path: string): string {
    if (!this.config) return '';
    return buildWebDAVUrl(this.config.serverUrl, path);
  }

  getConfig(): WebDAVConfig | null {
    return this.config;
  }

  saveConfig(config: WebDAVConfig): void {
    this.config = config;
    localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(config));
    this.writableCache = null; // 配置变更后可写性需重新检测
    logger.info('[WebDAV] Config saved');
  }

  /** 当前配置的可写性缓存签名（变更即视为不同连接）。 */
  private configSignature(): string {
    if (!this.config) return '';
    return `${this.config.serverUrl}|${this.config.username}|${this.config.readonly === true}`;
  }

  hasConfig(): boolean {
    return this.config !== null && !!this.config.serverUrl && !!this.config.username && !!this.config.password;
  }

  clearCdnCache(): void {
    this.cdnCache.clear();
    localStorage.removeItem(CDN_CACHE_KEY);
    logger.info('[WebDAV] CDN cache cleared');
  }

  clearCdnEntry(filePath: string): void {
    if (this.cdnCache.delete(filePath)) {
      this.saveCdnCache();
      logger.info('[WebDAV] CDN cache entry cleared for:', filePath);
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.hasConfig()) {
      return { success: false, message: 'WebDAV not configured' };
    }
    try {
      const api = await getDesktopAPI();
      if (!api) return { success: false, message: 'Desktop API not available' };

      const result = await api.webdavPropfind(this.config!.serverUrl, this.buildAuthHeader(), '0');
      if (result.success) {
        return { success: true, message: 'Connection successful' };
      }
      return { success: false, message: result.error || 'Connection failed' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Connection failed' };
    }
  }

  /**
   * 检测当前 WebDAV 连接是否可写。
   * - 未配置 / 用户标记 readonly → 直接判定不可写，不发请求。
   * - 其余情况：向根目录 PUT 一个隐藏探针文件再 DELETE，真实验证服务器接受写入
   *   （通用 Provider 默认 allowWrite=false 仅是安全兜底，会误判自建可写服务器，故以探针为准）。
   * 结果按配置签名缓存；saveConfig 或 force 参数可强制重测。
   */
  async checkWritable(opts?: { force?: boolean }): Promise<WritableCheckResult> {
    if (!this.hasConfig()) return { writable: false, reason: 'not-configured' };
    if (this.config!.readonly === true) return { writable: false, reason: 'readonly-config' };

    const signature = this.configSignature();
    if (!opts?.force && this.writableCache && this.writableCache.signature === signature) {
      return this.writableCache.result;
    }

    const result = await this.probeWritable();
    this.writableCache = { signature, result };
    return result;
  }

  private async probeWritable(): Promise<WritableCheckResult> {
    const api = await getDesktopAPI();
    if (!api?.webdavPut || !api.webdavDelete) {
      return { writable: false, reason: 'api-unavailable' };
    }

    const probePath = '/.lyricsadapter-writable-probe';
    const url = this.buildUrl(probePath);
    const probeData = new TextEncoder().encode('probe').buffer as ArrayBuffer;

    const putRes = await api.webdavPut(url, this.buildAuthHeader(), probeData, 'text/plain');
    if (!putRes.success) {
      return { writable: false, reason: 'write-denied', error: putRes.error };
    }

    // 清理探针文件（best-effort）；失败仅告警——扫描按音频扩展名过滤，非音频探针不进列表。
    const delRes = await api.webdavDelete(url, this.buildAuthHeader());
    if (!delRes.success) {
      logger.warn('[WebDAV] Writable probe cleanup (DELETE) failed:', delRes.error, '- stray probe may remain at', probePath);
    }
    return { writable: true };
  }

  async listFiles(dirPath: string = '/'): Promise<WebDAVFile[]> {
    if (!this.hasConfig()) return [];

    const api = await getDesktopAPI();
    if (!api) return [];

    const url = this.buildUrl(dirPath);
    const result = await api.webdavPropfind(url, this.buildAuthHeader(), '1');

    if (!result.success || !result.xml) {
      logger.error('[WebDAV] PROPFIND failed:', result.error);
      return [];
    }

    return this.parsePropfindResponse(result.xml, dirPath);
  }

  private parsePropfindResponse(xml: string, requestPath: string): WebDAVFile[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const responses = doc.querySelectorAll('response');
    const files: WebDAVFile[] = [];

    for (const resp of responses) {
      const hrefEl = resp.querySelector('href');
      if (!hrefEl) continue;

      const href = hrefEl.textContent || '';
      const name = decodeURIComponent(href.split('/').filter(Boolean).pop() || '');

      if (!name) continue;

      const propstat = [...resp.querySelectorAll('propstat')].find(item => {
        const status = item.querySelector('status')?.textContent || '';
        return /\s2\d\d\s/.test(status);
      });
      if (!propstat) continue;

      const resourcetype = propstat.querySelector('resourcetype');
      const isDirectory = !!resourcetype?.querySelector('collection');

      const filePath = webDAVHrefToPath(href, this.config!.serverUrl);
      if (isDirectory && filePath === requestPath) continue;

      const sizeEl = propstat.querySelector('getcontentlength');
      const lastModEl = propstat.querySelector('getlastmodified');

      if (!isDirectory) {
        const ext = name.toLowerCase().substring(name.lastIndexOf('.'));
        if (!AUDIO_EXTENSIONS.includes(ext)) continue;
      }

      files.push({
        name,
        path: filePath,
        size: sizeEl ? parseInt(sizeEl.textContent || '0', 10) : 0,
        lastModified: lastModEl?.textContent || '',
        isDirectory
      });
    }

    return files;
  }

  async getCdnUrl(filePath: string): Promise<string | null> {
    const cached = this.cdnCache.get(filePath);
    if (cached && cached.expiry > Date.now()) {
      logger.info('[WebDAV] CDN cache hit for:', filePath);
      return cached.url;
    }

    const api = await getDesktopAPI();
    if (!api) return null;

    const url = this.buildUrl(filePath);
    logger.info('[WebDAV] Getting CDN URL for:', url);
    const result = await api.webdavGetRedirect(url, this.buildAuthHeader());
    logger.info('[WebDAV] GET redirect result:', JSON.stringify(result));

    if (!result.success || !result.redirectUrl) {
      logger.error('[WebDAV] GET redirect failed:', result.error);
      return null;
    }

    this.cdnCache.set(filePath, {
      url: result.redirectUrl,
      expiry: Date.now() + CDN_TTL
    });
    this.saveCdnCache();

    return result.redirectUrl;
  }

  async uploadFile(filePath: string, data: ArrayBuffer, contentType: string = 'application/octet-stream'): Promise<{ success: boolean; error?: string }> {
    const api = await getDesktopAPI();
    if (!api) return { success: false, error: 'Desktop API not available' };
    const url = this.buildUrl(filePath);
    return api.webdavPut(url, this.buildAuthHeader(), data, contentType);
  }

  async uploadTextFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content).buffer as ArrayBuffer;
    return this.uploadFile(filePath, data, 'application/json; charset=utf-8');
  }

  /**
   * 确保一个集合（目录）存在：发送 MKCOL，幂等。
   * 201/2xx=新建成功，405=已存在，均视为就绪。用于上传 /Metadata/ 前保证父目录存在，
   * 否则很多 WebDAV（含 123pan）PUT 到不存在的目录会返回 409。
   * MKCOL 不被支持/失败时返回 false，调用方可继续尝试 PUT（部分服务器会自动建目录）。
   */
  async ensureCollection(folderPath: string): Promise<boolean> {
    const api = await getDesktopAPI();
    if (!api?.webdavMkcol) {
      logger.warn('[WebDAV] webdavMkcol unavailable, skip ensureCollection:', folderPath);
      return false;
    }
    const url = this.buildUrl(folderPath);
    try {
      const res = await api.webdavMkcol(url, this.buildAuthHeader());
      if (!res?.success) {
        logger.warn(`[WebDAV] MKCOL ${folderPath} → status ${res?.status ?? 'n/a'} (${res?.error ?? 'unknown'})`);
      }
      return res?.success === true;
    } catch (e) {
      logger.warn('[WebDAV] MKCOL error:', folderPath, e);
      return false;
    }
  }

  async fetchTextFile(filePath: string): Promise<string | null> {
    const api = await getDesktopAPI();
    if (!api) return null;
    // Fetch directly from the WebDAV server URL, not via CDN.
    // meta.json files are small text files (even with cover ~200KB), so CDN
    // redirect is unnecessary and often fails (cloud storage CDNs typically
    // only redirect known media types: audio/video/images).
    const url = this.buildUrl(filePath);
    // Use auth header, pass -1,-1 to omit Range header → full file download
    const result = await api.webdavGetRange(url, this.buildAuthHeader(), -1, -1);
    if (!result.success || !result.data) return null;
    const decoder = new TextDecoder();
    return decoder.decode(result.data);
  }

  getMetaJsonPath(audioPath: string): string {
    return audioPath.replace(/\.[^/.]+$/, '') + '.meta.json';
  }

  async fetchMetaJson(audioPath: string): Promise<import('../types').MetaJson | null> {
    try {
      const metaPath = this.getMetaJsonPath(audioPath);
      const text = await this.fetchTextFile(metaPath);
      if (!text) return null;
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.title === 'string') {
        return parsed as import('../types').MetaJson;
      }
      return null;
    } catch {
      return null;
    }
  }

  async uploadMetaJson(audioPath: string, meta: import('../types').MetaJson): Promise<{ success: boolean; error?: string }> {
    const metaPath = this.getMetaJsonPath(audioPath);
    return this.uploadTextFile(metaPath, JSON.stringify(meta));
  }

  async fetchFileRange(filePath: string, start: number, end: number): Promise<ArrayBuffer | null> {
    const api = await getDesktopAPI();
    if (!api) return null;

    const cdnUrl = await this.getCdnUrl(filePath);
    if (!cdnUrl) {
      logger.warn('[WebDAV] fetchFileRange: no CDN URL for', filePath);
      return null;
    }

    const result = await api.webdavGetRange(cdnUrl, '', start, end);

    if (!result.success) {
      logger.error('[WebDAV] Range fetch failed:', result.error, 'path:', filePath, 'range:', `${start}-${end}`);
      return null;
    }

    return result.data ?? null;
  }

  /**
   * 直连服务器读取文件部分数据（不走 CDN 重定向）。
   * 用于文件头读取等小范围请求，避免 CDN 重定向的额外开销。
   * 对并发受限的厂家（如 123pan）可显著减少首载请求数。
   */
  async fetchFileRangeDirect(filePath: string, start: number, end: number): Promise<ArrayBuffer | null> {
    const api = await getDesktopAPI();
    if (!api) return null;

    const url = this.buildUrl(filePath);
    const result = await api.webdavGetRange(url, this.buildAuthHeader(), start, end);

    if (!result.success) {
      logger.warn('[WebDAV] Direct range fetch failed for', filePath, 'falling back to CDN path');
      return null;
    }

    return result.data ?? null;
  }
}

export const webdavClient = new WebDAVClient();
