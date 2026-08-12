// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appGetPath: vi.fn(),
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  homedir: vi.fn(),
  readJsonWithBackup: vi.fn(),
  writeJsonAtomic: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: { getPath: mocks.appGetPath },
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
    readFileSync: mocks.readFileSync,
    writeFileSync: mocks.writeFileSync,
  },
}));

vi.mock('os', () => ({
  default: { homedir: mocks.homedir },
}));

vi.mock('../../electron/utils/atomicWrite', () => ({
  readJsonWithBackup: mocks.readJsonWithBackup,
  writeJsonAtomic: mocks.writeJsonAtomic,
}));

vi.mock('../../electron/logger', () => ({ logger: mocks.logger }));

const SENSITIVE_VALUES = {
  'webdav-config': '{"password":"webdav-secret"}',
  'webdav-cdn-cache': '{"/song.flac":{"url":"https://signed.example","expiry":1}}',
  qq_music_cookie: 'qq-secret',
  netease_cookie: 'netease-secret',
  soda_cookie: 'soda-secret',
} as const;

const BASELINE = {
  'app-theme': 'default-dark',
  'app-language': 'zh',
  qq_music_cookie: 'old-secret',
};

async function loadStore(initial: Record<string, string> | null = null) {
  mocks.readJsonWithBackup.mockReturnValue(
    initial ? { data: { ...initial }, source: 'primary' } : null,
  );
  const { settingsStore } = await import('../../electron/services/settingsStore');
  return settingsStore;
}

