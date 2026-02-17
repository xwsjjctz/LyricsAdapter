import { logger } from './logger';

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

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const storedCookie = localStorage.getItem(COOKIE_STORAGE_KEY);
      const storedCheckTime = localStorage.getItem(COOKIE_CHECK_TIME_KEY);
      
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

  private saveToStorage(): void {
    try {
      localStorage.setItem(COOKIE_STORAGE_KEY, this.cookie);
      localStorage.setItem(COOKIE_CHECK_TIME_KEY, this.lastCheckTime.toString());
    } catch (error) {
      logger.error('[CookieManager] Failed to save to storage:', error);
    }
  }

  setCookie(cookie: string): void {
    this.cookie = cookie;
    this.lastCheckTime = Date.now();
    this.saveToStorage();
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

  clearCookie(): void {
    this.cookie = '';
    this.lastCheckTime = 0;
    try {
      localStorage.removeItem(COOKIE_STORAGE_KEY);
      localStorage.removeItem(COOKIE_CHECK_TIME_KEY);
    } catch (error) {
      logger.error('[CookieManager] Failed to clear storage:', error);
    }
  }

  shouldCheckCookie(): boolean {
    if (!this.cookie) return true;
    const timeSinceLastCheck = Date.now() - this.lastCheckTime;
    return timeSinceLastCheck >= COOKIE_CHECK_INTERVAL;
  }

  updateCheckTime(): void {
    this.lastCheckTime = Date.now();
    this.saveToStorage();
  }

  async validateCookie(): Promise<CookieStatus> {
    if (!this.cookie) {
      return { valid: false, message: 'Cookie not set' };
    }

    // Check if running in Electron
    const isElectron = typeof window !== 'undefined' && !!(window as any).electron;
    
    if (!isElectron) {
      // Browser environment: Skip network validation due to CORS
      // Just do basic format check
      const hasRequiredFields = this.checkRequiredCookieFields();
      if (!hasRequiredFields) {
        return { valid: false, message: 'Cookie格式不正确，缺少必要字段（如 uin, qm_keyst 等）' };
      }
      
      this.updateCheckTime();
      logger.debug('[CookieManager] Browser mode: Cookie format check passed');
      return { valid: true };
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

      this.updateCheckTime();
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
