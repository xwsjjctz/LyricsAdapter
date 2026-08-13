import { describe, expect, it } from 'vitest';
import {
  buildSettingsHydrationPlan,
  buildSettingsRecoverySnapshot,
  buildUserTracksFromLibraryCache,
  hasPersistedTracks,
  resolveUserDataLibrary,
} from '@/domain/library-persistence/reconcilePersistedLibrary';
import { SETTINGS_MIGRATION_VERSION_KEY } from '@/shared/persistencePolicy';
import type { LibraryIndexData, LibraryIndexSong } from '@/services/libraryStorage';
import type { UserDataSnapshot } from '@/types/typedIpc';

const NOW = '2026-01-01T00:00:00.000Z';
const timestamp = () => NOW;

function song(id: string, overrides: Partial<LibraryIndexSong> = {}): LibraryIndexSong {
  return {
    id,
    title: `Title ${id}`,
    artist: `Artist ${id}`,
    album: `Album ${id}`,
    duration: 100,
    ...overrides,
  };
}

function userData(overrides: Partial<UserDataSnapshot> = {}): UserDataSnapshot {
  return {
    schemaVersion: 1,
    libraryInitialized: true,
    tracks: [],
    settings: {},
    playback: {},
    ...overrides,
  };
}

describe('persistenceReconciler', () => {
  it('uses users membership and order across all four slots without reviving cache-only tracks', () => {
    const cache: LibraryIndexData = {
      songs: [song('local-b'), song('stale-only'), song('local-a')],
      cloudSongs: [song('cloud')],
      onlineSongs: [song('online')],
      playlistSongs: [song('playlist')],
      settings: {},
    };
    const snapshot = userData({
      tracks: [
        { id: 'local-a', slotId: 'local', filePath: '/a.flac', addedAt: NOW },
        { id: 'local-b', slotId: 'local', filePath: '/b.flac', addedAt: NOW },
        { id: 'cloud', slotId: 'cloud', webdavPath: '/cloud.flac', source: 'webdav', addedAt: NOW },
        { id: 'online', slotId: 'online', source: 'qq', songmid: 'qq-1', addedAt: NOW },
        { id: 'playlist', slotId: 'playlist', source: 'netease', songmid: '163-1', addedAt: NOW },
        { id: 'new-without-cache', slotId: 'local', filePath: '/new.flac', addedAt: NOW },
      ],
    });

    const decision = resolveUserDataLibrary(snapshot, {}, {}, cache, timestamp);

    expect(decision.kind).toBe('user-data');
    expect(decision.data?.songs.map(item => item.id)).toEqual(['local-a', 'local-b', 'new-without-cache']);
    expect(decision.data?.cloudSongs?.map(item => item.id)).toEqual(['cloud']);
    expect(decision.data?.onlineSongs?.map(item => item.id)).toEqual(['online']);
    expect(decision.data?.playlistSongs?.map(item => item.id)).toEqual(['playlist']);
    expect([
      ...(decision.data?.songs || []),
      ...(decision.data?.cloudSongs || []),
      ...(decision.data?.onlineSongs || []),
      ...(decision.data?.playlistSongs || []),
    ].some(item => item.id === 'stale-only')).toBe(false);
  });

  it('infers legacy slot membership while an explicit slot remains authoritative', () => {
    const decision = resolveUserDataLibrary(userData({
      tracks: [
        { id: 'dav', source: 'webdav', addedAt: NOW },
        { id: 'qq', source: 'qq', addedAt: NOW },
        { id: 'netease', source: 'netease', addedAt: NOW },
        { id: 'explicit', source: 'qq', slotId: 'playlist', addedAt: NOW },
        { id: 'plain', source: 'local', addedAt: NOW },
      ],
    }), {}, {}, { songs: [], settings: {} }, timestamp);

    expect(decision.data?.songs.map(item => item.id)).toEqual(['plain']);
    expect(decision.data?.cloudSongs?.map(item => item.id)).toEqual(['dav']);
    expect(decision.data?.onlineSongs?.map(item => item.id)).toEqual(['qq', 'netease']);
    expect(decision.data?.playlistSongs?.map(item => item.id)).toEqual(['explicit']);
  });

  it('uses cache only for display metadata while users fields remain authoritative', () => {
    const cached = song('track', {
      title: 'Cached title',
      artist: 'Cached artist',
      album: 'Cached album',
      duration: 123,
      lyrics: 'Cached lyrics',
      syncedLyrics: [{ time: 1, text: 'Cached line' }],
      wordLyrics: 'raw-qrc',
      wordLyricsFormat: 'qrc',
      coverUrl: 'cover://cached',
      filePath: '/stale.flac',
      fileName: 'stale.flac',
      fileSize: 99,
      lastModified: 99,
      addedAt: '2025-01-01T00:00:00.000Z',
      source: 'local',
      playCount: 99,
      lastPlayed: '2025-02-01T00:00:00.000Z',
      available: true,
      songmid: 'stale-songmid',
    });
    const decision = resolveUserDataLibrary(userData({
      tracks: [{
        id: 'track',
        slotId: 'cloud',
        filePath: '/authoritative.flac',
        webdavPath: '/authoritative.flac',
        fileName: 'authoritative.flac',
        fileSize: 0,
        lastModified: 0,
        source: 'webdav',
        addedAt: NOW,
        playCount: 0,
        lastPlayed: null,
        available: false,
        songmid: 'authoritative-songmid',
      }],
    }), {}, {}, { songs: [cached], settings: {} }, timestamp);

    const restored = decision.data?.cloudSongs?.[0];
    expect(restored).toMatchObject({
      title: 'Cached title',
      artist: 'Cached artist',
      album: 'Cached album',
      duration: 123,
      lyrics: 'Cached lyrics',
      syncedLyrics: [{ time: 1, text: 'Cached line' }],
      wordLyrics: 'raw-qrc',
      wordLyricsFormat: 'qrc',
      coverUrl: 'cover://cached',
      filePath: '/authoritative.flac',
      webdavPath: '/authoritative.flac',
      fileName: 'authoritative.flac',
      fileSize: 0,
      lastModified: 0,
      addedAt: NOW,
      source: 'webdav',
      playCount: 0,
      lastPlayed: null,
      available: false,
      songmid: 'authoritative-songmid',
    });
  });

  it.each([
    {
      name: 'user playback snapshot',
      snapshot: userData({
        playback: { _json: JSON.stringify({ volume: 0, activeSlotId: 'online' }) },
        settings: { playback: JSON.stringify({ volume: 0.2 }) },
      }),
      main: { playback: JSON.stringify({ volume: 0.4 }) },
      expected: { volume: 0, activeSlotId: 'online' },
    },
    {
      name: 'main playback',
      snapshot: userData({ settings: { playback: JSON.stringify({ volume: 0.2 }) } }),
      main: { playback: JSON.stringify({ volume: 0.4, activeSlotId: 'cloud' }) },
      expected: { volume: 0.4, activeSlotId: 'cloud' },
    },
    {
      name: 'users settings playback',
      snapshot: userData({ settings: { playback: JSON.stringify({ volume: 0.2 }) } }),
      main: {},
      expected: { volume: 0.2 },
    },
  ])('applies $name over cache settings', ({ snapshot, main, expected }) => {
    const decision = resolveUserDataLibrary(
      snapshot,
      { activeSlotId: 'local', volume: 0.8, autoScroll: true },
      main,
      { songs: [song('track')], settings: {} },
      timestamp,
    );

    expect(decision.data?.settings).toMatchObject({ autoScroll: true, ...expected });
  });

  it('keeps cache fallback settings when the highest-priority playback JSON is malformed', () => {
    const decision = resolveUserDataLibrary(
      userData({
        tracks: [{ id: 'track', addedAt: NOW }],
        playback: { _json: '{invalid' },
      }),
      { volume: 0.8, activeSlotId: 'playlist' },
      { playback: JSON.stringify({ volume: 0.1 }) },
      { songs: [song('track')], settings: {} },
      timestamp,
    );

    expect(decision.data?.settings).toMatchObject({ volume: 0.8, activeSlotId: 'playlist' });
  });

  it('treats initialized empty users as authoritative over stale tracks in all slots', () => {
    const decision = resolveUserDataLibrary(
      userData({ playback: { _json: JSON.stringify({ volume: 0 }) } }),
      { activeSlotId: 'local', volume: 0.5 },
      {},
      {
        songs: [song('local')],
        cloudSongs: [song('cloud')],
        onlineSongs: [song('online')],
        playlistSongs: [song('playlist')],
      },
      timestamp,
    );

    expect(decision.kind).toBe('initialized-empty');
    expect(decision.data).toMatchObject({
      songs: [],
      cloudSongs: [],
      onlineSongs: [],
      playlistSongs: [],
      settings: { activeSlotId: 'local', volume: 0 },
    });
  });

  it('keeps migration pending separate and builds four-slot seed records', () => {
    const cache: LibraryIndexData = {
      songs: [song('local', {
        filePath: '/local.flac',
        lyrics: 'derived',
        playCount: 0,
        lastPlayed: null,
        available: false,
      })],
      cloudSongs: [song('cloud', { source: 'webdav', webdavPath: '/cloud.flac' })],
      onlineSongs: [song('online', { source: 'qq', songmid: 'qq-1' })],
      playlistSongs: [song('playlist', { source: 'netease', songmid: '163-1' })],
      settings: {},
    };
    const pending = userData({ libraryInitialized: false });

    expect(resolveUserDataLibrary(pending, {}, {}, cache, timestamp)).toEqual({
      kind: 'migration-pending',
      data: null,
    });
    const records = buildUserTracksFromLibraryCache(cache);
    expect(records).toEqual([
      expect.objectContaining({ id: 'local', slotId: 'local', filePath: '/local.flac' }),
      expect.objectContaining({ id: 'cloud', slotId: 'cloud', webdavPath: '/cloud.flac' }),
      expect.objectContaining({ id: 'online', slotId: 'online', songmid: 'qq-1' }),
      expect.objectContaining({ id: 'playlist', slotId: 'playlist', songmid: '163-1' }),
    ]);
    expect(records[0]).toMatchObject({ playCount: 0, lastPlayed: null, available: false });
    for (const record of records) {
      expect(record).not.toHaveProperty('title');
      expect(record).not.toHaveProperty('artist');
      expect(record).not.toHaveProperty('album');
      expect(record).not.toHaveProperty('duration');
      expect(record).not.toHaveProperty('lyrics');
      expect(record).not.toHaveProperty('coverUrl');
    }
  });

  it.each([
    ['local', { songs: [song('track')], settings: {} }],
    ['cloud', { songs: [], cloudSongs: [song('track')], settings: {} }],
    ['online', { songs: [], onlineSongs: [song('track')], settings: {} }],
    ['playlist', { songs: [], playlistSongs: [song('track')], settings: {} }],
  ])('detects persisted tracks in the %s slot', (_slot, cache) => {
    expect(hasPersistedTracks(cache)).toBe(true);
  });

  it('returns false when every persisted slot is empty', () => {
    expect(hasPersistedTracks({
      songs: [], cloudSongs: [], onlineSongs: [], playlistSongs: [], settings: {},
    })).toBe(false);
  });

  it('keeps non-empty public main settings authoritative during hydration', () => {
    const plan = buildSettingsHydrationPlan(userData({
      settings: {
        'app-theme': 'from-users',
        'app-language': 'zh',
        unknown: 'must-not-return',
      },
      playback: { _json: JSON.stringify({ volume: 0 }) },
    }), {
      [SETTINGS_MIGRATION_VERSION_KEY]: '1',
      'app-theme': 'from-main',
      playback: JSON.stringify({ volume: 0.8 }),
      'future-setting': 'preserved',
    });

    expect(plan).toEqual({
      settings: {
        'app-theme': 'from-main',
        playback: JSON.stringify({ volume: 0.8 }),
        'future-setting': 'preserved',
      },
      playbackJson: JSON.stringify({ volume: 0 }),
    });
  });

  it('uses main playback before the users settings fallback during hydration', () => {
    const mainPlayback = JSON.stringify({ volume: 0.4 });
    const plan = buildSettingsHydrationPlan(userData({
      settings: { playback: JSON.stringify({ volume: 0.2 }) },
    }), {
      playback: mainPlayback,
    });

    expect(plan.playbackJson).toBe(mainPlayback);
  });

  it('uses only the users allowlist when main contains only the internal marker', () => {
    const plan = buildSettingsHydrationPlan(userData({
      settings: {
        'app-theme': 'from-users',
        'la_new_ux_enabled': 'true',
        unknown: 'must-not-return',
      },
    }), { [SETTINGS_MIGRATION_VERSION_KEY]: '1' });

    expect(plan).toEqual({ settings: { 'app-theme': 'from-users' } });
  });

  it('preserves all durable public settings during recovery and lets playback._json win', () => {
    const playbackJson = JSON.stringify({ volume: 0.3 });
    expect(buildSettingsRecoverySnapshot(userData({
      settings: {
        'app-language': 'en',
        'sidebar-layout': '{"width":220,"collapsed":true}',
        'playlist-overrides': '{"qq:1":{"name":"Saved"}}',
        'future-setting': 'must-survive',
        'webdav-cdn-cache': '{"replaceable":true}',
        playback: JSON.stringify({ volume: 0.9 }),
        'la_new_ux_enabled': 'true',
      },
      playback: { _json: playbackJson },
    }))).toEqual({
      'app-language': 'en',
      'sidebar-layout': '{"width":220,"collapsed":true}',
      'playlist-overrides': '{"qq:1":{"name":"Saved"}}',
      'future-setting': 'must-survive',
      playback: playbackJson,
    });
    expect(buildSettingsRecoverySnapshot(userData())).toEqual({});
  });
});
