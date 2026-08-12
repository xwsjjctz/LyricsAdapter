import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistenceBootstrap, UserDataSnapshot } from '@/types/typedIpc';

const mocks = vi.hoisted(() => ({
  isDesktop: vi.fn(),
  getDesktopAPIAsync: vi.fn(),
  loadLibrary: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/desktopAdapter', () => ({
  isDesktop: mocks.isDesktop,
  getDesktopAPIAsync: mocks.getDesktopAPIAsync,
}));

vi.mock('@/services/libraryStorage', () => ({
  libraryStorage: { loadLibrary: mocks.loadLibrary },
}));

vi.mock('@/services/logger', () => ({ logger: mocks.logger }));

import { libraryPersistenceRepository } from '@/repositories/libraryPersistenceRepository';

const settings = { 'app-theme': 'default-dark' };
const initializedEmptyUserData: UserDataSnapshot = {
  schemaVersion: 1,
  libraryInitialized: true,
  tracks: [],
  settings: {},
  playback: {},
};
const nonEmptyLibraryCache = {
  songs: [{
    id: 'stale-cache-track',
    title: 'Stale cache track',
    artist: 'Artist',
    album: 'Album',
    duration: 1,
  }],
  settings: { activeSlotId: 'local' as const },
};

function successfulBootstrap(): PersistenceBootstrap {
  return {
    settings: { status: 'ready', data: settings },
    userData: { status: 'ready', data: initializedEmptyUserData },
    libraryIndex: { status: 'ready', data: nonEmptyLibraryCache },
  };
}

