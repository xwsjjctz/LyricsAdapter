import { describe, expect, it } from 'vitest';
import { buildSettingsRecoverySnapshot, resolveUserDataLibrary } from '@/hooks/useLibraryLoad';

describe('useLibraryLoad user-data authority policy', () => {
  const staleCache = {
    songs: [{
      id: 'deleted-track',
      title: 'Deleted',
      artist: 'Artist',
      album: 'Album',
      duration: 10,
      fileName: 'deleted.mp3',
      filePath: '/music/deleted.mp3',
    }],
    settings: { activeSlotId: 'local' as const },
  };

  it('treats a schema-marked empty users library as authoritative over stale cache', () => {
    const decision = resolveUserDataLibrary({
      schemaVersion: 1,
      libraryInitialized: true,
      tracks: [],
      settings: {},
      playback: {},
    }, staleCache.settings, {}, staleCache);

    expect(decision.kind).toBe('initialized-empty');
    expect(decision.data?.songs).toEqual([]);
  });

  it('allows cache seeding only for an explicit migration-pending snapshot', () => {
    const decision = resolveUserDataLibrary({
      schemaVersion: 1,
      libraryInitialized: false,
      tracks: [],
      settings: {},
      playback: {},
    }, staleCache.settings, {}, staleCache);

    expect(decision).toEqual({ kind: 'migration-pending', data: null });
  });

  it('does not invent recovery data from an empty users snapshot', () => {
    expect(buildSettingsRecoverySnapshot({
      schemaVersion: 1,
      libraryInitialized: false,
      tracks: [],
      settings: {},
      playback: {},
    })).toEqual({});
  });
});
