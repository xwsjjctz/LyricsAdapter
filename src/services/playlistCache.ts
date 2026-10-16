/**
 * Playlist data cache — persists fetched playlists to IndexedDB so the
 * UI can display them immediately on startup instead of showing a
 * loading spinner while waiting for the network.
 *
 * Storage: IndexedDB `settings` store.
 *   key: "playlist-cache"
 *   value: JSON { sources: { [sourceId]: PlaylistInfo[] }, ts: number }
 *   Older caches stored `qq` / `netease` at the top level; they are read as sources.
 */

import { indexedDBStorage } from './indexedDBStorage';
import { logger } from './logger';
import type { OnlineSource, PlaylistInfo } from './onlineMusicProvider';

const STORAGE_KEY = 'playlist-cache';

export interface PlaylistCacheData {
  sources: Record<OnlineSource, PlaylistInfo[]>;
  ts: number;
}

interface StoredPlaylistCache {
  sources?: Record<OnlineSource, PlaylistInfo[]>;
  qq?: PlaylistInfo[];
  netease?: PlaylistInfo[];
  ts?: number;
}

export async function loadPlaylistCache(): Promise<PlaylistCacheData | null> {
  try {
    const raw = await indexedDBStorage.getSetting(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredPlaylistCache;
    if (!stored.ts) return null;
    const sources: Record<OnlineSource, PlaylistInfo[]> = {
      ...(stored.qq ? { qq: stored.qq } : {}),
      ...(stored.netease ? { netease: stored.netease } : {}),
      ...stored.sources,
    };
    logger.debug('[PlaylistCache] loaded', { ts: stored.ts, sources: Object.keys(sources) });
    return { sources, ts: stored.ts };
  } catch (e) {
    logger.warn('[PlaylistCache] load failed:', e);
    return null;
  }
}

/** Replaces the cache with the sources that returned playlists. */
export async function savePlaylistCache(sources: Record<OnlineSource, PlaylistInfo[]>): Promise<void> {
  try {
    const data: PlaylistCacheData = { ts: Date.now(), sources };
    await indexedDBStorage.setSetting(STORAGE_KEY, JSON.stringify(data));
    logger.debug('[PlaylistCache] saved', { sources: Object.keys(sources) });
  } catch (e) {
    logger.error('[PlaylistCache] save failed:', e);
  }
}
