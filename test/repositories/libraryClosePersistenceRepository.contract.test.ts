import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistenceCloseCommitResult } from '@/types/typedIpc';

const mocks = vi.hoisted(() => ({
  isDesktop: vi.fn(),
  getDesktopAPIAsync: vi.fn(),
  setItem: vi.fn(),
  flushPendingSave: vi.fn(),
}));

vi.mock('@/services/desktopAdapter', () => ({
  isDesktop: mocks.isDesktop,
  getDesktopAPIAsync: mocks.getDesktopAPIAsync,
}));

vi.mock('@/services/appStorage', () => ({
  appStorage: { setItem: mocks.setItem },
}));

vi.mock('@/services/libraryStorage', () => ({
  libraryStorage: { flushPendingSave: mocks.flushPendingSave },
}));

vi.mock('@/services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { libraryClosePersistenceRepository } from '@/repositories/libraryClosePersistenceRepository';

const libraryIndex = {
  songs: [{ id: 'local-1', title: 'Local', artist: 'Artist', album: 'Album', duration: 1 }],
  cloudSongs: [{ id: 'cloud-1', title: 'Cloud', artist: 'Artist', album: 'Album', duration: 1 }],
  onlineSongs: [{ id: 'online-1', title: 'Online', artist: 'Artist', album: 'Album', duration: 1 }],
  playlistSongs: [{ id: 'playlist-1', title: 'Playlist', artist: 'Artist', album: 'Album', duration: 1 }],
  settings: { activeSlotId: 'online' as const, onlineSlot: { currentTime: 17 } },
};

const userTracks = [
  { id: 'local-1', slotId: 'local' as const },
  { id: 'cloud-1', slotId: 'cloud' as const },
  { id: 'online-1', slotId: 'online' as const },
  { id: 'playlist-1', slotId: 'playlist' as const },
];

const savedResult: PersistenceCloseCommitResult = {
  fullyPersisted: true,
  settings: { status: 'saved' },
  userData: { status: 'saved' },
  libraryIndex: { status: 'saved' },
};

const partialResult: PersistenceCloseCommitResult = {
  fullyPersisted: false,
  settings: { status: 'saved' },
  userData: { status: 'error', error: 'users failed' },
  libraryIndex: { status: 'saved' },
};

describe('LibraryClosePersistenceRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDesktop.mockReturnValue(true);
    mocks.setItem.mockResolvedValue(undefined);
    mocks.flushPendingSave.mockResolvedValue(true);
  });

  it('commits one typed desktop snapshot with all four slot records', async () => {
    const persistenceCommitClose = vi.fn().mockResolvedValue(savedResult);
    mocks.getDesktopAPIAsync.mockResolvedValue({ persistenceCommitClose });

    await expect(libraryClosePersistenceRepository.commit({
      libraryIndex,
      userTracks,
      userDataWritable: true,
    })).resolves.toBe(true);

    expect(persistenceCommitClose).toHaveBeenCalledTimes(1);
    expect(persistenceCommitClose).toHaveBeenCalledWith({
      libraryIndex,
      userData: { mode: 'write', tracks: userTracks },
    });
    expect(mocks.setItem).not.toHaveBeenCalled();
    expect(mocks.flushPendingSave).not.toHaveBeenCalled();
  });

  it('does not hide an authoritative partial result behind legacy fallback writes', async () => {
    const userDataSaveLibraryState = vi.fn();
    const persistenceCommitClose = vi.fn().mockResolvedValue(partialResult);
    mocks.getDesktopAPIAsync.mockResolvedValue({
      persistenceCommitClose,
      userDataSaveLibraryState,
    });

    await expect(libraryClosePersistenceRepository.commit({
      libraryIndex,
      userTracks,
      userDataWritable: true,
    })).resolves.toBe(false);

    expect(mocks.setItem).not.toHaveBeenCalled();
    expect(userDataSaveLibraryState).not.toHaveBeenCalled();
    expect(mocks.flushPendingSave).not.toHaveBeenCalled();
  });

  it.each([
    ['missing typed capability', undefined],
    ['outer handler rejection', vi.fn().mockRejectedValue(new Error('handler rejected'))],
  ])('uses the three legacy writes for %s', async (_label, typedCommit) => {
    const userDataSaveLibraryState = vi.fn().mockResolvedValue(undefined);
    mocks.getDesktopAPIAsync.mockResolvedValue({
      ...(typedCommit ? { persistenceCommitClose: typedCommit } : {}),
      userDataSaveLibraryState,
    });

    await expect(libraryClosePersistenceRepository.commit({
      libraryIndex,
      userTracks,
      userDataWritable: true,
    })).resolves.toBe(true);

    expect(mocks.setItem).toHaveBeenCalledWith('playback', JSON.stringify(libraryIndex.settings));
    expect(userDataSaveLibraryState).toHaveBeenCalledWith(userTracks, {
      _json: JSON.stringify(libraryIndex.settings),
    });
    expect(mocks.flushPendingSave).toHaveBeenCalledWith(libraryIndex);
  });

  it('uses skip and remains unsuccessful while user-data writes are disabled', async () => {
    const persistenceCommitClose = vi.fn().mockResolvedValue({
      ...savedResult,
      fullyPersisted: false,
      userData: { status: 'skipped' as const, reason: 'recovery mode' },
    });
    mocks.getDesktopAPIAsync.mockResolvedValue({ persistenceCommitClose });

    await expect(libraryClosePersistenceRepository.commit({
      libraryIndex,
      userTracks,
      userDataWritable: false,
    })).resolves.toBe(false);

    expect(persistenceCommitClose).toHaveBeenCalledWith({
      libraryIndex,
      userData: { mode: 'skip' },
    });
    expect(mocks.setItem).not.toHaveBeenCalled();
    expect(mocks.flushPendingSave).not.toHaveBeenCalled();
  });

  it('retains the browser best-effort settings and cache writes', async () => {
    mocks.isDesktop.mockReturnValue(false);

    await expect(libraryClosePersistenceRepository.commit({
      libraryIndex,
      userTracks,
      userDataWritable: false,
    })).resolves.toBe(true);

    expect(mocks.getDesktopAPIAsync).not.toHaveBeenCalled();
    expect(mocks.setItem).toHaveBeenCalledWith('playback', JSON.stringify(libraryIndex.settings));
    expect(mocks.flushPendingSave).toHaveBeenCalledWith(libraryIndex);
  });
});