describe('SettingsStore encryption and atomic in-memory contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mocks.appGetPath.mockReturnValue('/virtual-electron-user-data');
    mocks.homedir.mockReturnValue('/virtual-home');
    mocks.existsSync.mockReturnValue(false);
    mocks.readJsonWithBackup.mockReturnValue(null);
    mocks.writeJsonAtomic.mockImplementation(() => undefined);
    mocks.isEncryptionAvailable.mockReturnValue(true);
    mocks.encryptString.mockImplementation((plaintext: string) => (
      Buffer.from(`sealed:${plaintext}`, 'utf8')
    ));
    mocks.decryptString.mockImplementation((encrypted: Buffer) => {
      const decoded = encrypted.toString('utf8');
      if (!decoded.startsWith('sealed:')) throw new Error('invalid encrypted fixture');
      return decoded.slice('sealed:'.length);
    });
  });

  it('encrypts all five sensitive keys on disk and decrypts them on read', async () => {
    const diskWrites: Array<Record<string, string>> = [];
    mocks.writeJsonAtomic.mockImplementation((_filePath: string, data: Record<string, string>) => {
      diskWrites.push({ ...data });
    });
    const store = await loadStore();

    expect(store.setMany({ ...SENSITIVE_VALUES, 'app-theme': 'default-light' })).toBe(true);

    expect(diskWrites).toHaveLength(1);
    const diskData = diskWrites[0]!;
    for (const [key, plaintext] of Object.entries(SENSITIVE_VALUES)) {
      expect(diskData[key]).toMatch(/^enc:[0-9a-f]+$/);
      expect(diskData[key]).not.toContain(plaintext);
      expect(store.get(key)).toBe(plaintext);
    }
    expect(diskData['app-theme']).toBe('default-light');
    expect(store.getAll()).toEqual({ ...SENSITIVE_VALUES, 'app-theme': 'default-light' });
  });

  it.each([
    {
      operation: 'set',
      mutate: (store: Awaited<ReturnType<typeof loadStore>>) => store.set('app-theme', 'default-light'),
    },
    {
      operation: 'setMany',
      mutate: (store: Awaited<ReturnType<typeof loadStore>>) => store.setMany({
        'app-theme': 'default-light',
        soda_cookie: 'new-secret',
      }),
    },
    {
      operation: 'delete',
      mutate: (store: Awaited<ReturnType<typeof loadStore>>) => store.delete('app-language'),
    },
    {
      operation: 'replaceAll',
      mutate: (store: Awaited<ReturnType<typeof loadStore>>) => store.replaceAll({
        'app-theme': 'default-light',
      }),
    },
  ])('rolls back in-memory state when $operation cannot reach disk', async ({ mutate }) => {
    const store = await loadStore(BASELINE);
    mocks.writeJsonAtomic.mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(mutate(store)).toBe(false);
    expect(store.getAll()).toEqual(BASELINE);
  });

  it('refuses to persist sensitive settings when safeStorage is unavailable', async () => {
    const store = await loadStore(BASELINE);
    mocks.isEncryptionAvailable.mockReturnValue(false);

    expect(store.set('webdav-config', '{"password":"secret"}')).toBe(false);
    expect(store.getAll()).toEqual(BASELINE);
    expect(mocks.writeJsonAtomic).not.toHaveBeenCalled();
  });

  it('does not treat an unreadable existing settings file as a new empty store', async () => {
    mocks.existsSync.mockReturnValue(true);
    const store = await loadStore();

    expect(() => store.getAll()).toThrow('settings.json and its backup are unreadable');
    expect(store.set('app-theme', 'default-light')).toBe(false);
    expect(mocks.writeJsonAtomic).not.toHaveBeenCalled();
  });

  it('migrates legacy sensitive values through safeStorage after explicit initialization', async () => {
    mocks.existsSync.mockImplementation((filePath: string) => (
      filePath === '/virtual-electron-user-data/settings.json'
    ));
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      'app-theme': 'default-dark',
      'webdav-config': '{"password":"legacy-secret"}',
      qq_music_cookie: 'legacy-cookie',
    }));
    const store = await loadStore();

    store.initialize();

    const migrated = mocks.writeJsonAtomic.mock.calls[0]?.[1] as Record<string, string>;
    expect(migrated['app-theme']).toBe('default-dark');
    expect(migrated['webdav-config']).toMatch(/^enc:/);
    expect(migrated.qq_music_cookie).toMatch(/^enc:/);
    expect(JSON.stringify(migrated)).not.toContain('legacy-secret');
    expect(JSON.stringify(migrated)).not.toContain('legacy-cookie');
  });

  it('re-encrypts plaintext secrets already stored at the current path', async () => {
    mocks.existsSync.mockImplementation((filePath: string) => (
      filePath === '/virtual-home/.la/settings.json'
    ));
    const store = await loadStore({
      'app-theme': 'default-dark',
      'webdav-config': '{"password":"old-plaintext"}',
      qq_music_cookie: 'old-cookie',
    });

    store.initialize();

    const backupWrite = mocks.writeJsonAtomic.mock.calls.find(
      ([filePath]) => filePath === '/virtual-home/.la/settings.json.bak',
    )?.[1] as Record<string, string>;
    const primaryWrite = mocks.writeJsonAtomic.mock.calls.find(
      ([filePath]) => filePath === '/virtual-home/.la/settings.json',
    )?.[1] as Record<string, string>;
    expect(backupWrite['webdav-config']).toMatch(/^enc:/);
    expect(primaryWrite.qq_music_cookie).toMatch(/^enc:/);
    expect(JSON.stringify([backupWrite, primaryWrite])).not.toContain('old-plaintext');
    expect(JSON.stringify([backupWrite, primaryWrite])).not.toContain('old-cookie');
    expect(store.get('webdav-config')).toBe('{"password":"old-plaintext"}');
  });

  it('keeps a failed legacy secret migration retryable instead of exposing an empty store', async () => {
    mocks.existsSync.mockImplementation((filePath: string) => (
      filePath === '/virtual-electron-user-data/settings.json'
    ));
    mocks.readFileSync.mockReturnValue(JSON.stringify({ qq_music_cookie: 'legacy-cookie' }));
    mocks.isEncryptionAvailable.mockReturnValue(false);
    const store = await loadStore();

    store.initialize();

    expect(() => store.getAll()).toThrow('safeStorage is unavailable');
    expect(mocks.writeJsonAtomic).not.toHaveBeenCalled();
  });

  it('replaces a plaintext recovery copy even when the primary is already encrypted', async () => {
    const encrypted = `enc:${Buffer.from('sealed:primary-secret', 'utf8').toString('hex')}`;
    mocks.existsSync.mockImplementation((filePath: string) => (
      filePath === '/virtual-home/.la/settings.json'
      || filePath === '/virtual-home/.la/settings.json.bak'
    ));
    mocks.readFileSync.mockImplementation((filePath: string) => {
      if (filePath === '/virtual-home/.la/settings.json.bak') {
        return JSON.stringify({ qq_music_cookie: 'backup-plaintext' });
      }
      throw new Error(`unexpected read: ${filePath}`);
    });
    const store = await loadStore({ qq_music_cookie: encrypted });

    store.initialize();

    const backupWrite = mocks.writeJsonAtomic.mock.calls.find(
      ([filePath]) => filePath === '/virtual-home/.la/settings.json.bak',
    )?.[1] as Record<string, string>;
    expect(backupWrite.qq_music_cookie).toBe(encrypted);
    expect(JSON.stringify(backupWrite)).not.toContain('backup-plaintext');
  });
});
