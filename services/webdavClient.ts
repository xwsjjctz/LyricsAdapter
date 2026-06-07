import { logger } from './logger';
import { getDesktopAPI } from './desktopAdapter';

const WEBDAV_CONFIG_KEY = 'webdav-config';
const CDN_CACHE_KEY = 'webdav-cdn-cache';
const CDN_TTL = 30 * 60 * 1000;

export interface WebDAVConfig {
  serverUrl: string;
  username: string;
  password: string;
}

export interface WebDAVFile {
  name: string;
  path: string;
  size: number;
  lastModified: string;
  isDirectory: boolean;
}

interface CdnCacheEntry {
  url: string;
  expiry: number;
}

const AUDIO_EXTENSIONS = ['.flac', '.mp3', '.m4a', '.wav', '.ogg', '.aac'];
const INDEX_FILE_NAME = '_metadata_index.json';

class WebDAVClient {
  private config: WebDAVConfig | null = null;
  private cdnCache: Map<string, CdnCacheEntry> = new Map();

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
    const base = this.config.serverUrl.replace(/\/+$/, '');
    let cleanPath = path.startsWith('/') ? path : '/' + path;
    const baseSegment = new URL(base).pathname.replace(/\/+$/, '');
    if (baseSegment && cleanPath.startsWith(baseSegment + '/')) {
      cleanPath = cleanPath.slice(baseSegment.length);
    } else if (cleanPath === baseSegment) {
      cleanPath = '';
    }
    return `${base}${cleanPath}`;
  }

  getConfig(): WebDAVConfig | null {
    return this.config;
  }

  saveConfig(config: WebDAVConfig): void {
    this.config = config;
    localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(config));
    logger.info('[WebDAV] Config saved');
  }

  hasConfig(): boolean {
    return this.config !== null && !!this.config.serverUrl && !!this.config.username && !!this.config.password;
  }

  clearCdnCache(): void {
    this.cdnCache.clear();
    localStorage.removeItem(CDN_CACHE_KEY);
    logger.info('[WebDAV] CDN cache cleared');
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

      const propstat = resp.querySelector('propstat');
      if (!propstat) continue;

      const statusEl = propstat.querySelector('status');
      if (statusEl?.textContent?.includes('404')) continue;

      const resourcetype = propstat.querySelector('resourcetype');
      const isDirectory = !!resourcetype?.querySelector('collection');

      if (isDirectory && href === requestPath) continue;

      const sizeEl = propstat.querySelector('getcontentlength');
      const lastModEl = propstat.querySelector('getlastmodified');

      const decodedHref = decodeURIComponent(href);
      const basePath = this.config!.serverUrl.replace(/\/+$/, '');
      const filePath = decodedHref.startsWith(basePath) ? decodedHref.slice(basePath.length) : decodedHref;

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

  /**
   * List all .meta.json file paths on the server via PROPFIND.
   * Used to detect audio files that are missing a sidecar meta.json.
   * This is one extra PROPFIND request (depth 1) regardless of file count.
   */
  async listMetaJsonPaths(dirPath: string = '/'): Promise<Set<string>> {
    if (!this.hasConfig()) return new Set();
    const api = await getDesktopAPI();
    if (!api) return new Set();
    const url = this.buildUrl(dirPath);
    const result = await api.webdavPropfind(url, this.buildAuthHeader(), '1');
    if (!result.success || !result.xml) return new Set();

    const parser = new DOMParser();
    const doc = parser.parseFromString(result.xml, 'application/xml');
    const responses = doc.querySelectorAll('response');
    const paths = new Set<string>();

    for (const resp of responses) {
      const hrefEl = resp.querySelector('href');
      if (!hrefEl) continue;
      const href = hrefEl.textContent || '';
      if (!href.endsWith('.meta.json')) continue;
      const decoded = decodeURIComponent(href);
      const basePath = this.config!.serverUrl.replace(/\/+$/, '');
      const filePath = decoded.startsWith(basePath) ? decoded.slice(basePath.length) : decoded;
      paths.add(filePath);
    }

    return paths;
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

  /** Path for the single metadata index file on the server */
  getIndexPath(): string {
    return '/' + INDEX_FILE_NAME;
  }

  /**
   * Download the metadata index file containing all tracks' metadata.
   * Single-request bulk load for cold starts.
   */
  async fetchIndex(): Promise<Record<string, any> | null> {
    const text = await this.fetchTextFile(this.getIndexPath());
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.version === 1 && parsed?.entries) {
        return parsed.entries;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Upload the metadata index file (fire-and-forget friendly).
   * Contains all tracks' CachedMetadata keyed by file path.
   */
  async uploadIndex(entries: Record<string, any>): Promise<boolean> {
    const data = JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      entries,
    });
    const result = await this.uploadTextFile(this.getIndexPath(), data);
    return result.success;
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
}

export const webdavClient = new WebDAVClient();
