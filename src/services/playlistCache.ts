/**
 * Playlist data cache — persists fetched playlists to IndexedDB so the
 * UI can display them immediately on startup instead of showing a
 * loading spinner while waiting for the network.
 *
 * Storage: IndexedDB `settings` store.
 *   key: "playlist-cache"
 *   value: JSON { qq?: PlaylistInfo[], netease?: PlaylistInfo[], ts: number }
 */

import { indexedDBStorage } from './indexedDBStorage';
import { logger } from './logger';
import type { PlaylistInfo } from './onlineMusicProvider';

const STORAGE_KEY = 'playlist-cache';

export interface PlaylistCacheData {
  qq?: PlaylistInfo[];
  netease?: PlaylistInfo[];
  ts: number;
}

export async function loadPlaylistCache(): Promise<PlaylistCacheData | null> {
  try {
    const raw = await indexedDBStorage.getSetting(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PlaylistCacheData;
    if (!data.ts) return null;
    logger.debug('[PlaylistCache] loaded', { ts: data.ts, qq: data.qq?.length, netease: data.netease?.length });
    return data;
  } catch (e) {
    logger.warn('[PlaylistCache] load failed:', e);
    return null;
  }
}

export async function savePlaylistCache(
  qq: PlaylistInfo[] | undefined,
  netease: PlaylistInfo[] | undefined,
): Promise<void> {
  try {
    const data: PlaylistCacheData = {
      ts: Date.now(),
      ...(qq !== undefined ? { qq } : {}),
      ...(netease !== undefined ? { netease } : {}),
    };
    await indexedDBStorage.setSetting(STORAGE_KEY, JSON.stringify(data));
    logger.debug('[PlaylistCache] saved', { qq: qq?.length, netease: netease?.length });
  } catch (e) {
    logger.error('[PlaylistCache] save failed:', e);
  }
}
