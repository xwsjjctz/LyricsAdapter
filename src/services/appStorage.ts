/**
 * Unified application storage service.
 *
 * Persists settings to the main-process settings store in Electron mode, with a
 * synchronous in-memory cache and localStorage fallback in browser mode.
 *
 * Design:
 * - `getItem()` is synchronous — reads from the in‑memory cache.
 * - Desktop settings stay in memory + main-process storage and are never
 *   mirrored to localStorage.
 * - Browser mode stores every key in localStorage.
 * - `init()` pre‑loads all settings from the main process into the cache.
 *   The application bootstrap awaits it before importing UI modules.
 *
 * This works with the unified origin (Plan A): even though dev and build both
 * use `app://localhost`, the main-process store on disk is the single source of
 * truth that survives "clear browser data".
 */
import { getDesktopAPIAsync, isDesktop } from './desktopAdapter';
import { logger } from './logger';
import {
  isAppOwnedLocalStorageKey,
  isInternalSettingKey,
  isLegacyMigratableSettingKey,
  isReplaceableCacheSettingKey,
  isRetiredSettingKey,
  isSensitiveSettingKey,
  SETTINGS_MIGRATION_VERSION,
  SETTINGS_MIGRATION_VERSION_KEY,
} from '../shared/persistencePolicy';

class AppStorage {
  /** Synchronous in‑memory cache. Populated by init(). */
  private cache = new Map<string, string>();
  private initialized = false;
  /** The main-process read failed, so the cache is not a complete SQLite snapshot. */
  private desktopSnapshotUnavailable = false;
  private desktopMigrationPending = false;
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
    if (desktop) {
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
      if (key && (
        isAppOwnedLocalStorageKey(key)
        || isSensitiveSettingKey(key)
        || isInternalSettingKey(key)
        || key === 'sidebar-layout'
        || key === 'playlist-overrides'
        || key === 'webdav-cdn-cache'
      )) {
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
    this.restoreLocalValue(key, localValue, desktop);
  }

  private restoreLocalValue(key: string, value: string | null, desktop: boolean): void {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      this.mirrorToLocalStorage(key, value, desktop);
    }
  }

  private restoreLegacyLocalValue(key: string, value: string | null): void {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }

