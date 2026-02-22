import { logger } from './logger';
import { indexedDBStorage } from './indexedDBStorage';

const COOKIE_STORAGE_KEY = 'qq_music_cookie';
const COOKIE_CHECK_TIME_KEY = 'qq_music_cookie_last_check';
const COOKIE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export interface CookieStatus {
  valid: boolean;
  message?: string;
}

class CookieManager {
  private cookie: string = '';
  private lastCheckTime: number = 0;
  private initialized: boolean = false;

  constructor() {
    this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    try {
      // Initialize IndexedDB first
      await indexedDBStorage.initialize();
      this.initialized = true;

      const storedCookie = await indexedDBStorage.getSetting(COOKIE_STORAGE_KEY);
      const storedCheckTime = await indexedDBStorage.getSetting(COOKIE_CHECK_TIME_KEY);

      if (storedCookie) {
        this.cookie = storedCookie;
        logger.debug('[CookieManager] Cookie loaded from storage');
      }

      if (storedCheckTime) {
        this.lastCheckTime = parseInt(storedCheckTime, 10);
      }
    } catch (error) {
      logger.error('[CookieManager] Failed to load from storage:', error);
    }
  }

  private async saveToStorage(): Promise<void> {
    try {
      await indexedDBStorage.setSetting(COOKIE_STORAGE_KEY, this.cookie);
      await indexedDBStorage.setSetting(COOKIE_CHECK_TIME_KEY, this.lastCheckTime.toString());
    } catch (error) {
      logger.error('[CookieManager] Failed to save to storage:', error);
    }
  }

  async setCookie(cookie: string): Promise<void> {
    this.cookie = cookie;
    this.lastCheckTime = Date.now();
    await this.saveToStorage();
    logger.debug('[CookieManager] Cookie saved');
  }

  getCookie(): string {
    return this.cookie;
  }

  parseCookie(): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!this.cookie) return cookies;

    const pairs = this.cookie.split('; ');
    for (const pair of pairs) {
      const [key, ...valueParts] = pair.split('=');
      if (key && valueParts.length > 0) {
        cookies[key] = valueParts.join('=');
      }
    }
    return cookies;
  }

  async clearCookie(): Promise<void> {
    this.cookie = '';
    this.lastCheckTime = 0;
    try {
      await indexedDBStorage.deleteSetting(COOKIE_STORAGE_KEY);
      await indexedDBStorage.deleteSetting(COOKIE_CHECK_TIME_KEY);
    } catch (error) {
      logger.error('[CookieManager] Failed to clear storage:', error);
    }
  }

  shouldCheckCookie(): boolean {
    if (!this.cookie) return true;
    const timeSinceLastCheck = Date.now() - this.lastCheckTime;
    return timeSinceLastCheck >= COOKIE_CHECK_INTERVAL;
  }

  async updateCheckTime(): Promise<void> {
    this.lastCheckTime = Date.now();
    await this.saveToStorage();
  }

  async validateCookie(): Promise<CookieStatus> {
    if (!this.cookie) {
      return { valid: false, message: 'Cookie not set' };
    }

    // Electron environment: Can make network requests
    try {
      const testResponse = await fetch(
        'https://u.y.qq.com/cgi-bin/musicu.fcg?data=' + encodeURIComponent(JSON.stringify({
          comm: {
            cv: 4747474,
            ct: 24,
            format: 'json',
            inCharset: 'utf-8',
            outCharset: 'utf-8',
            notice: 0,
            platform: 'yqq.json',
            needNewCode: 1,
            uin: '0',
            g_tk_new_20200303: 5381,
            g_tk: 5381,
          },
          req_1: {
            module: 'musicToplist.ToplistInfoServer',
            method: 'GetAll',
            param: {},
          },
        })),
        {
          headers: {
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': 'https://y.qq.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Cookie': this.cookie,
          },
          credentials: 'omit',
        }
      );

      if (!testResponse.ok) {
        return { valid: false, message: 'Network error during validation' };
      }

      const data = await testResponse.json();

      // Check if API returns error code indicating invalid cookie
      if (data.code === 500001) {
        return { valid: false, message: 'Cookie expired or invalid' };
      }

      await this.updateCheckTime();
      return { valid: true };
    } catch (error) {
      logger.error('[CookieManager] Cookie validation failed:', error);
      // In case of network error, still allow saving but warn user
      return { valid: true, message: '网络验证失败，但Cookie已保存，使用时如失败请重新设置' };
    }
  }

  private checkRequiredCookieFields(): boolean {
    // Check if cookie contains common required fields for QQ Music
    const cookieLower = this.cookie.toLowerCase();
    // At least one of these should be present
    const commonFields = ['uin', 'qm_keyst', 'p_uin', 'p_skey', 'skey'];
    return commonFields.some(field => cookieLower.includes(field));
  }

  hasCookie(): boolean {
    return !!this.cookie;
  }
}

export const cookieManager = new CookieManager();
