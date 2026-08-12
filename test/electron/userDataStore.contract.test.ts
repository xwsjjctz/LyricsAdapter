// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  homedir: vi.fn(),
  readJsonWithBackup: vi.fn(),
  writeJsonAtomic: vi.fn(),
  logger: {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mocks.isEncryptionAvailable,
    encryptString: mocks.encryptString,
    decryptString: mocks.decryptString,
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mocks.existsSync,
    mkdirSync: mocks.mkdirSync,
    readFileSync: vi.fn(),
  },
}));

vi.mock('os', () => ({ default: { homedir: mocks.homedir } }));
vi.mock('../../electron/utils/atomicWrite', () => ({
  readJsonWithBackup: mocks.readJsonWithBackup,
  writeJsonAtomic: mocks.writeJsonAtomic,
}));
vi.mock('../../electron/logger', () => ({ logger: mocks.logger }));

const secrets = {
  'webdav-config': '{"password":"webdav-secret"}',
  'webdav-cdn-cache': '{"signed":"url"}',
  qq_music_cookie: 'qq-secret',
  netease_cookie: 'netease-secret',
  soda_cookie: 'soda-secret',
};

async function loadStore() {
  return (await import('../../electron/services/userDataStore')).userDataStore;
}

describe('UserDataStore persistence contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.homedir.mockReturnValue('/virtual-home');
    mocks.existsSync.mockReturnValue(false);
    mocks.readJsonWithBackup.mockReturnValue(null);
    mocks.writeJsonAtomic.mockImplementation(() => undefined);
    mocks.isEncryptionAvailable.mockReturnValue(true);
    mocks.encryptString.mockImplementation((value: string) => Buffer.from(`sealed:${value}`));
    mocks.decryptString.mockImplementation((buffer: Buffer) => buffer.toString().slice('sealed:'.length));
  });

  it('encrypts sensitive backup settings and round-trips them on load', async () => {
    let diskData: unknown;
    mocks.writeJsonAtomic.mockImplementation((_path: string, data: unknown) => { diskData = structuredClone(data); });
    const store = await loadStore();
    const snapshot = {
      schemaVersion: 1 as const,
      libraryInitialized: true,
      tracks: [{ id: 'track-1' }],
      settings: secrets,
      playback: { _json: '{}' },
    };

    expect(store.save(snapshot)).toBe(true);
    const persisted = diskData as typeof snapshot;
    for (const [key, plaintext] of Object.entries(secrets)) {
      expect(persisted.settings[key]).toMatch(/^enc:[0-9a-f]+$/);
      expect(persisted.settings[key]).not.toContain(plaintext);
    }

    mocks.readJsonWithBackup.mockReturnValue({ data: structuredClone(persisted), source: 'main' });
    expect(store.load()).toEqual(snapshot);
  });

  it('fails closed instead of writing sensitive user data as plaintext', async () => {
    const store = await loadStore();
    mocks.isEncryptionAvailable.mockReturnValue(false);

    expect(store.save({
      schemaVersion: 1,
      libraryInitialized: true,
      tracks: [],
      settings: secrets,
      playback: {},
    })).toBe(false);
    expect(mocks.writeJsonAtomic).not.toHaveBeenCalled();
  });

  it('throws for an unreadable existing users file instead of reporting an empty library', async () => {
    mocks.existsSync.mockReturnValue(true);
    const store = await loadStore();

    expect(() => store.load()).toThrow('users.json and its backup are unreadable');
  });

  it('keeps an empty pre-v1 users file migration-pending to avoid clearing a surviving index', async () => {
    mocks.readJsonWithBackup.mockReturnValue({
      data: { tracks: [], settings: {}, playback: {} },
      source: 'main',
    });
    const store = await loadStore();

    expect(store.load()).toMatchObject({
      schemaVersion: 1,
      libraryInitialized: false,
      tracks: [],
    });
  });

  it('updates library state atomically while preserving or refreshing settings', async () => {
    const existing = {
      schemaVersion: 1 as const,
      libraryInitialized: false,
      tracks: [],
      settings: { 'app-theme': 'default-dark' },
      playback: {},
    };
    mocks.readJsonWithBackup.mockReturnValue({ data: existing, source: 'main' });
    let written: typeof existing | undefined;
    mocks.writeJsonAtomic.mockImplementation((_path: string, data: typeof existing) => { written = structuredClone(data); });
    const store = await loadStore();

    expect(store.saveLibraryState(
      [{ id: 'track-1' }],
      { _json: '{"volume":0.5}' },
      { 'app-theme': 'default-light' },
    )).toBe(true);
    expect(written).toMatchObject({
      schemaVersion: 1,
      libraryInitialized: true,
      tracks: [{ id: 'track-1' }],
      settings: { 'app-theme': 'default-light' },
      playback: { _json: '{"volume":0.5}' },
    });
  });

  it('does not start a new migration when only a recoverable backup exists', async () => {
    mocks.existsSync.mockImplementation((filePath: string) => filePath.endsWith('users.json.bak'));
    const store = await loadStore();

    store.migrateFromLegacy();

    expect(mocks.writeJsonAtomic).not.toHaveBeenCalled();
  });
});