  /**
   * Initialize the storage cache.
   *
   * - Electron mode: loads all key/value pairs from the main-process store.
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
    let pendingDesktopMigration: Record<string, string> | null = null;
    try {
      if (desktop) {
        const api = await getDesktopAPIAsync();
        if (api?.settingsGetAll) {
          const all = await api.settingsGetAll();
          const mainEntries = Object.entries(all);
          this.cache.clear();

          if (all[SETTINGS_MIGRATION_VERSION_KEY] === SETTINGS_MIGRATION_VERSION) {
            this.clearDesktopMirror();
            // The marker, not a coincidental partial key set, establishes that
            // SQLite durably owns the full desktop configuration.
            for (const [key, value] of mainEntries) {
              if (isInternalSettingKey(key)
                || isReplaceableCacheSettingKey(key)
                || isRetiredSettingKey(key)) continue;
              this.cache.set(key, value);
              this.mirrorToLocalStorage(key, value, true);
            }
            this.preInitLocalValues.clear();
            this.desktopSnapshotUnavailable = false;
            this.desktopMigrationPending = false;
            logger.info('[AppStorage] Loaded', this.cache.size, 'authoritative keys from main process');
            this.initialized = true;
            return;
          }

          // Until the marker exists, merge validated main values with the
          // legacy local source. Existing main values win (especially playback).
          const migrated: Record<string, string> = {};
          for (const [key, value] of mainEntries) {
            if (isInternalSettingKey(key)
              || isReplaceableCacheSettingKey(key)
              || isRetiredSettingKey(key)) continue;
            migrated[key] = value;
          }
          for (const [key, value] of legacyLocal) {
            if (!isLegacyMigratableSettingKey(key)) continue;
            if (migrated[key] !== undefined) continue;
            migrated[key] = value;
          }
          // This marker is the commit sentinel for a complete desktop snapshot.
          // Keep it last so stale adapters that implement setMany as sequential
          // single-key writes cannot publish authority after a partial failure.
          migrated[SETTINGS_MIGRATION_VERSION_KEY] = SETTINGS_MIGRATION_VERSION;
          pendingDesktopMigration = migrated;
          if (api.settingsSetMany) {
            await api.settingsSetMany(migrated);
          } else if (api.settingsSet) {
            for (const [key, value] of Object.entries(migrated)) {
              await api.settingsSet(key, value);
            }
          } else {
            throw new Error('Desktop settings write API is unavailable');
          }
          this.clearDesktopMirror();
          for (const [key, value] of Object.entries(migrated)) {
            if (isInternalSettingKey(key)) continue;
            this.cache.set(key, value);
            this.mirrorToLocalStorage(key, value, true);
          }
          this.preInitLocalValues.clear();
          this.desktopSnapshotUnavailable = false;
          this.desktopMigrationPending = false;
          logger.info(
            '[AppStorage] Initialized empty main store',
            `(${Object.keys(migrated).length - 1} legacy keys migrated)`
          );
          this.initialized = true;
          return;
        }
        throw new Error('Desktop settings read API is unavailable');
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
        // A failed first migration has not durably protected the legacy source.
        // Keep it for a retry on the next launch; only successful commits remove
        // desktop mirrors. The current process still uses the in-memory copy.
        this.cache.clear();
        // Only a failed write after settingsGetAll returned can safely retry a
        // full replacement: pendingDesktopMigration then contains every main
        // setting plus the legacy additions. A failed read has no such complete
        // snapshot and must stay on incremental, key-scoped writes.
        this.desktopMigrationPending = pendingDesktopMigration !== null;
        this.desktopSnapshotUnavailable = pendingDesktopMigration === null;
        const degradedEntries = pendingDesktopMigration
          ?? Object.fromEntries([...legacyLocal].filter(([key]) => isLegacyMigratableSettingKey(key)));
        for (const [key, value] of Object.entries(degradedEntries)) {
          if (isInternalSettingKey(key)) continue;
          this.cache.set(key, value);
        }
        // Only restore values that actually originated in localStorage. Main-
        // only secrets are decrypted for this process but must never acquire a
        // new plaintext renderer copy because a marker write failed.
        for (const [key, value] of legacyLocal) {
          if (!isLegacyMigratableSettingKey(key)) continue;
          localStorage.setItem(key, value);
        }
      }
    }
    this.preInitLocalValues.clear();
    this.initialized = true;
  }

  /**
   * Get a value by key.
   * Synchronous — returns from the in‑memory cache first. Before desktop init,
   * legacy localStorage values may be returned for non-sensitive settings, but
   * are removed from localStorage immediately and retained only for migration.
   * Browser mode falls back to localStorage.
   * Returns null if the key does not exist (same as localStorage).
   */
  getItem(key: string): string | null {
    if (this.cache.has(key)) return this.cache.get(key)!;
    if (isDesktop()) {
      const legacyValue = localStorage.getItem(key);
      if (!this.initialized && legacyValue !== null) {
        if (isLegacyMigratableSettingKey(key)) {
          this.preInitLocalValues.set(key, legacyValue);
        }
      }
      localStorage.removeItem(key);
      if (isSensitiveSettingKey(key) || this.initialized) return null;
      return legacyValue;
    }
    return localStorage.getItem(key);
  }

