import { logger } from './logger';
import { indexedDBStorage } from './indexedDBStorage';
import { appStorage } from './appStorage';
import { getDesktopAPI, getDesktopAPIAsync } from './desktopAdapter';

const COOKIE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export interface CookieStatus {
  valid: boolean;
  message?: string;
}

/** Per-source cookie validation strategy. */
export type CookieValidator = (cookie: string) => Promise<CookieStatus>;

interface CookieStoreOptions {
  storageKey: string;
  checkTimeKey: string;
  /** Log/label scope, e.g. 'QQMusic' / 'NetEase'. */
  scope: string;
  validate: CookieValidator;
}

/**
 * Generic persistent cookie store for an online music source.
 * The QQ Music store keeps the original `cookieManager` export name so all
 * existing callers are unchanged; NetEase gets a parallel store.
 */
export class CookieStore {
  private cookie: string = '';
  private lastCheckTime: number = 0;
  private initPromise: Promise<void>;

  constructor(private readonly opts: CookieStoreOptions) {
    this.initPromise = this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    try {
      // 凭据存到 ~/.la/settings.json（safeStorage 加密），与 IndexedDB 缓存解耦：
      // 即使 IndexedDB 损坏被清，登录态也保留。appStorage.getItem 同步读，
      // 这里 await init 仅为确保主进程数据已载入内存 cache。
      await appStorage.init();

      let storedCookie = appStorage.getItem(this.opts.storageKey);
      let storedCheckTime = appStorage.getItem(this.opts.checkTimeKey);

      // 一次性迁移：旧版本把 cookie 存在 IndexedDB settings store 里。
      // 若 appStorage 里没有但 IndexedDB 里有，搬过来并清掉旧位置。
      if (!storedCookie) {
        try {
          await indexedDBStorage.initialize();
          const idbCookie = await indexedDBStorage.getSetting(this.opts.storageKey);
          const idbCheckTime = await indexedDBStorage.getSetting(this.opts.checkTimeKey);
          if (idbCookie) {
            storedCookie = idbCookie;
            storedCheckTime = idbCheckTime;
            await appStorage.setItem(this.opts.storageKey, idbCookie);
            if (idbCheckTime) await appStorage.setItem(this.opts.checkTimeKey, idbCheckTime);
            try {
              await indexedDBStorage.deleteSetting(this.opts.storageKey);
              await indexedDBStorage.deleteSetting(this.opts.checkTimeKey);
            } catch {
              // 迁移后清理旧条目失败无碍，下次仍以 appStorage 为准
            }
            logger.info(`[CookieManager:${this.opts.scope}] Migrated cookie from IndexedDB to settings.json`);
          }
        } catch (idbError) {
          // IndexedDB 打不开也无妨——cookie 本就不在那里（新版），降级为空 cookie
          logger.debug(`[CookieManager:${this.opts.scope}] IndexedDB unavailable during cookie load:`, idbError);
        }
      }

      if (storedCookie) {
        this.cookie = storedCookie;
        logger.debug(`[CookieManager:${this.opts.scope}] Cookie loaded from storage`);
      }

      if (storedCheckTime) {
        this.lastCheckTime = parseInt(storedCheckTime, 10);
      }
    } catch (error) {
      logger.error(`[CookieManager:${this.opts.scope}] Failed to load from storage:`, error);
    }
  }

  private async saveToStorage(): Promise<void> {
    try {
      await appStorage.setItem(this.opts.storageKey, this.cookie);
      await appStorage.setItem(this.opts.checkTimeKey, this.lastCheckTime.toString());
    } catch (error) {
      logger.error(`[CookieManager:${this.opts.scope}] Failed to save to storage:`, error);
    }
  }

  async setCookie(cookie: string): Promise<void> {
    this.cookie = cookie;
    this.lastCheckTime = Date.now();
    await this.saveToStorage();
    logger.debug(`[CookieManager:${this.opts.scope}] Cookie saved`);
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
      await appStorage.removeItem(this.opts.storageKey);
      await appStorage.removeItem(this.opts.checkTimeKey);
    } catch (error) {
      logger.error(`[CookieManager:${this.opts.scope}] Failed to clear storage:`, error);
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

    try {
      const status = await this.opts.validate(this.cookie);
      if (status.valid) {
        await this.updateCheckTime();
      }
      return status;
    } catch (error) {
      logger.error(`[CookieManager:${this.opts.scope}] Cookie validation failed:`, error);
      // Network error: keep the cookie, warn the user.
      return { valid: true, message: '网络验证失败，但Cookie已保存，使用时如失败请重新设置' };
    }
  }

