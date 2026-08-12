/**
 * Unified application storage service.
 *
 * Persists settings to main-process settings.json in Electron mode, with a
 * synchronous in-memory cache and localStorage fallback in browser mode.
 *
 * Design:
 * - `getItem()` is synchronous — reads from the in‑memory cache.
 * - Desktop secrets stay in memory + encrypted main-process storage and are
 *   never mirrored to localStorage.
 * - Non-sensitive desktop settings keep a localStorage mirror for synchronous
 *   pre-init reads. Browser mode stores every key in localStorage.
 * - `init()` pre‑loads all settings from the main process into the cache.
 *   The application bootstrap awaits it before importing UI modules.
 *
 * This works with the unified origin (Plan A): even though dev and build both
 * use `app://localhost`, the Electron Store on disk is the single source of
 * truth that survives "clear browser data".
 */
import { getDesktopAPIAsync, isDesktop } from './desktopAdapter';
import { logger } from './logger';
import {
  isAppOwnedLocalStorageKey,
  isInternalSettingKey,
  isLegacyMigratableSettingKey,
  isSensitiveSettingKey,
  SETTINGS_MIGRATION_VERSION,
  SETTINGS_MIGRATION_VERSION_KEY,
} from '../shared/persistencePolicy';

class AppStorage {
  /** Synchronous in‑memory cache. Populated by init(). */
  private cache = new Map<string, string>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  /** Secrets removed by an early synchronous read, retained only for legacy migration. */
  private preInitLocalValues = new Map<string, string>();

