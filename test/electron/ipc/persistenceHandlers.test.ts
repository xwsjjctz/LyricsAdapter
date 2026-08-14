import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, payload?: unknown) => unknown;

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
    },
    settingsStore: {
      get: vi.fn(),
      getAll: vi.fn(),
      set: vi.fn(),
      setMany: vi.fn(),
      delete: vi.fn(),
      replaceAll: vi.fn(),
      getDirectoryPath: vi.fn(() => '/tmp/.la'),
      initialize: vi.fn(),
    },
    userDataStore: {
      migrateFromLegacy: vi.fn(),
      load: vi.fn(),
      save: vi.fn(),
      saveTracks: vi.fn(),
      saveLibraryState: vi.fn(),
      getFilePath: vi.fn(() => '/tmp/.la/users.json'),
    },
  };
});

vi.mock('electron', () => ({ ipcMain: mocks.ipcMain }));
vi.mock('../../../electron/services/settingsStore', () => ({ settingsStore: mocks.settingsStore }));
vi.mock('../../../electron/services/userDataStore', () => ({ userDataStore: mocks.userDataStore }));
vi.mock('../../../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerSettingsHandlers } from '../../../electron/ipc/settingsHandlers';
import { registerUserDataHandlers } from '../../../electron/ipc/userDataHandlers';

function invoke(channel: string, payload?: unknown): unknown {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler: ${channel}`);
  return handler({}, payload);
}

describe('persistence IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.settingsStore.get.mockReturnValue(undefined);
    mocks.settingsStore.getAll.mockReturnValue({});
    mocks.settingsStore.set.mockReturnValue(true);
    mocks.settingsStore.setMany.mockReturnValue(true);
    mocks.settingsStore.delete.mockReturnValue(true);
    mocks.settingsStore.replaceAll.mockReturnValue(true);
    mocks.userDataStore.load.mockReturnValue({
      schemaVersion: 1,
      libraryInitialized: true,
      tracks: [],
      settings: {},
      playback: {},
    });
    mocks.userDataStore.save.mockReturnValue(true);
    mocks.userDataStore.saveTracks.mockReturnValue(true);
    mocks.userDataStore.saveLibraryState.mockReturnValue(true);
  });

  it('returns typed settings envelopes while preserving legacy raw channels', () => {
    mocks.settingsStore.get.mockReturnValue('default-dark');
    mocks.settingsStore.getAll.mockReturnValue({ 'app-theme': 'default-dark' });
    registerSettingsHandlers();

    expect(invoke('ipc:settings:get', { key: 'app-theme' })).toEqual({ ok: true, data: 'default-dark' });
    expect(invoke('ipc:settings:getAll')).toEqual({ ok: true, data: { 'app-theme': 'default-dark' } });
    expect(invoke('settings:get', 'app-theme')).toBe('default-dark');
    expect(invoke('settings:getAll')).toEqual({ 'app-theme': 'default-dark' });
  });

  it('validates typed settings writes and reports durable write failures', () => {
    registerSettingsHandlers();

    expect(invoke('ipc:settings:set', { key: '', value: 'invalid' })).toMatchObject({ ok: false });
    expect(mocks.settingsStore.set).not.toHaveBeenCalled();

    expect(invoke('ipc:settings:set', { key: 'app-theme', value: 'default-light' })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.settingsStore.set).toHaveBeenCalledWith('app-theme', 'default-light');

    mocks.settingsStore.set.mockReturnValue(false);
    expect(invoke('ipc:settings:set', { key: 'app-theme', value: 'default-dark' })).toEqual({
      ok: false,
      error: 'Failed to persist settings',
    });
  });

  it('returns typed user-data envelopes while preserving legacy raw channels', () => {
    const snapshot = {
      schemaVersion: 1,
      libraryInitialized: true,
      tracks: [{ id: 'track-1', slotId: 'local' }],
      settings: { 'app-language': 'zh' },
      playback: { _json: '{}' },
    };
    mocks.userDataStore.load.mockReturnValue(snapshot);
    registerUserDataHandlers();

    expect(invoke('ipc:userData:load')).toEqual({ ok: true, data: snapshot });
    expect(invoke('userData:load')).toEqual(snapshot);
  });

  it('validates user-data writes and reports durable write failures', () => {
    registerUserDataHandlers();
    const snapshot = {
      schemaVersion: 1,
      libraryInitialized: true,
      tracks: [{ id: 'track-1' }],
      settings: {},
      playback: {},
    };

    expect(invoke('ipc:userData:save', { data: snapshot })).toEqual({ ok: true, data: undefined });
    expect(mocks.userDataStore.save).toHaveBeenCalledWith(snapshot);

    mocks.userDataStore.save.mockReturnValue(false);
    expect(invoke('ipc:userData:save', { data: snapshot })).toEqual({
      ok: false,
      error: 'Failed to persist user data',
    });
    expect(invoke('ipc:userData:save', { data: { tracks: [{}], settings: {}, playback: {} } })).toMatchObject({ ok: false });
  });

  it('atomically persists tracks and playback without replacing user settings', () => {
    registerUserDataHandlers();
    const tracks = [{ id: 'track-1', slotId: 'local' }];
    const playback = { _json: '{"volume":0.5}' };

    expect(invoke('ipc:userData:saveLibraryState', { tracks, playback })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(mocks.userDataStore.saveLibraryState).toHaveBeenCalledWith(tracks, playback);
    expect(mocks.settingsStore.getAll).not.toHaveBeenCalled();
  });
});
