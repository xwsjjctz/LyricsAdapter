// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  repository: {
    databasePath: '/virtual-home/.la/state.sqlite3',
    initialize: vi.fn(),
    loadUserData: vi.fn(),
    saveUserData: vi.fn(),
    saveTracks: vi.fn(),
    commitLibraryState: vi.fn(),
    saveSettings: vi.fn(),
    setPlayback: vi.fn(),
  },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../electron/services/userStateRepository', () => ({
  userStateRepository: mocks.repository,
}));
vi.mock('../../electron/logger', () => ({ logger: mocks.logger }));

import { userDataStore, type UserDataFile } from '../../electron/services/userDataStore';

const snapshot: UserDataFile = {
  schemaVersion: 1,
  libraryInitialized: true,
  tracks: [
    { id: 'local-1', slotId: 'local', filePath: '/music/1.flac' },
    { id: 'cloud-1', slotId: 'cloud', webdavPath: '/cloud/1.flac' },
  ],
  settings: { 'app-theme': 'default-dark' },
  playback: { _json: '{"activeSlotId":"cloud"}' },
};

describe('UserDataStore SQLite compatibility facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repository.loadUserData.mockReturnValue(structuredClone(snapshot));
  });

  it('preserves the versioned snapshot read surface and exposes the SQLite path', () => {
    expect(userDataStore.load()).toEqual(snapshot);
    expect(userDataStore.getFilePath()).toBe('/virtual-home/.la/state.sqlite3');
  });

  it('delegates full and partial writes to repository transactions', () => {
    const tracks = [{ id: 'playlist-1', slotId: 'playlist' as const }];
    const playback = { _json: '{"activeSlotId":"playlist"}' };
    const settings = { 'app-theme': 'default-light' };

    expect(userDataStore.save(snapshot)).toBe(true);
    expect(userDataStore.saveTracks(tracks)).toBe(true);
    expect(userDataStore.saveLibraryState(tracks, playback)).toBe(true);
    expect(userDataStore.saveSettings(settings)).toBe(true);
    expect(userDataStore.savePlayback(playback)).toBe(true);

    expect(mocks.repository.saveUserData).toHaveBeenCalledWith(snapshot);
    expect(mocks.repository.saveTracks).toHaveBeenCalledWith(tracks);
    expect(mocks.repository.commitLibraryState).toHaveBeenCalledWith(
      tracks,
      playback,
    );
    expect(mocks.repository.saveSettings).toHaveBeenCalledWith(settings);
    expect(mocks.repository.setPlayback).toHaveBeenCalledWith(playback);
  });

  it('keeps the legacy migration hook as idempotent repository initialization', () => {
    userDataStore.migrateFromLegacy();

    expect(mocks.repository.initialize).toHaveBeenCalledOnce();
  });

  it.each([
    ['save', () => userDataStore.save(snapshot), 'saveUserData'],
    ['saveTracks', () => userDataStore.saveTracks([]), 'saveTracks'],
    ['saveLibraryState', () => userDataStore.saveLibraryState([], {}), 'commitLibraryState'],
    ['saveSettings', () => userDataStore.saveSettings({}), 'saveSettings'],
    ['savePlayback', () => userDataStore.savePlayback({}), 'setPlayback'],
  ] as const)('reports false when %s cannot commit', (_name, invoke, method) => {
    mocks.repository[method].mockImplementationOnce(() => {
      throw new Error('database write failed');
    });

    expect(invoke()).toBe(false);
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});
