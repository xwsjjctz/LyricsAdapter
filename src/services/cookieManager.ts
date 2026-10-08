import { logger } from './logger';
import { indexedDBStorage } from './indexedDBStorage';
import { appStorage } from './appStorage';
import { getDesktopAPI, getDesktopAPIAsync } from './desktopAdapter';

const COOKIE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface CookieStatus {
  valid: boolean;
  message?: string;
}

/** Per-source cookie validation strategy. */
type CookieValidator = (cookie: string) => Promise<CookieStatus>;
type CookieListener = () => void;

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
  private listeners = new Set<CookieListener>();

  constructor(private readonly opts: CookieStoreOptions) {
    this.initPromise = this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    try {
      this.cookie = '';
      this.lastCheckTime = 0;
      // 凭据存到 ~/.la/settings.json（safeStorage 加密），与 IndexedDB 缓存解耦：
      // 即使 IndexedDB 损坏被清，登录态也保留。appStorage.getItem 同步读，
      // 这里 await init 仅为确保主进程数据已载入内存 cache。
      await appStorage.init();

      let storedCookie = appStorage.getItem(this.opts.storageKey);
      let storedCheckTime = appStorage.getItem(this.opts.checkTimeKey);

      // 一次性迁移：旧版本把 cookie 存在 IndexedDB settings store 里。
      // 若 appStorage 里没有但 IndexedDB 里有，搬过来并清掉旧位置。
      if (storedCookie === null) {
        try {
          await indexedDBStorage.initialize();
          const idbCookie = await indexedDBStorage.getSetting(this.opts.storageKey);
          const idbCheckTime = await indexedDBStorage.getSetting(this.opts.checkTimeKey);
          if (idbCookie) {
            storedCookie = idbCookie;
            storedCheckTime = idbCheckTime;
            await appStorage.setMany({
              [this.opts.storageKey]: idbCookie,
              [this.opts.checkTimeKey]: idbCheckTime || '0',
            });
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
      } else if (storedCookie === '') {
        this.cookie = '';
      }

      if (storedCheckTime) {
        this.lastCheckTime = parseInt(storedCheckTime, 10);
      }
    } catch (error) {
      logger.error(`[CookieManager:${this.opts.scope}] Failed to load from storage:`, error);
    }
  }

  private async saveToStorage(cookie: string, lastCheckTime: number): Promise<void> {
    await appStorage.setMany({
      [this.opts.storageKey]: cookie,
      [this.opts.checkTimeKey]: lastCheckTime.toString(),
    });
  }

  async setCookie(cookie: string): Promise<void> {
    const lastCheckTime = Date.now();
    await this.saveToStorage(cookie, lastCheckTime);
    this.cookie = cookie;
    this.lastCheckTime = lastCheckTime;
    this.notify();
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
    try {
      await this.saveToStorage('', 0);
      this.cookie = '';
      this.lastCheckTime = 0;
      this.notify();
    } catch (error) {
      logger.error(`[CookieManager:${this.opts.scope}] Failed to clear storage:`, error);
      throw error;
    }
  }

  shouldCheckCookie(): boolean {
    if (!this.cookie) return true;
    const timeSinceLastCheck = Date.now() - this.lastCheckTime;
    return timeSinceLastCheck >= COOKIE_CHECK_INTERVAL;
  }

  async updateCheckTime(): Promise<void> {
    const lastCheckTime = Date.now();
    await this.saveToStorage(this.cookie, lastCheckTime);
    this.lastCheckTime = lastCheckTime;
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

  subscribe(listener: CookieListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach(listener => listener());
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
    this.initPromise = this.loadFromStorage().then(() => this.notify());
  }
}

const pluginCookieValidator = (source: 'qq' | 'netease'): CookieValidator => async cookie => {
  const api = getDesktopAPI();
  if (!api?.musicPluginCall) return { valid: false, message: 'Music plugin host unavailable' };
  return await api.musicPluginCall(source, 'validateCookie', [cookie]) as CookieStatus;
};

/** QQ Music cookie store (original singleton name preserved for back-compat). */
export const cookieManager = new CookieStore({
  storageKey: 'qq_music_cookie',
  checkTimeKey: 'qq_music_cookie_last_check',
  scope: 'QQMusic',
  validate: pluginCookieValidator('qq'),
});

/** NetEase Cloud Music cookie store (optional — enables VIP/high-quality downloads). */
export const neteaseCookieManager = new CookieStore({
  storageKey: 'netease_cookie',
  checkTimeKey: 'netease_cookie_last_check',
  scope: 'NetEase',
  validate: pluginCookieValidator('netease'),
});

/**
 * Push the current QQ and NetEase cookies from the renderer stores into the
 * main-process `stream://` proxy. Ensures both stores are loaded first.
 *
 * Single source of truth for the cookie-sync side effect that was previously
 * duplicated in the renderer composition root (startup sync) and online settings
 * flow (post-login push). Callers may pass a `source` to
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
  const updates: Promise<void>[] = [];
  if (source === undefined || source === 'qq') {
    updates.push(api.setOnlineCookie('qq', cookieManager.getCookie()));
  }
  if (source === undefined || source === 'netease') {
    updates.push(api.setOnlineCookie('netease', neteaseCookieManager.getCookie()));
  }
  await Promise.all(updates);
}
