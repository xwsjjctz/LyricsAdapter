import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

interface PersistenceIpcFixture {
  persistence?: {
    loadBootstrap?: ReturnType<typeof vi.fn>;
    commitClose?: ReturnType<typeof vi.fn>;
  };
  settings?: {
    get?: ReturnType<typeof vi.fn>;
    getAll?: ReturnType<typeof vi.fn>;
    set?: ReturnType<typeof vi.fn>;
  };
  userData?: {
    load?: ReturnType<typeof vi.fn>;
    save?: ReturnType<typeof vi.fn>;
    saveLibraryState?: ReturnType<typeof vi.fn>;
  };
}

async function createAdapter(ipc: PersistenceIpcFixture) {
  vi.resetModules();
  Object.defineProperty(window, 'electron', {
    value: { platform: 'test', ipc },
    configurable: true,
    writable: true,
  });
  const { getDesktopAPI } = await import('@/services/desktopAdapter');
  const adapter = getDesktopAPI();
  expect(adapter).not.toBeNull();
  return adapter!;
}

describe('desktopAdapter persistence IPC compatibility', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electron');
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electron');
    vi.resetModules();
  });

  it('temporarily accepts raw values from a stale preload during migration', async () => {
    const userData = {
      tracks: [{ id: 'track-1' }],
      settings: { 'app-language': 'zh' },
      playback: { _json: '{"volume":0.5}' },
    };
    const adapter = await createAdapter({
      settings: {
        get: vi.fn().mockResolvedValue('default-dark'),
        getAll: vi.fn().mockResolvedValue({ 'app-theme': 'default-dark' }),
      },
      userData: {
        load: vi.fn().mockResolvedValue(userData),
      },
    });

    await expect(adapter.settingsGet?.('app-theme')).resolves.toBe('default-dark');
    await expect(adapter.settingsGetAll?.()).resolves.toEqual({ 'app-theme': 'default-dark' });
    await expect(adapter.userDataLoad?.()).resolves.toEqual({
      schemaVersion: 1,
      libraryInitialized: true,
      ...userData,
    });
  });

  it('uses the shared migration-pending rule for an empty pre-v1 raw snapshot', async () => {
    const adapter = await createAdapter({
      userData: {
        load: vi.fn().mockResolvedValue({ tracks: [], settings: {}, playback: {} }),
      },
    });

    await expect(adapter.userDataLoad?.()).resolves.toMatchObject({
      schemaVersion: 1,
      libraryInitialized: false,
      tracks: [],
    });
  });

  it('unwraps successful IpcResult values from typed handlers', async () => {
    const userData = {
      schemaVersion: 1 as const,
      libraryInitialized: true,
      tracks: [],
      settings: { 'app-language': 'en' },
      playback: {},
    };
    const adapter = await createAdapter({
      settings: {
        get: vi.fn().mockResolvedValue({ ok: true, data: 'default-light' }),
        getAll: vi.fn().mockResolvedValue({ ok: true, data: { 'app-theme': 'default-light' } }),
      },
      userData: {
        load: vi.fn().mockResolvedValue({ ok: true, data: userData }),
      },
    });

    await expect(adapter.settingsGet?.('app-theme')).resolves.toBe('default-light');
    await expect(adapter.settingsGetAll?.()).resolves.toEqual({ 'app-theme': 'default-light' });
    await expect(adapter.userDataLoad?.()).resolves.toEqual(userData);
  });

  it('rejects failed IpcResult reads so empty data is not confused with an IPC failure', async () => {
    const adapter = await createAdapter({
      settings: {
        get: vi.fn().mockResolvedValue({ ok: false, error: 'read failed' }),
        getAll: vi.fn().mockResolvedValue({ ok: false, error: 'read failed' }),
      },
      userData: {
        load: vi.fn().mockResolvedValue({ ok: false, error: 'read failed' }),
      },
    });

    await expect(adapter.settingsGet?.('app-theme')).rejects.toThrow('read failed');
    await expect(adapter.settingsGetAll?.()).rejects.toThrow('read failed');
    await expect(adapter.userDataLoad?.()).rejects.toThrow('read failed');
  });

  it('unwraps the aggregate typed bootstrap and rejects its outer IpcResult failure', async () => {
    const bootstrap = {
      settings: { status: 'ready' as const, data: { 'app-theme': 'default-dark' } },
      userData: {
        status: 'ready' as const,
        data: {
          schemaVersion: 1 as const,
          libraryInitialized: true,
          tracks: [],
          settings: {},
          playback: {},
        },
      },
      libraryIndex: { status: 'ready' as const, data: { songs: [], settings: {} } },
    };
    const loadBootstrap = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: bootstrap })
      .mockResolvedValueOnce({ ok: false, error: 'bootstrap failed' });
    const adapter = await createAdapter({ persistence: { loadBootstrap } });

    await expect(adapter.persistenceLoadBootstrap?.()).resolves.toBe(bootstrap);
    await expect(adapter.persistenceLoadBootstrap?.()).rejects.toThrow('bootstrap failed');
  });

  it('unwraps the aggregate bootstrap without merging its independent source results', async () => {
    const bootstrap = {
      settings: { status: 'ready' as const, data: { 'app-theme': 'default-dark' } },
      userData: {
        status: 'error' as const,
        error: 'users corrupt',
      },
      libraryIndex: {
        status: 'ready' as const,
        data: { songs: [], settings: {} },
      },
    };
    const adapter = await createAdapter({
      persistence: {
        loadBootstrap: vi.fn().mockResolvedValue({ ok: true, data: bootstrap }),
      },
    });

    await expect(adapter.persistenceLoadBootstrap?.()).resolves.toBe(bootstrap);
  });

  it('unwraps close commit results and rejects only the outer IPC failure', async () => {
    const request = {
      libraryIndex: { songs: [], settings: { activeSlotId: 'local' } },
      userData: { mode: 'write' as const, tracks: [] },
    };
    const partialResult = {
      fullyPersisted: false,
      settings: { status: 'saved' as const },
      userData: { status: 'error' as const, error: 'users failed' },
      libraryIndex: { status: 'saved' as const },
    };
    const commitClose = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: partialResult })
      .mockResolvedValueOnce({ ok: false, error: 'handler rejected' });
    const adapter = await createAdapter({ persistence: { commitClose } });

    await expect(adapter.persistenceCommitClose?.(request)).resolves.toBe(partialResult);
    await expect(adapter.persistenceCommitClose?.(request)).rejects.toThrow('handler rejected');
    expect(commitClose).toHaveBeenNthCalledWith(1, request);
  });

  it('rejects failed typed writes instead of silently reporting success', async () => {
    const adapter = await createAdapter({
      settings: {
        set: vi.fn().mockResolvedValue({ ok: false, error: 'disk full' }),
      },
      userData: {
        save: vi.fn().mockResolvedValue({ ok: false, error: 'permission denied' }),
      },
    });

    await expect(adapter.settingsSet?.('app-theme', 'default-dark')).rejects.toThrow('disk full');
    await expect(adapter.userDataSave?.({
      schemaVersion: 1,
      libraryInitialized: true,
      tracks: [],
      settings: {},
      playback: {},
    })).rejects.toThrow('permission denied');
  });

  it('keeps raw void writes compatible with a stale preload for one migration window', async () => {
    const settingsSet = vi.fn().mockResolvedValue(undefined);
    const userDataSave = vi.fn().mockResolvedValue(undefined);
    const adapter = await createAdapter({
      settings: { set: settingsSet },
      userData: { save: userDataSave },
    });
    const snapshot = {
      schemaVersion: 1 as const,
      libraryInitialized: true,
      tracks: [],
      settings: {},
      playback: {},
    };

    await expect(adapter.settingsSet?.('app-theme', 'default-dark')).resolves.toBeUndefined();
    await expect(adapter.userDataSave?.(snapshot)).resolves.toBeUndefined();
    expect(settingsSet).toHaveBeenCalledWith('app-theme', 'default-dark');
    expect(userDataSave).toHaveBeenCalledWith(snapshot);
  });

  it('fails closed when a persistence capability is absent', async () => {
    const adapter = await createAdapter({});

    await expect(adapter.settingsGetAll?.()).rejects.toThrow('settings.getAll API is unavailable');
    await expect(adapter.settingsSet?.('app-theme', 'default-dark')).rejects.toThrow('settings.set API is unavailable');
    await expect(adapter.userDataLoad?.()).rejects.toThrow('userData.load API is unavailable');
    await expect(adapter.userDataSaveLibraryState?.([], {})).rejects.toThrow('saveLibraryState API is unavailable');
    await expect(adapter.persistenceLoadBootstrap?.()).rejects.toThrow('persistence.loadBootstrap API is unavailable');
    await expect(adapter.persistenceCommitClose?.({
      libraryIndex: { songs: [], settings: {} },
      userData: { mode: 'skip' },
    })).rejects.toThrow('persistence.commitClose API is unavailable');
  });
});
