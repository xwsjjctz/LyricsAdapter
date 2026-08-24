// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcResult, PersistenceCloseCommitRequest } from '../../src/types/typedIpc';

const electronMocks = vi.hoisted(() => ({
  userDataPath: '',
  isEncryptionAvailable: vi.fn(),
  getSelectedStorageBackend: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMocks.userDataPath),
  },
  safeStorage: {
    isEncryptionAvailable: electronMocks.isEncryptionAvailable,
    getSelectedStorageBackend: electronMocks.getSelectedStorageBackend,
    encryptString: electronMocks.encryptString,
    decryptString: electronMocks.decryptString,
  },
}));

import { PersistenceCommitService } from '../../electron/services/persistenceCommitService';
import { PersistenceRepository } from '../../electron/services/persistenceRepository';
import {
  UserStateRepository,
  type UserStateCrypto,
} from '../../electron/services/userStateRepository';
import { SafeStorageUserStateCrypto } from '../../electron/services/userStateCrypto';

const sensitiveSettings = {
  'webdav-config': '{"password":"webdav-secret"}',
  qq_music_cookie: 'qq-secret',
  netease_cookie: 'netease-secret',
};

const openRepositories: UserStateRepository[] = [];
const temporaryRoots: string[] = [];

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
}

function fixture(crypto: UserStateCrypto = new SafeStorageUserStateCrypto()): {
  repository: UserStateRepository;
  stateDirectory: string;
  userDataDirectory: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-adapter-sqlite-'));
  const stateDirectory = path.join(root, '.la');
  const userDataDirectory = path.join(root, 'electron-user-data');
  fs.mkdirSync(stateDirectory, { recursive: true });
  fs.mkdirSync(userDataDirectory, { recursive: true });
  electronMocks.userDataPath = userDataDirectory;
  temporaryRoots.push(root);

  const repository = new UserStateRepository(stateDirectory, crypto);
  openRepositories.push(repository);
  return { repository, stateDirectory, userDataDirectory };
}

function readSqliteRows(
  databasePath: string,
  sql: string,
): Array<Record<string, unknown>> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(sql).all() as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
}