  /**
   * Set a value by key.
   * Updates the synchronous cache/browser mirror first, then awaits the desktop
   * durable write. Desktop mode removes any stale localStorage copy.
   */
  async setItem(key: string, value: string): Promise<void> {
    const desktop = isDesktop();
    const hadCacheValue = this.cache.has(key);
    const previousCacheValue = this.cache.get(key);
    const previousLocalValue = localStorage.getItem(key);
    this.cache.set(key, value);
    this.preInitLocalValues.delete(key);
    // Keep the original legacy source in place while migration is pending, but
    // never mirror a newly entered value (especially a credential) as plaintext.
    if (!(desktop && this.desktopMigrationPending)) {
      this.mirrorToLocalStorage(key, value, desktop);
    }

    if (desktop) {
      try {
        const api = await getDesktopAPIAsync();
        if (this.desktopMigrationPending) {
          if (!api?.settingsReplaceAll) throw new Error('Desktop settings.replaceAll API is unavailable');
          await api.settingsReplaceAll({
            ...this.getAll(),
            [SETTINGS_MIGRATION_VERSION_KEY]: SETTINGS_MIGRATION_VERSION,
          });
          this.clearDesktopMirror();
          this.desktopSnapshotUnavailable = false;
          this.desktopMigrationPending = false;
        } else {
          if (!api?.settingsSet) throw new Error('Desktop settings.set API is unavailable');
          await api.settingsSet(key, value);
        }
      } catch (e) {
        if (this.cache.get(key) === value) {
          if (this.desktopMigrationPending || this.desktopSnapshotUnavailable) {
            if (hadCacheValue && previousCacheValue !== undefined) this.cache.set(key, previousCacheValue);
            else this.cache.delete(key);
            this.restoreLegacyLocalValue(key, previousLocalValue);
          } else {
            this.restoreKey(key, hadCacheValue, previousCacheValue, previousLocalValue, desktop);
          }
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
      if (!(desktop && this.desktopMigrationPending)) {
        this.mirrorToLocalStorage(key, value, desktop);
      }
    }

    if (desktop) {
      try {
        const api = await getDesktopAPIAsync();
        if (this.desktopMigrationPending) {
          if (!api?.settingsReplaceAll) throw new Error('Desktop settings.replaceAll API is unavailable');
          await api.settingsReplaceAll({
            ...this.getAll(),
            [SETTINGS_MIGRATION_VERSION_KEY]: SETTINGS_MIGRATION_VERSION,
          });
          this.clearDesktopMirror();
          this.desktopSnapshotUnavailable = false;
          this.desktopMigrationPending = false;
        } else {
          if (!api?.settingsSetMany) throw new Error('Desktop settings.setMany API is unavailable');
          await api.settingsSetMany(entries);
        }
      } catch (e) {
        for (const [key, value] of Object.entries(entries)) {
          const before = previous.get(key);
          if (before && this.cache.get(key) === value) {
            if (this.desktopMigrationPending || this.desktopSnapshotUnavailable) {
              if (before.hadCacheValue && before.cacheValue !== undefined) this.cache.set(key, before.cacheValue);
              else this.cache.delete(key);
              this.restoreLegacyLocalValue(key, before.localValue);
            } else {
              this.restoreKey(key, before.hadCacheValue, before.cacheValue, before.localValue, desktop);
            }
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
        if (this.desktopMigrationPending) {
          if (!api?.settingsReplaceAll) throw new Error('Desktop settings.replaceAll API is unavailable');
          await api.settingsReplaceAll({
            ...this.getAll(),
            [SETTINGS_MIGRATION_VERSION_KEY]: SETTINGS_MIGRATION_VERSION,
          });
          this.clearDesktopMirror();
          this.desktopSnapshotUnavailable = false;
          this.desktopMigrationPending = false;
        } else {
          if (!api?.settingsDelete) throw new Error('Desktop settings.delete API is unavailable');
          await api.settingsDelete(key);
        }
      } catch (e) {
        if (!this.cache.has(key)) {
          if (this.desktopMigrationPending || this.desktopSnapshotUnavailable) {
            if (hadCacheValue && previousCacheValue !== undefined) this.cache.set(key, previousCacheValue);
            this.restoreLegacyLocalValue(key, previousLocalValue);
          } else {
            this.restoreKey(key, hadCacheValue, previousCacheValue, previousLocalValue, true);
          }
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
    const wasMigrationPending = desktop && this.desktopMigrationPending;
    const wasSnapshotUnavailable = desktop && this.desktopSnapshotUnavailable;
    const preserveLegacySource = wasMigrationPending || wasSnapshotUnavailable;
    const previousCache = new Map(this.cache);
    const previousLocal = this.localSnapshot();
    this.cache.clear();
    this.preInitLocalValues.clear();
    if (desktop) {
      if (!preserveLegacySource) this.clearDesktopMirror();
    } else {
      localStorage.clear();
    }
    for (const [key, value] of Object.entries(entries)) {
      this.cache.set(key, value);
      if (!preserveLegacySource) this.mirrorToLocalStorage(key, value, desktop);
    }

    if (desktop) {
      try {
        const api = await getDesktopAPIAsync();
        if (!api?.settingsReplaceAll) throw new Error('Desktop settings.replaceAll API is unavailable');
        await api.settingsReplaceAll({
          ...entries,
          [SETTINGS_MIGRATION_VERSION_KEY]: SETTINGS_MIGRATION_VERSION,
        });
        if (preserveLegacySource) this.clearDesktopMirror();
        this.desktopSnapshotUnavailable = false;
        this.desktopMigrationPending = false;
      } catch (e) {
        this.cache = previousCache;
        if (desktop) {
          this.clearDesktopMirror();
        } else {
          localStorage.clear();
        }
        for (const [key, value] of previousLocal) {
          if (preserveLegacySource) {
            localStorage.setItem(key, value);
          } else if (!desktop || isAppOwnedLocalStorageKey(key) || isSensitiveSettingKey(key)) {
            this.restoreLocalValue(key, value, desktop);
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
    const preserveLegacySource = desktop
      && (this.desktopMigrationPending || this.desktopSnapshotUnavailable);
    this.cache.clear();
    if (desktop && !preserveLegacySource) this.clearDesktopMirror();
    for (const [key, value] of Object.entries(entries)) {
      if (isInternalSettingKey(key)) continue;
      this.cache.set(key, value);
      if (!preserveLegacySource) this.mirrorToLocalStorage(key, value, desktop);
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
    this.desktopSnapshotUnavailable = false;
    this.desktopMigrationPending = false;
    this.initPromise = null;
  }
}

export const appStorage = new AppStorage();
