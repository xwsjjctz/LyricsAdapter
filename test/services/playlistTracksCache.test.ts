import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/services/indexedDBStorage', () => ({
  indexedDBStorage: {
    getSetting: vi.fn(async (key: string) => mocks.store.get(key) ?? null),
    setSetting: vi.fn(async (key: string, value: string) => { mocks.store.set(key, value); }),
  },
}));
vi.mock('@/services/logger', () => ({ logger: mocks.logger }));

const track = (n: number, extra: Partial<Track> = {}): Track => ({
  id: `online-qq-${n}`,
  title: `Song ${n}`,
  artist: 'Artist',
  album: 'Album',
  duration: 200,
  coverUrl: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${n}.jpg`,
  audioUrl: '',
  source: 'qq',
  songmid: String(n),
  ...extra,
});

async function freshModule() {
  vi.resetModules();
  return import('@/services/playlistTracksCache');
}

describe('playlistTracksCache', () => {
  beforeEach(() => {
    mocks.store.clear();
    vi.clearAllMocks();
  });

  it('persists loaded pages across module instances (app restarts)', async () => {
    const first = await freshModule();
    await first.savePlaylistTracks('qq', '42', {
      tracks: [track(1), track(2)], nextOffset: 30, hasMore: true, totalTrackCount: 651,
    }, 1_000);

    const second = await freshModule();
    const cached = await second.loadPlaylistTracks('qq', '42');
    expect(cached).toMatchObject({ nextOffset: 30, hasMore: true, totalTrackCount: 651, savedAt: 1_000 });
    expect(cached?.tracks.map(t => t.id)).toEqual(['online-qq-1', 'online-qq-2']);
    expect(await second.loadPlaylistTracks('netease', '42')).toBeNull();
  });

  it('drops lyrics and runtime-only fields before persisting', async () => {
    const cache = await freshModule();
    await cache.savePlaylistTracks('qq', '42', {
      tracks: [track(1, { lyrics: 'la', syncedLyrics: [{ time: 0, text: 'la' }], audioUrl: 'blob:x' })],
      nextOffset: 1, hasMore: false, totalTrackCount: 1,
    });
    const [saved] = (await (await freshModule()).loadPlaylistTracks('qq', '42'))!.tracks;
    expect(saved).not.toHaveProperty('lyrics');
    expect(saved).not.toHaveProperty('syncedLyrics');
    expect(saved?.audioUrl).toBe('');
    expect(saved?.coverUrl).toContain('gtimg');
  });

  it('keeps only the most recently saved playlists', async () => {
    const cache = await freshModule();
    for (let i = 0; i < cache.MAX_CACHED_PLAYLISTS + 2; i++) {
      await cache.savePlaylistTracks('qq', `p${i}`, { tracks: [track(i)], nextOffset: 1, hasMore: false, totalTrackCount: 1 }, i);
    }
    const reloaded = await freshModule();
    expect(await reloaded.loadPlaylistTracks('qq', 'p0')).toBeNull();
    expect(await reloaded.loadPlaylistTracks('qq', 'p1')).toBeNull();
    expect(await reloaded.loadPlaylistTracks('qq', `p${cache.MAX_CACHED_PLAYLISTS + 1}`)).not.toBeNull();
  });

  it('treats entries older than the freshness window as stale', async () => {
    const cache = await freshModule();
    const entry = { tracks: [], nextOffset: 0, hasMore: false, totalTrackCount: 0, savedAt: 0 };
    expect(cache.isPlaylistTracksFresh(entry, cache.PLAYLIST_TRACKS_FRESH_MS - 1)).toBe(true);
    expect(cache.isPlaylistTracksFresh(entry, cache.PLAYLIST_TRACKS_FRESH_MS + 1)).toBe(false);
  });

  it('ignores corrupt storage instead of throwing', async () => {
    mocks.store.set('playlist-tracks-cache', '{not json');
    const cache = await freshModule();
    await expect(cache.loadPlaylistTracks('qq', '42')).resolves.toBeNull();
  });
});
