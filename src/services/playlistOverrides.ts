/**
 * Playlist overrides — local edits (name, cover, visibility) persisted to
 * application settings so they survive across app restarts.
 *
 * Override key format: `${source}:${id}`  (e.g. "qq:123456")
 * Storage: AppStorage, key = STORAGE_KEY, value = JSON string. The old IndexedDB
 * value is consumed once as a migration source.
 */

import { appStorage } from './appStorage';
import { isDesktop } from './desktopAdapter';
import { indexedDBStorage } from './indexedDBStorage';
import { logger } from './logger';
import type { PlaylistInfo } from './onlineMusicProvider';

export interface PlaylistOverride {
  name?: string;
  /** base64 data-URL of the custom cover image */
  coverUrl?: string;
  hidden?: boolean;
}

const STORAGE_KEY = 'playlist-overrides';

type OverrideMap = Record<string, PlaylistOverride>;

let cache: OverrideMap | null = null;

const makeKey = (source: string, id: string): string => `${source}:${id}`;

const parseOverrideMap = (raw: string): OverrideMap | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const candidate = value as Record<string, unknown>;
      if (candidate['name'] !== undefined && typeof candidate['name'] !== 'string') return null;
      if (candidate['coverUrl'] !== undefined && typeof candidate['coverUrl'] !== 'string') return null;
      if (candidate['hidden'] !== undefined && typeof candidate['hidden'] !== 'boolean') return null;
    }

    return parsed as OverrideMap;
  } catch {
    return null;
  }
};

export async function loadOverrides(): Promise<OverrideMap> {
  if (cache) return cache;
  try {
    // Browser mode keeps potentially large base64 covers in IndexedDB. Desktop
    // mode migrates the same user-owned overrides into ~/.la/state.sqlite3.
    if (!isDesktop()) {
      const stored = await indexedDBStorage.getSetting(STORAGE_KEY);
      cache = stored === null ? {} : (parseOverrideMap(stored) ?? {});
      return cache;
    }

    const stored = appStorage.getItem(STORAGE_KEY);
    const parsedStored = stored === null ? null : parseOverrideMap(stored);
    if (parsedStored) {
      cache = parsedStored;
      void indexedDBStorage.deleteSetting(STORAGE_KEY).catch((error) => {
        logger.warn('[PlaylistOverrides] legacy cleanup failed:', error);
      });
      return cache;
    }
    if (stored !== null) {
      logger.warn('[PlaylistOverrides] AppStorage value is invalid; trying legacy IDB data');
    }

    const legacy = await indexedDBStorage.getSetting(STORAGE_KEY);
    const parsedLegacy = legacy === null ? null : parseOverrideMap(legacy);
    if (!parsedLegacy) {
      if (legacy !== null) {
        logger.warn('[PlaylistOverrides] Ignoring invalid legacy overrides');
      }
      cache = {};
      return cache;
    }

    cache = parsedLegacy;
    try {
      await appStorage.setItem(STORAGE_KEY, legacy!);
      await indexedDBStorage.deleteSetting(STORAGE_KEY);
    } catch (error) {
      logger.warn('[PlaylistOverrides] legacy migration failed:', error);
    }
  } catch (e) {
    logger.warn('[PlaylistOverrides] load failed:', e);
    cache = {};
  }
  return cache;
}

async function persist(map: OverrideMap): Promise<void> {
  try {
    const serialized = JSON.stringify(map);
    if (isDesktop()) await appStorage.setItem(STORAGE_KEY, serialized);
    else await indexedDBStorage.setSetting(STORAGE_KEY, serialized);
  } catch (e) {
    logger.error('[PlaylistOverrides] save failed:', e);
  }
}

export async function setOverride(
  source: string,
  id: string,
  patch: Partial<PlaylistOverride>,
): Promise<OverrideMap> {
  const map = await loadOverrides();
  const key = makeKey(source, id);
  const existing = map[key] ?? {};
  const merged = { ...existing, ...patch };

  // Remove the entry entirely if all fields are cleared
  if (!merged.name && !merged.coverUrl && !merged.hidden) {
    delete map[key];
  } else {
    map[key] = merged;
  }

  cache = map;
  await persist(map);
  return map;
}

/**
 * Merge overrides into freshly-fetched playlists and filter out hidden ones.
 * Returns `{ visible, all }` where `all` is the full merged list (for edit
 * mode) and `visible` has hidden playlists removed.
 */
export function applyOverrides(
  playlists: PlaylistInfo[],
  overrides: OverrideMap,
): { visible: PlaylistInfo[]; all: PlaylistInfo[] } {
  const all = playlists.map((pl) => {
    const ov = overrides[makeKey(pl.source, pl.id)];
    if (!ov) return pl;
    return {
      ...pl,
      name: ov.name ?? pl.name,
      coverUrl: ov.coverUrl ?? pl.coverUrl,
    };
  });
  const visible = all.filter((pl) => {
    const ov = overrides[makeKey(pl.source, pl.id)];
    return !ov?.hidden;
  });
  return { visible, all };
}
