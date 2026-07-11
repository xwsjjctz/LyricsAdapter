/**
 * Unified application storage service.
 *
 * Provides a drop‑in replacement for localStorage that persists data to the
 * main‑process settings.json in Electron mode, with a synchronous in‑memory
 * cache and localStorage fallback in browser mode.
 *
 * Design:
 * - `getItem()` is synchronous — reads from the in‑memory cache.
 * - `setItem()` / `removeItem()` write synchronously to localStorage (fast path)
 *   and asynchronously to the main process (durable path).
 * - `init()` pre‑loads all settings from the main process into the cache.
 *   Must be called once at app startup (can be fire‑and‑forget).
 *
 * This works with the unified origin (Plan A): even though dev and build both
 * use `app://localhost`, the Electron Store on disk is the single source of
 * truth that survives "clear browser data".
 */
import { getDesktopAPIAsync, isDesktop } from './desktopAdapter';
import { logger } from './logger';

class AppStorage {
  /** Synchronous in‑memory cache. Populated by init(). */
  private cache = new Map<string, string>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the storage cache.
   *
   * - Electron mode: loads all key/value pairs from the main‑process JSON file.
   * - Browser mode: loads all key/value pairs from localStorage.
   *
   * Safe to call multiple times; subsequent calls return the same promise.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    try {
      if (isDesktop()) {
        const api = await getDesktopAPIAsync();
        if (api?.settingsGetAll) {
          const all = await api.settingsGetAll();
          const mainKeys = new Set(Object.keys(all));
          let migratedCount = 0;

          // 1) 主进程 → 本地 cache + localStorage
          for (const [key, value] of Object.entries(all)) {
            this.cache.set(key, value);
            localStorage.setItem(key, value);
          }

          // 2) 反向迁移：localStorage 中有但主进程 settings.json 中没有的键 →
          //    推送到主进程（处理用户首次从旧版升级的场景）
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || mainKeys.has(key)) continue;
            const value = localStorage.getItem(key);
            if (value !== null) {
              this.cache.set(key, value);
              // 异步推送，不阻塞 init 完成
              if (api.settingsSet) api.settingsSet(key, value).catch(() => {});
              migratedCount++;
            }
          }

          logger.info(
            '[AppStorage] Loaded', this.cache.size, 'keys from main process',
            migratedCount > 0 ? `(+${migratedCount} migrated from localStorage)` : ''
          );
          this.initialized = true;
          return;
        }
      }
      // Browser fallback: load from localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          this.cache.set(key, localStorage.getItem(key) ?? '');
        }
      }
      logger.info('[AppStorage] Loaded', this.cache.size, 'keys from localStorage (browser mode)');
    } catch (e) {
      logger.warn('[AppStorage] Init failed, falling back to localStorage:', e);
    }
    this.initialized = true;
  }

  /**
   * Get a value by key.
   * Synchronous — returns from the in‑memory cache first, falls back to
   * localStorage (handles the race between app boot and init() completing).
   * Returns null if the key does not exist (same as localStorage).
   */
  getItem(key: string): string | null {
    if (this.cache.has(key)) return this.cache.get(key)!;
    return localStorage.getItem(key);
  }

  /**
   * Set a value by key.
   * Writes synchronously to the in‑memory cache + localStorage,
   * then asynchronously to the main‑process store.
   */
  async setItem(key: string, value: string): Promise<void> {
    this.cache.set(key, value);
    localStorage.setItem(key, value);

    if (isDesktop()) {
      try {
        const api = await getDesktopAPIAsync();
        await api?.settingsSet?.(key, value);
      } catch (e) {
        logger.warn('[AppStorage] Failed to persist to main process:', e);
      }
    }
  }

  /**
   * 批量写入多个键值对。比逐个调用 setItem 更高效（只 flush 一次磁盘）。
   */
  async setMany(entries: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      this.cache.set(key, value);
      localStorage.setItem(key, value);
    }

    if (isDesktop()) {
      try {
        const api = await getDesktopAPIAsync();
        await api?.settingsSetMany?.(entries);
      } catch (e) {
        logger.warn('[AppStorage] Failed to persist setMany to main process:', e);
      }
    }
  }

  /**
   * Remove a key.
   * Removes from cache + localStorage, then async from main process.
   */
  async removeItem(key: string): Promise<void> {
    this.cache.delete(key);
    localStorage.removeItem(key);

    if (isDesktop()) {
      try {
        const api = await getDesktopAPIAsync();
        await api?.settingsDelete?.(key);
      } catch (e) {
        logger.warn('[AppStorage] Failed to remove from main process:', e);
      }
    }
  }

  /**
   * Replace all entries (bulk write).
   * Useful for migration or syncing the entire settings at once.
   */
  async replaceAll(entries: Record<string, string>): Promise<void> {
    this.cache.clear();
    for (const [key, value] of Object.entries(entries)) {
      this.cache.set(key, value);
      localStorage.setItem(key, value);
    }

    if (isDesktop()) {
      try {
        const api = await getDesktopAPIAsync();
        await api?.settingsReplaceAll?.(entries);
      } catch (e) {
        logger.warn('[AppStorage] Failed to replaceAll in main process:', e);
      }
    }
  }

  /**
   * Get the number of entries in the cache.
   */
  get length(): number {
    return this.cache.size;
  }

  /**
   * Clear the in‑memory cache (does NOT clear persisted storage).
   */
  clearCache(): void {
    this.cache.clear();
    this.initialized = false;
    this.initPromise = null;
  }
}

export const appStorage = new AppStorage();
