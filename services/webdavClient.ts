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

  async fetchFileRange(filePath: string, start: number, end: number): Promise<ArrayBuffer | null> {
    const api = await getDesktopAPI();
    if (!api) return null;

    const cdnUrl = await this.getCdnUrl(filePath);
    if (!cdnUrl) return null;

    const result = await api.webdavGetRange(cdnUrl, '', start, end);

    if (!result.success) {
      logger.error('[WebDAV] Range fetch failed:', result.error);
      return null;
    }

    return result.data;
  }
}

export const webdavClient = new WebDAVClient();
