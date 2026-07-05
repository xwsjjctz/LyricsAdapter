/**
 * Playlist overrides — local edits (name, cover, visibility) persisted to
 * IndexedDB so they survive across app restarts.
 *
 * Override key format: `${source}:${id}`  (e.g. "qq:123456")
 * Storage: IndexedDB `settings` store, key = STORAGE_KEY, value = JSON string.
 */

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

export async function loadOverrides(): Promise<OverrideMap> {
  if (cache) return cache;
  try {
    const raw = await indexedDBStorage.getSetting(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as OverrideMap) : {};
  } catch (e) {
    logger.warn('[PlaylistOverrides] load failed:', e);
    cache = {};
  }
  return cache;
}

async function persist(map: OverrideMap): Promise<void> {
  try {
    await indexedDBStorage.setSetting(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    logger.error('[PlaylistOverrides] save failed:', e);
  }
}

export function getOverride(source: string, id: string): PlaylistOverride | undefined {
  return cache?.[makeKey(source, id)];
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
