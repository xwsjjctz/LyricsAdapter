import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySlot, type Track } from '@/types';

const mocks = vi.hoisted(() => ({
  loadBootstrap: vi.fn(), initialize: vi.fn(), getMetadata: vi.fn(),
  saveLibraryDebounced: vi.fn(),
}));
vi.mock('@/repositories/libraryPersistenceRepository', () => ({
  libraryPersistenceRepository: { loadBootstrap: mocks.loadBootstrap },
}));
vi.mock('@/services/metadataCacheService', () => ({
  metadataCacheService: { initialize: mocks.initialize, get: mocks.getMetadata },
}));
vi.mock('@/services/libraryStorage', () => ({ libraryStorage: {
  saveLibraryDebounced: mocks.saveLibraryDebounced,
  validateAllPaths: vi.fn().mockResolvedValue([]),
} }));
vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => null, getDesktopAPIAsync: async () => null, isDesktop: () => false,
}));
import { useLibraryLoad } from '@/hooks/useLibraryLoad';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadBootstrap.mockResolvedValue({ desktop: false, libraryData: {
    songs: [{ id: 'cached', title: 'cached', fileName: 'cached.mp3', filePath: '/cached.mp3' }], settings: {},
  } });
  mocks.initialize.mockResolvedValue(undefined);
  mocks.getMetadata.mockReturnValue({ title: 'Restored title', artist: 'Restored artist', album: 'Restored album', duration: 120 });
});
afterEach(cleanup);

function setup() {
  const onSettingsRestored = vi.fn();
  const slots = { local: createEmptySlot('local'), cloud: createEmptySlot('cloud'),
    online: createEmptySlot('online'), playlist: createEmptySlot('playlist') };
  const hook = renderHook(() => {
    const [tracks, setTracks] = useState<Track[]>([]);
    const ready = useLibraryLoad({
      restoreFromPersistence: (_settings, loaded) => setTracks(loaded),
      getPersistenceData: () => ({}), slots, setLocalTracks: setTracks,
      loadCloudTracks: vi.fn(), loadOnlineTracks: vi.fn(), loadPlaylistTracks: vi.fn(),
      setIsPlaying: vi.fn(), setVolume: vi.fn(), setPlaybackMode: vi.fn(),
      currentPlaybackTime: 0, updateSlot: vi.fn(), onLibrarySettingsRestored: onSettingsRestored,
    });
    return { ready, tracks };
  });
  return { ...hook, onSettingsRestored };
}

describe('initial library readiness', () => {
  it('stays loading until cached metadata and playback settings have been restored', async () => {
    let resolveCache!: () => void;
    mocks.initialize.mockReturnValue(new Promise<void>(resolve => { resolveCache = resolve; }));
    const { result, onSettingsRestored } = setup();
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    expect(result.current.ready).toBe(false);
    expect(result.current.tracks[0]?.title).toBe('cached');
    await act(async () => resolveCache());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.tracks[0]?.title).toBe('Restored title');
    expect(onSettingsRestored).toHaveBeenCalledWith({ activeSlotId: 'local', currentTime: 0 });
  });
  it('releases after cache failure using the persisted library', async () => {
    mocks.initialize.mockRejectedValue(new Error('cache unavailable'));
    mocks.getMetadata.mockReturnValue(undefined);
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.tracks[0]?.title).toBe('cached');
  });
  it('releases after a bootstrap failure without saving an empty replacement library', async () => {
    mocks.loadBootstrap.mockRejectedValue(new Error('storage unavailable'));
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(mocks.saveLibraryDebounced).not.toHaveBeenCalled();
  });
});