describe('UserStateRepository SQLite migration and transaction contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.isEncryptionAvailable.mockReturnValue(true);
    electronMocks.getSelectedStorageBackend.mockReturnValue('gnome_libsecret');
    electronMocks.encryptString.mockImplementation((plaintext: string) => (
      Buffer.from(`sealed:${plaintext}`, 'utf8')
    ));
    electronMocks.decryptString.mockImplementation((encrypted: Buffer) => {
      const decoded = encrypted.toString('utf8');
      if (!decoded.startsWith('sealed:')) throw new Error('invalid encrypted fixture');
      return decoded.slice('sealed:'.length);
    });
  });

  afterEach(() => {
    for (const repository of openRepositories.splice(0)) repository.close();
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('migrates all four slots in stable per-slot order and seals every sensitive setting', () => {
    const { repository, userDataDirectory } = fixture();
    writeJson(repository.legacySettingsPath, {
      ...sensitiveSettings,
      'webdav-cdn-cache': '{"/song.flac":{"url":"https://signed.example","expiry":1}}',
      'app-theme': 'default-dark',
    });
    writeJson(path.join(userDataDirectory, 'library-index.json'), {
      songs: [{ id: 'local-1' }, { id: 'local-2' }],
      cloudSongs: [{ id: 'cloud-1' }, { id: 'cloud-2' }],
      onlineSongs: [{ id: 'online-1' }, { id: 'online-2' }],
      playlistSongs: [{ id: 'playlist-1' }, { id: 'playlist-2' }],
      settings: { activeSlotId: 'playlist', volume: 0.65 },
    });

    repository.initialize();

    const snapshot = repository.loadUserData();
    expect(snapshot.libraryInitialized).toBe(true);
    expect(snapshot.tracks.map(track => [track.slotId, track.id])).toEqual([
      ['local', 'local-1'],
      ['local', 'local-2'],
      ['cloud', 'cloud-1'],
      ['cloud', 'cloud-2'],
      ['online', 'online-1'],
      ['online', 'online-2'],
      ['playlist', 'playlist-1'],
      ['playlist', 'playlist-2'],
    ]);
    expect(snapshot.playback).toEqual({
      _json: '{"activeSlotId":"playlist","volume":0.65}',
    });
    expect(repository.getAllSettings()).toMatchObject(sensitiveSettings);
    expect(repository.getSetting('webdav-cdn-cache')).toBeUndefined();

    const storedSettings = readSqliteRows(
      repository.databasePath,
      'SELECT key, value FROM settings ORDER BY key',
    );
    for (const [key, plaintext] of Object.entries(sensitiveSettings)) {
      const row = storedSettings.find(candidate => candidate.key === key);
      expect(row?.value).toMatch(/^enc:[0-9a-f]+$/);
      expect(row?.value).not.toContain(plaintext);
    }
    expect(storedSettings.some(row => row.key === 'webdav-cdn-cache')).toBe(false);
    expect(electronMocks.encryptString).toHaveBeenCalledTimes(3);
  });

  it('imports the pre-~/.la settings file when no newer settings source exists', () => {
    const { repository, userDataDirectory } = fixture();
    const legacyAppSettings = path.join(userDataDirectory, 'settings.json');
    writeJson(legacyAppSettings, {
      'app-theme': 'default-light',
      qq_music_cookie: 'old-app-data-cookie',
    });

    repository.initialize();

    expect(repository.getAllSettings()).toMatchObject({
      'app-theme': 'default-light',
      qq_music_cookie: 'old-app-data-cookie',
    });
    expect(fs.readFileSync(legacyAppSettings, 'utf8')).toContain('old-app-data-cookie');
    expect(readSqliteRows(repository.databasePath, "SELECT value FROM settings WHERE key = 'qq_music_cookie'"))
      .toEqual([{ value: `enc:${Buffer.from('sealed:old-app-data-cookie').toString('hex')}` }]);
  });

  it('re-seals legacy encrypted envelopes while treating runtime enc-prefixed values as plaintext', () => {
    const { repository } = fixture();
    const legacyPlaintext = 'legacy-cookie';
    writeJson(repository.legacySettingsPath, {
      qq_music_cookie: `enc:${Buffer.from(`sealed:${legacyPlaintext}`).toString('hex')}`,
    });

    repository.initialize();
    expect(repository.getSetting('qq_music_cookie')).toBe(legacyPlaintext);

    const runtimePlaintext = 'enc:not-hex-but-valid-cookie-text';
    repository.setSetting('qq_music_cookie', runtimePlaintext);
    expect(repository.getSetting('qq_music_cookie')).toBe(runtimePlaintext);

    repository.close();
    expect(() => repository.initialize()).not.toThrow();
    expect(repository.getSetting('qq_music_cookie')).toBe(runtimePlaintext);
    expect(readSqliteRows(
      repository.databasePath,
      "SELECT value FROM settings WHERE key = 'qq_music_cookie'",
    )).toEqual([{
      value: `enc:${Buffer.from(`sealed:${runtimePlaintext}`).toString('hex')}`,
    }]);
  });

  it('refuses Linux basic_text instead of presenting weak storage as encrypted', () => {
    electronMocks.getSelectedStorageBackend.mockReturnValue('basic_text');
    const crypto = new SafeStorageUserStateCrypto('linux');

    expect(() => crypto.encodeSetting('qq_music_cookie', 'secret'))
      .toThrow('safeStorage is unavailable');
    expect(electronMocks.encryptString).not.toHaveBeenCalled();
  });

  it('preserves an initialized-empty users snapshot instead of reviving stale cache membership', () => {
    const { repository, userDataDirectory } = fixture();
    writeJson(repository.legacyUserDataPath, {
      schemaVersion: 1,
      libraryInitialized: true,
      tracks: [],
      settings: { 'app-theme': 'default-light' },
      playback: { _json: '{"activeSlotId":"local"}' },
    });
    writeJson(path.join(userDataDirectory, 'library-index.json'), {
      songs: [{ id: 'stale-local-track' }],
      cloudSongs: [{ id: 'stale-cloud-track' }],
      onlineSongs: [],
      playlistSongs: [],
      settings: { activeSlotId: 'cloud' },
    });

    repository.initialize();

    expect(repository.loadUserData()).toMatchObject({
      schemaVersion: 1,
      libraryInitialized: true,
      tracks: [],
      playback: { _json: '{"activeSlotId":"local"}' },
    });
    expect(readSqliteRows(repository.databasePath, 'SELECT * FROM tracks')).toEqual([]);
  });

  it('ignores a malformed rebuildable library index while still migrating settings and users', () => {
    const { repository, userDataDirectory } = fixture();
    writeJson(repository.legacySettingsPath, {
      'app-theme': 'default-light',
      'app-language': 'zh',
    });
    writeJson(repository.legacyUserDataPath, {
      schemaVersion: 1,
      libraryInitialized: true,
      tracks: [{ id: 'authoritative-user-track', slotId: 'local', filePath: '/music/user.flac' }],
      settings: { 'app-theme': 'stale-user-copy' },
      playback: { _json: '{"volume":0.35}' },
    });
    const libraryIndexPath = path.join(userDataDirectory, 'library-index.json');
    fs.writeFileSync(libraryIndexPath, '{not valid JSON', 'utf8');

    expect(() => repository.initialize()).not.toThrow();

    expect(repository.loadUserData()).toMatchObject({
      libraryInitialized: true,
      tracks: [{
        id: 'authoritative-user-track',
        slotId: 'local',
        filePath: '/music/user.flac',
      }],
      settings: {
        'app-theme': 'default-light',
        'app-language': 'zh',
      },
      playback: { _json: '{"volume":0.35}' },
    });
    expect(fs.readFileSync(libraryIndexPath, 'utf8')).toBe('{not valid JSON');
  });

  it('sanitizes invalid optional cache metadata instead of blocking first migration', () => {
    const { repository, userDataDirectory } = fixture();
    writeJson(path.join(userDataDirectory, 'library-index.json'), {
      songs: [{ id: 'local-valid-id', filePath: '/music/a.flac', fileSize: 'bad', available: 'yes' }],
      settings: { activeSlotId: 'local' },
    });

    expect(() => repository.initialize()).not.toThrow();
    expect(repository.loadUserData().tracks).toEqual([
      { id: 'local-valid-id', slotId: 'local', filePath: '/music/a.flac' },
    ]);
  });

  it('updates and reads playback without parsing unrelated track records', () => {
    const { repository } = fixture();
    repository.initialize();
    repository.saveTracks([{ id: 'will-be-corrupted', slotId: 'local' }]);

    const database = new DatabaseSync(repository.databasePath);
    try {
      // This remains syntactically valid JSON for the SQLite CHECK constraint,
      // but deliberately violates the domain schema used by loadUserData().
      database.prepare('UPDATE tracks SET record_json = ?').run('{"id":""}');
    } finally {
      database.close();
    }

    expect(() => repository.setPlayback({ _json: '{"volume":0.8}' })).not.toThrow();
    expect(repository.getSetting('playback')).toBe('{"volume":0.8}');
    expect(() => repository.loadUserData()).toThrow();
  });

  it('migrates valid recovery copies without repairing or rewriting damaged legacy primaries', () => {
    const { repository } = fixture();
    const damagedSettings = '{damaged settings';
    const damagedUsers = '{damaged users';
    const backupSettings = JSON.stringify({ 'app-theme': 'backup-theme' });
    const backupUsers = JSON.stringify({
      schemaVersion: 1,
      libraryInitialized: true,
      tracks: [{ id: 'backup-track', slotId: 'playlist' }],
      settings: { 'app-theme': 'users-backup-theme' },
      playback: { _json: '{"activeSlotId":"playlist"}' },
    });
    fs.writeFileSync(repository.legacySettingsPath, damagedSettings, 'utf8');
    fs.writeFileSync(`${repository.legacySettingsPath}.bak`, backupSettings, 'utf8');
    fs.writeFileSync(repository.legacyUserDataPath, damagedUsers, 'utf8');
    fs.writeFileSync(`${repository.legacyUserDataPath}.bak`, backupUsers, 'utf8');

    repository.initialize();

    expect(repository.loadUserData()).toMatchObject({
      libraryInitialized: true,
      tracks: [{ id: 'backup-track', slotId: 'playlist' }],
      settings: { 'app-theme': 'backup-theme' },
      playback: { _json: '{"activeSlotId":"playlist"}' },
    });
    expect(fs.readFileSync(repository.legacySettingsPath, 'utf8')).toBe(damagedSettings);
    expect(fs.readFileSync(`${repository.legacySettingsPath}.bak`, 'utf8')).toBe(backupSettings);
    expect(fs.readFileSync(repository.legacyUserDataPath, 'utf8')).toBe(damagedUsers);
    expect(fs.readFileSync(`${repository.legacyUserDataPath}.bak`, 'utf8')).toBe(backupUsers);
  });

  it('fails closed without publishing a final database when settings and users are both unreadable', () => {
    const { repository, stateDirectory } = fixture();
    for (const filePath of [
      repository.legacySettingsPath,
      `${repository.legacySettingsPath}.bak`,
      repository.legacyUserDataPath,
      `${repository.legacyUserDataPath}.bak`,
    ]) {
      fs.writeFileSync(filePath, '{corrupt', 'utf8');
    }

    expect(() => repository.initialize()).toThrow('users.json and its backup are unreadable');

    expect(fs.existsSync(repository.databasePath)).toBe(false);
    expect(fs.readdirSync(stateDirectory).some(name => name.includes('.migrating-'))).toBe(false);
  });

  it('rolls back tracks, playback, and revision when a commit fails midway', () => {
    const crypto: UserStateCrypto = {
      encodeSetting: (_key, value) => value,
      decodeSetting: (_key, value) => value,
    };
    const { repository } = fixture(crypto);
    repository.initialize();
    repository.commitLibraryState(
      [{ id: 'baseline', slotId: 'local', filePath: '/music/baseline.flac' }],
      { _json: '{"volume":0.2}' },
    );
    const before = repository.loadUserData();
    const revisionBefore = readSqliteRows(
      repository.databasePath,
      'SELECT revision FROM workspace_state WHERE singleton = 1',
    )[0]?.revision;

    // Unknown fields are intentionally passthrough-compatible. BigInt survives
    // schema validation but JSON serialization fails after DELETE, exercising
    // the actual transaction rollback rather than only input validation.
    const badTrack = {
      id: 'replacement',
      slotId: 'cloud',
      webdavPath: '/replacement.flac',
      unsupportedFutureField: 1n,
    } as Record<string, unknown>;
    expect(() => repository.commitLibraryState(
      [badTrack as never],
      { _json: '{"volume":0.9}' },
    )).toThrow();

    expect(repository.loadUserData()).toEqual(before);
    expect(readSqliteRows(
      repository.databasePath,
      'SELECT revision FROM workspace_state WHERE singleton = 1',
    )[0]?.revision).toBe(revisionBefore);
  });

  it('removes the temporary database and leaves legacy sources retryable after migration rollback', () => {
    const crypto: UserStateCrypto = {
      encodeSetting: key => {
        if (key === 'qq_music_cookie') throw new Error('safeStorage unavailable');
        return 'encoded';
      },
      decodeSetting: (_key, value) => value,
    };
    const { repository, stateDirectory } = fixture(crypto);
    const legacy = { qq_music_cookie: 'legacy-secret', 'app-theme': 'default-dark' };
    writeJson(repository.legacySettingsPath, legacy);

    expect(() => repository.initialize()).toThrow('safeStorage unavailable');

    expect(fs.existsSync(repository.databasePath)).toBe(false);
    expect(fs.readdirSync(stateDirectory).some(name => name.includes('.migrating-'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(repository.legacySettingsPath, 'utf8'))).toEqual(legacy);
  });
});

describe('main persistence use-cases over the SQLite facade ports', () => {
  it('keeps bootstrap DTOs stable and commits SQLite before the cache', async () => {
    const { repository } = fixture();
    repository.initialize();
    repository.saveUserData({
      schemaVersion: 1,
      libraryInitialized: true,
      tracks: [{ id: 'old-track', slotId: 'local' }],
      settings: { 'app-theme': 'default-dark' },
      playback: { _json: '{"volume":0.2}' },
    });
    const cachedLibrary = {
      songs: [{ id: 'old-track' }],
      settings: { activeSlotId: 'local', volume: 0.2 },
    };
    const bootstrap = new PersistenceRepository({
      loadSettings: () => repository.getAllSettings(),
      loadUserData: () => repository.loadUserData(),
      loadLibraryIndex: async () => ({ ok: true, data: cachedLibrary }),
    });

    const loaded = await bootstrap.loadBootstrap();
    expect(loaded.settings).toMatchObject({ status: 'ready' });
    expect(loaded.userData).toMatchObject({
      status: 'ready',
      data: { libraryInitialized: true, tracks: [{ id: 'old-track', slotId: 'local' }] },
    });
    expect(loaded.libraryIndex).toEqual({ status: 'ready', data: cachedLibrary });

    const order: string[] = [];
    const commit = new PersistenceCommitService({
      savePlayback: playbackJson => {
        repository.setSetting('playback', playbackJson);
        return true;
      },
      saveUserLibraryState: (tracks, playback) => {
        order.push('users');
        repository.commitLibraryState(tracks, playback);
        return true;
      },
      saveLibraryIndex: async (): Promise<IpcResult<void>> => {
        order.push('cache');
        return { ok: true, data: undefined };
      },
    });
    const closeRequest: PersistenceCloseCommitRequest = {
      libraryIndex: {
        songs: [],
        cloudSongs: [{ id: 'new-cloud-track' }],
        settings: { activeSlotId: 'cloud', volume: 0.7 },
      },
      userData: {
        mode: 'write',
        tracks: [{ id: 'new-cloud-track', slotId: 'cloud', webdavPath: '/new.flac' }],
      },
    };

    await expect(commit.commitClose(closeRequest)).resolves.toEqual({
      fullyPersisted: true,
      settings: { status: 'saved' },
      userData: { status: 'saved' },
      libraryIndex: { status: 'saved' },
    });
    expect(order).toEqual(['users', 'cache']);
    expect(repository.loadUserData()).toMatchObject({
      libraryInitialized: true,
      tracks: [{ id: 'new-cloud-track', slotId: 'cloud', webdavPath: '/new.flac' }],
      playback: { _json: '{"activeSlotId":"cloud","volume":0.7}' },
    });
  });
});