  hasCookie(): boolean {
    return !!this.cookie;
  }

  async ensureLoaded(): Promise<void> {
    await this.initPromise;
  }

  /**
   * 重新从 appStorage 加载 cookie。
   *
   * cookieManager 在构造时启动 loadFromStorage()，但构造发生在模块导入时，
   * 此时 appStorage.init() 可能尚未把 ~/.la/settings.json 灌入 cache。清空
   * userData 后首次启动时，构造期的 loadFromStorage 读到空，this.cookie 保持
   * 空字符串，且 initPromise 只跑一次不会重试。useLibraryLoad 在 settings 灌入
   * 完成后调用本方法重新加载，使登录态恢复生效。
   */
  reload(): void {
    this.initPromise = this.loadFromStorage();
  }
}

/** QQ Music cookie validator — hits the QQ top-list endpoint. */
const validateQQCookie: CookieValidator = async (cookie: string): Promise<CookieStatus> => {
  const testResponse = await fetch(
    'https://u.y.qq.com/cgi-bin/musicu.fcg?data=' + encodeURIComponent(JSON.stringify({
      comm: {
        cv: 4747474, ct: 24, format: 'json', inCharset: 'utf-8', outCharset: 'utf-8',
        notice: 0, platform: 'yqq.json', needNewCode: 1, uin: '0',
        g_tk_new_20200303: 5381, g_tk: 5381,
      },
      req_1: { module: 'musicToplist.ToplistInfoServer', method: 'GetAll', param: {} },
    })),
    {
      headers: {
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookie,
      },
      credentials: 'omit',
    }
  );

  if (!testResponse.ok) {
    return { valid: false, message: 'Network error during validation' };
  }
  const data = await testResponse.json();
  if (data.code === 500001) {
    return { valid: false, message: 'Cookie expired or invalid' };
  }
  return { valid: true };
};

/**
 * NetEase cookie validator — calls `/nuser/account/get` via the main process.
 * A valid login cookie returns an account/profile; anonymous returns neither.
 */
const validateNetEaseCookie: CookieValidator = async (cookie: string): Promise<CookieStatus> => {
  const desktopAPI = getDesktopAPI();
  if (!desktopAPI?.neteaseRequest) {
    return { valid: false, message: 'Main process bridge unavailable' };
  }
  const result = await desktopAPI.neteaseRequest('/nuser/account/get', { csrf_token: '' }, cookie);
  if (!result.success) {
    return { valid: false, message: result.error || '验证失败' };
  }
  const data = result.data as { code?: number; account?: unknown; profile?: unknown } | undefined;
  if (data?.code !== 200 || (!data?.account && !data?.profile)) {
    return { valid: false, message: 'Cookie 无效或已过期' };
  }
  return { valid: true };
};

/** QQ Music cookie store (original singleton name preserved for back-compat). */
export const cookieManager = new CookieStore({
  storageKey: 'qq_music_cookie',
  checkTimeKey: 'qq_music_cookie_last_check',
  scope: 'QQMusic',
  validate: validateQQCookie,
});

/** NetEase Cloud Music cookie store (optional — enables VIP/high-quality downloads). */
export const neteaseCookieManager = new CookieStore({
  storageKey: 'netease_cookie',
  checkTimeKey: 'netease_cookie_last_check',
  scope: 'NetEase',
  validate: validateNetEaseCookie,
});

/**
 * Push the current QQ + NetEase cookies from the renderer cookie stores into
 * the main-process `stream://` proxy. Ensures both stores are loaded first.
 *
 * Single source of truth for the cookie-sync side effect that was previously
 * duplicated in AppWorkspace (startup sync), SettingsView and
 * useOnlineMusicSettings (post-login push). Callers may pass a `source` to
 * sync only one provider (used after a single-provider login); omit it to sync
 * both.
 */
export async function syncOnlineCookiesToMain(source?: 'qq' | 'netease'): Promise<void> {
  const api = await getDesktopAPIAsync();
  if (!api?.setOnlineCookie) return;
  await Promise.all([
    (source === undefined || source === 'qq') ? cookieManager.ensureLoaded() : Promise.resolve(),
    (source === undefined || source === 'netease') ? neteaseCookieManager.ensureLoaded() : Promise.resolve(),
  ]);
  if (source === undefined || source === 'qq') {
    const qq = cookieManager.getCookie();
    if (qq) void api.setOnlineCookie('qq', qq);
  }
  if (source === undefined || source === 'netease') {
    const netease = neteaseCookieManager.getCookie();
    if (netease) void api.setOnlineCookie('netease', netease);
  }
}