  private localSnapshot(): Map<string, string> {
    const snapshot = new Map(this.preInitLocalValues);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) snapshot.set(key, localStorage.getItem(key) ?? '');
    }
    return snapshot;
  }

  private mirrorToLocalStorage(key: string, value: string, desktop: boolean): void {
    if (desktop && (isSensitiveSettingKey(key) || isInternalSettingKey(key))) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, value);
  }

  /** Remove only application-owned mirror keys; preserve unrelated origin data. */
  private clearDesktopMirror(): void {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (isAppOwnedLocalStorageKey(key) || isSensitiveSettingKey(key) || isInternalSettingKey(key))) {
        keys.push(key);
      }
    }
    for (const key of keys) localStorage.removeItem(key);
  }

  private restoreKey(
    key: string,
    hadCacheValue: boolean,
    cacheValue: string | undefined,
    localValue: string | null,
    desktop: boolean,
  ): void {
    if (hadCacheValue && cacheValue !== undefined) this.cache.set(key, cacheValue);
    else this.cache.delete(key);
    if (localValue === null) localStorage.removeItem(key);
    else this.mirrorToLocalStorage(key, localValue, desktop);
  }

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
    const desktop = isDesktop();
    const legacyLocal = this.localSnapshot();
    try {
      if (desktop) {
        const api = await getDesktopAPIAsync();
        if (api?.settingsGetAll) {
          const all = await api.settingsGetAll();
          const mainEntries = Object.entries(all);

          this.cache.clear();
          this.clearDesktopMirror();

          if (mainEntries.length > 0) {
            if (all[SETTINGS_MIGRATION_VERSION_KEY] !== SETTINGS_MIGRATION_VERSION && api.settingsSet) {
              try {
                await api.settingsSet(SETTINGS_MIGRATION_VERSION_KEY, SETTINGS_MIGRATION_VERSION);
              } catch (error) {
                logger.warn('[AppStorage] Failed to persist migration marker:', error);
              }
            }
            // A non-empty main snapshot is authoritative. Missing local keys
            // represent deleted/stale settings and must not be resurrected.
            for (const [key, value] of mainEntries) {
              if (isInternalSettingKey(key)) continue;
              this.cache.set(key, value);
              this.mirrorToLocalStorage(key, value, true);
            }
            this.preInitLocalValues.clear();
            logger.info('[AppStorage] Loaded', this.cache.size, 'authoritative keys from main process');
            this.initialized = true;
            return;
          }

          // A genuinely empty main store indicates a first upgrade from the
          // old localStorage-only implementation. Migrate only active known keys.
          const migrated: Record<string, string> = {
            [SETTINGS_MIGRATION_VERSION_KEY]: SETTINGS_MIGRATION_VERSION,
          };
          for (const [key, value] of legacyLocal) {
            if (!isLegacyMigratableSettingKey(key)) continue;
            migrated[key] = value;
          }
          if (api.settingsSetMany) {
            await api.settingsSetMany(migrated);
          } else if (api.settingsSet) {
            await Promise.all(Object.entries(migrated).map(([key, value]) => api.settingsSet!(key, value)));
          } else {
            throw new Error('Desktop settings write API is unavailable');
          }
          for (const [key, value] of Object.entries(migrated)) {
            if (isInternalSettingKey(key)) continue;
            this.cache.set(key, value);
            this.mirrorToLocalStorage(key, value, true);
          }
          this.preInitLocalValues.clear();
          logger.info(
            '[AppStorage] Initialized empty main store',
            `(${Object.keys(migrated).length - 1} legacy keys migrated)`
          );
          this.initialized = true;
          return;
        }
      }
      // Browser fallback: load from localStorage
      if (!desktop) {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) {
            this.cache.set(key, localStorage.getItem(key) ?? '');
          }
        }
        logger.info('[AppStorage] Loaded', this.cache.size, 'keys from localStorage (browser mode)');
      }
    } catch (e) {
      logger.warn('[AppStorage] Init failed:', e);
      if (!desktop) {
        for (const [key, value] of legacyLocal) this.cache.set(key, value);
      } else {
        // Degraded startup may use only known legacy settings. Credentials stay
        // in memory for this process and are removed from plaintext storage.
        this.cache.clear();
        for (const [key, value] of legacyLocal) {
          if (!isLegacyMigratableSettingKey(key)) continue;
          this.cache.set(key, value);
          this.mirrorToLocalStorage(key, value, true);
        }
      }
    }
    this.preInitLocalValues.clear();
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
    if (isDesktop()) {
      if (isSensitiveSettingKey(key)) {
        const legacyValue = localStorage.getItem(key);
        if (!this.initialized && legacyValue !== null) {
          this.preInitLocalValues.set(key, legacyValue);
        }
        localStorage.removeItem(key);
        return null;
      }
      if (this.initialized) return null;
    }
    return localStorage.getItem(key);
  }

  /**
   * Set a value by key.
   * Updates the synchronous cache/local mirror first, then awaits the desktop
   * durable write. Desktop secrets are removed from the local mirror.
   */
  async setItem(key: string, value: string): Promise<void> {
    const desktop = isDesktop();
    const hadCacheValue = this.cache.has(key);
    const previousCacheValue = this.cache.get(key);
    const previousLocalValue = localStorage.getItem(key);
    this.cache.set(key, value);
    this.preInitLocalValues.delete(key);
    this.mirrorToLocalStorage(key, value, desktop);

    if (desktop) {
      try {
        const api = await getDesktopAPIAsync();
        if (!api?.settingsSet) throw new Error('Desktop settings.set API is unavailable');
        await api.settingsSet(key, value);
      } catch (e) {
        if (this.cache.get(key) === value) {
          this.restoreKey(key, hadCacheValue, previousCacheValue, previousLocalValue, desktop);
        }
        logger.warn('[AppStorage] Failed to persist to main process:', e);
        throw e;
      }
    }
  }

  /**
   * 批量写入多个键值对。比逐个调用 setItem 更高效（只 flush 一次磁盘）。
   */
  async setMany(entries: Record<string, string>): Promise<void> {
    const desktop = isDesktop();
    const previous = new Map<string, { hadCacheValue: boolean; cacheValue: string | undefined; localValue: string | null }>();
    for (const [key, value] of Object.entries(entries)) {
      previous.set(key, {
        hadCacheValue: this.cache.has(key),
        cacheValue: this.cache.get(key),
        localValue: localStorage.getItem(key),
      });
      this.cache.set(key, value);
      this.preInitLocalValues.delete(key);
      this.mirrorToLocalStorage(key, value, desktop);
    }

    if (desktop) {
      try {
        const api = await getDesktopAPIAsync();
        if (!api?.settingsSetMany) throw new Error('Desktop settings.setMany API is unavailable');
        await api.settingsSetMany(entries);
      } catch (e) {
        for (const [key, value] of Object.entries(entries)) {
          const before = previous.get(key);
          if (before && this.cache.get(key) === value) {
            this.restoreKey(key, before.hadCacheValue, before.cacheValue, before.localValue, desktop);
          }
        }
        logger.warn('[AppStorage] Failed to persist setMany to main process:', e);
        throw e;
      }
    }
  }

  /**
   * Remove a key.
   * Removes from cache + localStorage, then async from main process.
   */
  async removeItem(key: string): Promise<void> {
    const hadCacheValue = this.cache.has(key);
    const previousCacheValue = this.cache.get(key);
    const previousLocalValue = localStorage.getItem(key);
    this.cache.delete(key);
    this.preInitLocalValues.delete(key);
    localStorage.removeItem(key);

    if (isDesktop()) {
      try {
        const api = await getDesktopAPIAsync();
        if (!api?.settingsDelete) throw new Error('Desktop settings.delete API is unavailable');
        await api.settingsDelete(key);
      } catch (e) {
        if (!this.cache.has(key)) {
          this.restoreKey(key, hadCacheValue, previousCacheValue, previousLocalValue, true);
        }
        logger.warn('[AppStorage] Failed to remove from main process:', e);
        throw e;
      }
    }
  }

  /**
   * Replace all entries (bulk write).
   * Useful for migration or syncing the entire settings at once.
   */
  async replaceAll(entries: Record<string, string>): Promise<void> {
    const desktop = isDesktop();
    const previousCache = new Map(this.cache);
    const previousLocal = this.localSnapshot();
    this.cache.clear();
    this.preInitLocalValues.clear();
    if (desktop) this.clearDesktopMirror();
    else localStorage.clear();
    for (const [key, value] of Object.entries(entries)) {
      this.cache.set(key, value);
      this.mirrorToLocalStorage(key, value, desktop);
    }

    if (desktop) {
      try {
        const api = await getDesktopAPIAsync();
        if (!api?.settingsReplaceAll) throw new Error('Desktop settings.replaceAll API is unavailable');
        await api.settingsReplaceAll({
          ...entries,
          [SETTINGS_MIGRATION_VERSION_KEY]: SETTINGS_MIGRATION_VERSION,
        });
      } catch (e) {
        this.cache = previousCache;
        if (desktop) this.clearDesktopMirror();
        else localStorage.clear();
        for (const [key, value] of previousLocal) {
          if (!desktop || isAppOwnedLocalStorageKey(key) || isSensitiveSettingKey(key)) {
            this.mirrorToLocalStorage(key, value, desktop);
          }
        }
        logger.warn('[AppStorage] Failed to replaceAll in main process:', e);
        throw e;
      }
    }
  }

  /**
   * Get the number of entries in the cache.
   */
  get length(): number {
    return this.cache.size;
  }

  /** Snapshot of application settings currently held in memory. */
  getAll(): Record<string, string> {
    return Object.fromEntries(
      [...this.cache].filter(([key]) => !isInternalSettingKey(key))
    );
  }

  /**
   * Use a validated recovery snapshot for the current process when the main
   * settings store cannot be repaired. This never claims a durable write.
   */
  restoreInMemory(entries: Record<string, string>): void {
    const desktop = isDesktop();
    this.cache.clear();
    if (desktop) this.clearDesktopMirror();
    for (const [key, value] of Object.entries(entries)) {
      if (isInternalSettingKey(key)) continue;
      this.cache.set(key, value);
      this.mirrorToLocalStorage(key, value, desktop);
    }
    this.initialized = true;
  }

  /**
   * Clear the in‑memory cache (does NOT clear persisted storage).
   */
  clearCache(): void {
    this.cache.clear();
    this.preInitLocalValues.clear();
    this.initialized = false;
    this.initPromise = null;
  }
}

export const appStorage = new AppStorage();