describe('renderer LibraryPersistenceRepository contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDesktop.mockReturnValue(true);
    mocks.loadLibrary.mockResolvedValue(nonEmptyLibraryCache);
  });

  it('passes through all three unified desktop sources without merging initialized-empty user data', async () => {
    const persistenceLoadBootstrap = vi.fn().mockResolvedValue(successfulBootstrap());
    const settingsGetAll = vi.fn();
    const userDataLoad = vi.fn();
    mocks.getDesktopAPIAsync.mockResolvedValue({
      persistenceLoadBootstrap,
      settingsGetAll,
      userDataLoad,
    });

    const result = await libraryPersistenceRepository.loadBootstrap();

    expect(result.desktop).toBe(true);
    expect(result.libraryData).toBe(nonEmptyLibraryCache);
    expect(result.settingsResult).toEqual({ status: 'fulfilled', value: settings });
    expect(result.userDataResult).toEqual({ status: 'fulfilled', value: initializedEmptyUserData });
    if (result.userDataResult.status === 'fulfilled') {
      expect(result.userDataResult.value).toBe(initializedEmptyUserData);
      expect(result.userDataResult.value.tracks).toEqual([]);
    }
    expect(persistenceLoadBootstrap).toHaveBeenCalledTimes(1);
    expect(mocks.loadLibrary).not.toHaveBeenCalled();
    expect(settingsGetAll).not.toHaveBeenCalled();
    expect(userDataLoad).not.toHaveBeenCalled();
  });

  it.each([
    {
      source: 'settings',
      bootstrap: {
        ...successfulBootstrap(),
        settings: { status: 'error' as const, error: 'settings corrupt' },
      },
      assertFailure: (result: Awaited<ReturnType<typeof libraryPersistenceRepository.loadBootstrap>>) => {
        expect(result.settingsResult.status).toBe('rejected');
        expect(result.settingsResult.status === 'rejected' && result.settingsResult.reason).toMatchObject({ message: 'settings corrupt' });
        expect(result.userDataResult).toEqual({ status: 'fulfilled', value: initializedEmptyUserData });
        expect(result.libraryData).toBe(nonEmptyLibraryCache);
      },
    },
    {
      source: 'userData',
      bootstrap: {
        ...successfulBootstrap(),
        userData: { status: 'error' as const, error: 'users corrupt' },
      },
      assertFailure: (result: Awaited<ReturnType<typeof libraryPersistenceRepository.loadBootstrap>>) => {
        expect(result.userDataResult.status).toBe('rejected');
        expect(result.userDataResult.status === 'rejected' && result.userDataResult.reason).toMatchObject({ message: 'users corrupt' });
        expect(result.settingsResult).toEqual({ status: 'fulfilled', value: settings });
        expect(result.libraryData).toBe(nonEmptyLibraryCache);
      },
    },
    {
      source: 'libraryIndex',
      bootstrap: {
        ...successfulBootstrap(),
        libraryIndex: { status: 'error' as const, error: 'cache corrupt' },
      },
      assertFailure: (result: Awaited<ReturnType<typeof libraryPersistenceRepository.loadBootstrap>>) => {
        expect(result.libraryData).toEqual({ songs: [], settings: {} });
        expect(result.settingsResult).toEqual({ status: 'fulfilled', value: settings });
        expect(result.userDataResult).toEqual({ status: 'fulfilled', value: initializedEmptyUserData });
      },
    },
  ])('keeps the other unified sources usable when $source fails', async ({ bootstrap, assertFailure }) => {
    mocks.getDesktopAPIAsync.mockResolvedValue({
      persistenceLoadBootstrap: vi.fn().mockResolvedValue(bootstrap),
    });

    assertFailure(await libraryPersistenceRepository.loadBootstrap());
  });

  it('ignores a semantic-invalid ready cache without blocking authoritative user data', async () => {
    mocks.getDesktopAPIAsync.mockResolvedValue({
      persistenceLoadBootstrap: vi.fn().mockResolvedValue({
        ...successfulBootstrap(),
        libraryIndex: { status: 'ready', data: null },
      }),
    });

    const result = await libraryPersistenceRepository.loadBootstrap();

    expect(result.libraryData).toEqual({ songs: [], settings: {} });
    expect(result.settingsResult).toEqual({ status: 'fulfilled', value: settings });
    expect(result.userDataResult).toEqual({ status: 'fulfilled', value: initializedEmptyUserData });
  });

  it.each([
    { mode: 'missing aggregate method', aggregate: undefined },
    { mode: 'rejected aggregate method', aggregate: vi.fn().mockRejectedValue(new Error('stale preload')) },
  ])('falls back to legacy desktop reads for a $mode', async ({ aggregate }) => {
    const settingsGetAll = vi.fn().mockResolvedValue(settings);
    const userDataLoad = vi.fn().mockResolvedValue(initializedEmptyUserData);
    mocks.getDesktopAPIAsync.mockResolvedValue({
      ...(aggregate ? { persistenceLoadBootstrap: aggregate } : {}),
      settingsGetAll,
      userDataLoad,
    });

    const result = await libraryPersistenceRepository.loadBootstrap();

    expect(result).toMatchObject({
      desktop: true,
      libraryData: nonEmptyLibraryCache,
      settingsResult: { status: 'fulfilled', value: settings },
      userDataResult: { status: 'fulfilled', value: initializedEmptyUserData },
    });
    expect(mocks.loadLibrary).toHaveBeenCalledTimes(1);
    expect(settingsGetAll).toHaveBeenCalledTimes(1);
    expect(userDataLoad).toHaveBeenCalledTimes(1);
  });

  it('preserves independent failures in the legacy desktop fallback', async () => {
    const settingsFailure = new Error('legacy settings failed');
    mocks.getDesktopAPIAsync.mockResolvedValue({
      settingsGetAll: vi.fn().mockRejectedValue(settingsFailure),
      userDataLoad: vi.fn().mockResolvedValue(initializedEmptyUserData),
    });

    const result = await libraryPersistenceRepository.loadBootstrap();

    expect(result.libraryData).toBe(nonEmptyLibraryCache);
    expect(result.settingsResult).toEqual({ status: 'rejected', reason: settingsFailure });
    expect(result.userDataResult).toEqual({ status: 'fulfilled', value: initializedEmptyUserData });
  });

  it('still restores the rebuildable cache when acquiring the desktop bridge fails', async () => {
    const bridgeFailure = new Error('desktop bridge failed');
    mocks.getDesktopAPIAsync.mockRejectedValue(bridgeFailure);

    const result = await libraryPersistenceRepository.loadBootstrap();

    expect(result).toMatchObject({
      desktop: true,
      libraryData: nonEmptyLibraryCache,
      settingsResult: { status: 'rejected', reason: bridgeFailure },
      userDataResult: { status: 'rejected', reason: bridgeFailure },
    });
    expect(mocks.getDesktopAPIAsync).toHaveBeenCalledTimes(1);
    expect(mocks.loadLibrary).toHaveBeenCalledTimes(1);
  });

  it('uses only libraryStorage in browser mode and marks desktop sources unavailable', async () => {
    mocks.isDesktop.mockReturnValue(false);

    const result = await libraryPersistenceRepository.loadBootstrap();

    expect(result.desktop).toBe(false);
    expect(result.libraryData).toBe(nonEmptyLibraryCache);
    expect(result.settingsResult.status).toBe('rejected');
    expect(result.userDataResult.status).toBe('rejected');
    expect(mocks.loadLibrary).toHaveBeenCalledTimes(1);
    expect(mocks.getDesktopAPIAsync).not.toHaveBeenCalled();
  });
});
