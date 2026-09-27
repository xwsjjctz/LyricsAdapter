/**
 * Playlist tracks cache — persists the pages of a third-party playlist that
 * have been loaded so reopening it (even after a restart) shows the list and
 * its covers immediately instead of refetching from the first page.
 *
 * Storage: IndexedDB `settings` store.
 *   key: "playlist-tracks-cache"
 *   value: JSON { entries: { "<source>:<playlistId>": CachedPlaylistTracks } }
 */

import { indexedDBStorage } from './indexedDBStorage';
import { logger } from './logger';
import type { OnlineSource } from './onlineMusicProvider';
import type { Track } from '../types';

const STORAGE_KEY = 'playlist-tracks-cache';
export const MAX_CACHED_PLAYLISTS = 12;
/** Within this window a cached list is shown without asking the provider again. */
export const PLAYLIST_TRACKS_FRESH_MS = 10 * 60 * 1000;

export interface PlaylistTracksPage {
  tracks: Track[];
  nextOffset: number;
  hasMore: boolean;
  totalTrackCount: number | null;
}

export interface CachedPlaylistTracks extends PlaylistTracksPage {
  savedAt: number;
}

type CacheEntries = Record<string, CachedPlaylistTracks>;

let entriesPromise: Promise<CacheEntries> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

const cacheKey = (source: OnlineSource, playlistId: string) => `${source}:${playlistId}`;

// Provider list rows only; lyrics are fetched per play and runtime URLs expire.
function toCachedTrack(track: Track): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    audioUrl: '',
    ...(track.coverUrl ? { coverUrl: track.coverUrl } : {}),
    ...(track.source ? { source: track.source } : {}),
    ...(track.songmid ? { songmid: track.songmid } : {}),
  };
}

async function readEntries(): Promise<CacheEntries> {
  try {
    const raw = await indexedDBStorage.getSetting(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { entries?: CacheEntries };
    return parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
  } catch (e) {
    logger.warn('[PlaylistTracksCache] load failed:', e);
    return {};
  }
}

function getEntries(): Promise<CacheEntries> {
  entriesPromise ??= readEntries();
  return entriesPromise;
}

export async function loadPlaylistTracks(
  source: OnlineSource,
  playlistId: string,
): Promise<CachedPlaylistTracks | null> {
  const entry = (await getEntries())[cacheKey(source, playlistId)];
  return entry && Array.isArray(entry.tracks) ? entry : null;
}

export function isPlaylistTracksFresh(entry: CachedPlaylistTracks, now = Date.now()): boolean {
  return now - entry.savedAt < PLAYLIST_TRACKS_FRESH_MS;
}

function keepMostRecent(entries: CacheEntries): CacheEntries {
  const kept = Object.entries(entries)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_CACHED_PLAYLISTS);
  return Object.fromEntries(kept);
}

export function savePlaylistTracks(
  source: OnlineSource,
  playlistId: string,
  page: PlaylistTracksPage,
  now = Date.now(),
): Promise<void> {
  const entry: CachedPlaylistTracks = { ...page, tracks: page.tracks.map(toCachedTrack), savedAt: now };
  const write = async () => {
    const next = keepMostRecent({ ...(await getEntries()), [cacheKey(source, playlistId)]: entry });
    entriesPromise = Promise.resolve(next);
    try {
      await indexedDBStorage.setSetting(STORAGE_KEY, JSON.stringify({ entries: next }));
    } catch (e) {
      logger.error('[PlaylistTracksCache] save failed:', e);
    }
  };
  writeQueue = writeQueue.then(write, write);
  return writeQueue;
}
