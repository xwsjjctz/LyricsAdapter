import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';
import { logger } from '../logger';
import { libraryIndexSnapshotSchema } from '../../src/shared/libraryIndexSchema';
import {
  isStoredUserDataSnapshot,
  normalizeStoredUserDataSnapshot,
  stringRecordSchema,
  userTrackRecordSchema,
} from '../../src/shared/userDataSchema';
import {
  isInternalSettingKey,
  isReplaceableCacheSettingKey,
  isRetiredSettingKey,
  isSensitiveSettingKey,
  USER_DATA_SCHEMA_VERSION,
} from '../../src/shared/persistencePolicy';
import { buildUserTracksFromLibraryCache } from '../../src/domain/library-persistence/trackRecords';
import type { PersistedLibrarySnapshot } from '../../src/domain/library-persistence/models';
import {
  ENCRYPTED_VALUE_PREFIX,
  userStateCrypto,
  type UserStateCrypto,
} from './userStateCrypto';

export interface UserStateSnapshot {
  schemaVersion: typeof USER_DATA_SCHEMA_VERSION;
  libraryInitialized: boolean;
  tracks: UserTrackRecord[];
  settings: Record<string, string>;
  playback: Record<string, string>;
}

export interface UserTrackRecord {
  id: string;
  slotId?: 'local' | 'cloud' | 'online' | 'playlist' | undefined;
  filePath?: string | undefined;
  webdavPath?: string | undefined;
  fileName?: string | undefined;
  fileSize?: number | undefined;
  lastModified?: number | undefined;
  source?: string | undefined;
  addedAt?: string | undefined;
  playCount?: number | undefined;
  lastPlayed?: string | null | undefined;
  songmid?: string | undefined;
  available?: boolean | undefined;
  [key: string]: unknown;
}

interface WorkspaceRow {
  library_initialized: number;
  revision: number;
  playback_json: string;
}

interface TrackRow {
  record_json: string;
}

interface SettingRow {
  key: string;
  value: string;
}

interface LegacySources {
  settings: Record<string, string>;
  userData: UserStateSnapshot | null;
  libraryIndex: PersistedLibrarySnapshot | null;
}

type LegacyRead<T> =
  | { status: 'absent' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: Error };

const SCHEMA_VERSION = 1;

function defaultSnapshot(): UserStateSnapshot {
  return {
    schemaVersion: USER_DATA_SCHEMA_VERSION,
    libraryInitialized: false,
    tracks: [],
    settings: {},
    playback: {},
  };
}

function inferSlotId(record: UserTrackRecord): 'local' | 'cloud' | 'online' | 'playlist' {
  if (record.slotId === 'local' || record.slotId === 'cloud'
    || record.slotId === 'online' || record.slotId === 'playlist') return record.slotId;
  if (record.source === 'webdav') return 'cloud';
  if (record.source === 'qq' || record.source === 'netease') return 'online';
  return 'local';
}

function hasLegacyFile(filePath: string): boolean {
  return fs.existsSync(filePath) || fs.existsSync(`${filePath}.bak`);
}

/** Read legacy sources without repairing, deleting, or otherwise rewriting them. */
function readValidatedLegacyJson<T>(
  filePath: string,
  validate: (value: unknown) => T | null,
): LegacyRead<T> {
  const existed = hasLegacyFile(filePath);
  for (const candidate of [filePath, `${filePath}.bak`]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const validated = validate(JSON.parse(fs.readFileSync(candidate, 'utf8')) as unknown);
      if (validated !== null) return { status: 'ready', data: validated };
    } catch {
      // Try the frozen recovery copy. Legacy files are never repaired in place.
    }
  }
  return existed
    ? { status: 'error', error: new Error(`${path.basename(filePath)} and its backup are unreadable`) }
    : { status: 'absent' };
}

function readLegacySettings(filePath: string): LegacyRead<Record<string, string>> {
  return readValidatedLegacyJson(filePath, value => {
    const parsed = stringRecordSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  });
}

function readLegacyUserData(filePath: string): LegacyRead<UserStateSnapshot> {
  return readValidatedLegacyJson(filePath, value => {
    if (!isStoredUserDataSnapshot(value)) return null;
    return normalizeStoredUserDataSnapshot(value) as UserStateSnapshot | null;
  });
}

function readLegacyLibraryIndex(filePath: string): PersistedLibrarySnapshot | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = libraryIndexSnapshotSchema.safeParse(
      JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown,
    );
    if (!parsed.success) {
      logger.warn('[UserStateRepository] Ignoring invalid legacy library cache:', parsed.error.message);
      return null;
    }
    return parsed.data as unknown as PersistedLibrarySnapshot;
  } catch (error) {
    logger.warn('[UserStateRepository] Ignoring unreadable legacy library cache:', error);
    return null;
  }
}

export class UserStateRepository {
  readonly directoryPath: string;
  readonly databasePath: string;
  readonly legacySettingsPath: string;
  readonly legacyUserDataPath: string;
  private database: DatabaseSync | null = null;

  constructor(
    directoryPath = path.join(os.homedir(), '.la'),
    private readonly crypto: UserStateCrypto = userStateCrypto,
  ) {
    this.directoryPath = directoryPath;
    this.databasePath = path.join(directoryPath, 'state.sqlite3');
    this.legacySettingsPath = path.join(directoryPath, 'settings.json');
    this.legacyUserDataPath = path.join(directoryPath, 'users.json');
  }

  initialize(): void {
    if (this.database) return;
    fs.mkdirSync(this.directoryPath, { recursive: true });
    if (fs.existsSync(this.databasePath)) {
      const database = this.open(this.databasePath);
      try {
        this.verify(database);
        this.database = database;
      } catch (error) {
        database.close();
        throw error;
      }
      return;
    }

    const temporaryPath = `${this.databasePath}.migrating-${process.pid}-${Date.now()}`;
    let temporaryDatabase: DatabaseSync | null = null;
    try {
      const sources = this.loadLegacySources();
      temporaryDatabase = this.open(temporaryPath);
      this.createSchema(temporaryDatabase);
      this.importLegacy(temporaryDatabase, sources);
      this.verify(temporaryDatabase);
      temporaryDatabase.close();
      temporaryDatabase = null;
      fs.renameSync(temporaryPath, this.databasePath);
      const database = this.open(this.databasePath);
      try {
        this.verify(database);
        this.database = database;
      } catch (error) {
        database.close();
        throw error;
      }
      logger.info('[UserStateRepository] Initialized SQLite user state at', this.databasePath);
    } catch (error) {
      try { temporaryDatabase?.close(); } catch { /* retain original failure */ }
      try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch { /* best effort */ }
      throw error;
    }
  }

  close(): void {
    if (!this.database) return;
    this.database.close();
    this.database = null;
  }

  getSetting(key: string): string | undefined {
    if (isReplaceableCacheSettingKey(key) || isRetiredSettingKey(key)) return undefined;
    if (key === 'playback') return this.loadWorkspaceState().playback['_json'];
    const row = this.db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? this.crypto.decodeSetting(key, row.value) : undefined;
  }

  getAllSettings(): Record<string, string> {
    const result: Record<string, string> = {};
    const rows = this.db().prepare('SELECT key, value FROM settings ORDER BY key').all() as unknown as SettingRow[];
    for (const row of rows) {
      if (isReplaceableCacheSettingKey(row.key) || isRetiredSettingKey(row.key)) continue;
      result[row.key] = this.crypto.decodeSetting(row.key, row.value);
    }
    const playback = this.loadWorkspaceState().playback['_json'];
    if (playback !== undefined) result['playback'] = playback;
    return result;
  }

  setSetting(key: string, value: string): void {
    if (isReplaceableCacheSettingKey(key) || isRetiredSettingKey(key)) {
      this.db().prepare('DELETE FROM settings WHERE key = ?').run(key);
      return;
    }
    if (key === 'playback') {
      this.setPlayback({ _json: value });
      return;
    }
    const stored = this.crypto.encodeSetting(key, value);
    this.db().prepare(`
      INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, stored, Date.now());
  }

  setManySettings(entries: Record<string, string>): void {
    const prepared = this.prepareSettings(entries);
    this.transaction(() => {
      for (const [key, value] of prepared.settings) this.upsertSetting(key, value);
      if (prepared.playback !== undefined) {
        const workspace = this.loadWorkspaceState();
        this.updateWorkspace(workspace.libraryInitialized, { _json: prepared.playback });
      }
    });
  }

  deleteSetting(key: string): void {
    if (key === 'playback') {
      this.setPlayback({});
      return;
    }
    this.db().prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  replaceAllSettings(entries: Record<string, string>): void {
    const prepared = this.prepareSettings(entries);
    this.transaction(() => {
      this.db().exec('DELETE FROM settings');
      const workspace = this.loadWorkspaceState();
      this.updateWorkspace(
        workspace.libraryInitialized,
        prepared.playback === undefined ? {} : { _json: prepared.playback },
      );
      for (const [key, value] of prepared.settings) this.upsertSetting(key, value);
    });
  }

  loadUserData(): UserStateSnapshot {
    const workspace = this.loadWorkspaceState();
    return {
      schemaVersion: USER_DATA_SCHEMA_VERSION,
      libraryInitialized: workspace.libraryInitialized,
      tracks: this.loadTracks(),
      settings: this.getAllSettings(),
      playback: workspace.playback,
    };
  }

  saveUserData(data: UserStateSnapshot): void {
    const parsedTracks = data.tracks.map(record => userTrackRecordSchema.parse(record) as UserTrackRecord);
    this.transaction(() => {
      this.replaceTracks(parsedTracks);
      this.replaceSettingsInsideTransaction(data.settings || {});
      this.updateWorkspace(Boolean(data.libraryInitialized), data.playback || {});
    });
  }

  saveTracks(tracks: UserTrackRecord[]): void {
    const parsedTracks = tracks.map(record => userTrackRecordSchema.parse(record) as UserTrackRecord);
    this.transaction(() => {
      this.replaceTracks(parsedTracks);
      this.updateWorkspace(true, this.loadWorkspaceState().playback);
    });
  }

  saveSettings(settings: Record<string, string>): void {
    const parsed = stringRecordSchema.parse(settings);
    this.transaction(() => this.replaceSettingsInsideTransaction(parsed));
  }

  setPlayback(playback: Record<string, string>): void {
    const parsed = stringRecordSchema.parse(playback);
    this.transaction(() => {
      const workspace = this.loadWorkspaceState();
      this.updateWorkspace(workspace.libraryInitialized, parsed);
    });
  }

  commitLibraryState(
    tracks: UserTrackRecord[],
    playback: Record<string, string>,
  ): void {
    const parsedTracks = tracks.map(record => userTrackRecordSchema.parse(record) as UserTrackRecord);
    const parsedPlayback = stringRecordSchema.parse(playback);
    this.transaction(() => {
      this.replaceTracks(parsedTracks);
      this.updateWorkspace(true, parsedPlayback);
    });
  }

  private loadLegacySources(): LegacySources {
    let settingsRead = readLegacySettings(this.legacySettingsPath);
    // Releases before ~/.la existed stored settings alongside Chromium data.
    // Keep this as a read-only migration fallback so direct upgrades do not
    // lose preferences or credentials; the old file is never rewritten.
    if (settingsRead.status === 'absent') {
      settingsRead = readLegacySettings(path.join(app.getPath('userData'), 'settings.json'));
    }
    const userDataRead = readLegacyUserData(this.legacyUserDataPath);
    if (userDataRead.status === 'error') throw userDataRead.error;
    if (settingsRead.status === 'error' && userDataRead.status !== 'ready') {
      throw settingsRead.error;
    }
    const legacySettings = settingsRead.status === 'ready' ? settingsRead.data : {};
    const legacyUserData = userDataRead.status === 'ready' ? userDataRead.data : null;
    const libraryIndex = readLegacyLibraryIndex(path.join(app.getPath('userData'), 'library-index.json'));
    return { settings: legacySettings, userData: legacyUserData, libraryIndex };
  }

  private importLegacy(database: DatabaseSync, sources: LegacySources): void {
    let userData = sources.userData ?? defaultSnapshot();
    let tracks = userData.tracks;
    let libraryInitialized = userData.libraryInitialized;
    if (!libraryInitialized && sources.libraryIndex) {
      const seeded = buildUserTracksFromLibraryCache(sources.libraryIndex);
      if (seeded.length > 0) {
        tracks = seeded as UserTrackRecord[];
        libraryInitialized = true;
      }
    }
    const hasPublicPrimarySettings = Object.keys(sources.settings)
      .some(key => !isInternalSettingKey(key)
        && !isReplaceableCacheSettingKey(key)
        && !isRetiredSettingKey(key));
    const settings = {
      ...(hasPublicPrimarySettings
        ? sources.settings
        : { ...userData.settings, ...sources.settings }),
    };
    for (const key of Object.keys(settings)) {
      if (isReplaceableCacheSettingKey(key) || isRetiredSettingKey(key)) {
        delete settings[key];
        continue;
      }
      // Previous JSON stores already sealed sensitive values with the same
      // envelope. Decode those persisted envelopes before the SQLite write so
      // encodeSetting can safely treat every runtime value as plaintext (even
      // a legitimate cookie whose text itself begins with "enc:").
      if (isSensitiveSettingKey(key) && settings[key]?.startsWith(ENCRYPTED_VALUE_PREFIX)) {
        settings[key] = this.crypto.decodeSetting(key, settings[key]);
      }
    }
    const playbackJson = userData.playback['_json']
      ?? settings['playback']
      ?? userData.settings['playback']
      ?? (sources.libraryIndex ? JSON.stringify(sources.libraryIndex.settings) : undefined);

    this.database = database;
    try {
      this.transaction(() => {
        this.replaceTracks(tracks);
        this.replaceSettingsInsideTransaction(settings);
        this.updateWorkspace(libraryInitialized, playbackJson ? { _json: playbackJson } : {});
        database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(
          SCHEMA_VERSION,
          Date.now(),
        );
        database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    } finally {
      this.database = null;
    }
  }

  private open(databasePath: string): DatabaseSync {
    const database = new DatabaseSync(databasePath, { timeout: 5000 });
    database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL');
    return database;
  }

  private createSchema(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT, WITHOUT ROWID;
      CREATE TABLE workspace_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        library_initialized INTEGER NOT NULL CHECK (library_initialized IN (0, 1)),
        revision INTEGER NOT NULL,
        playback_json TEXT NOT NULL CHECK (json_valid(playback_json))
      ) STRICT;
      CREATE TABLE tracks (
        slot_id TEXT NOT NULL CHECK (slot_id IN ('local','cloud','online','playlist')),
        position INTEGER NOT NULL CHECK (position >= 0),
        track_id TEXT NOT NULL,
        record_json TEXT NOT NULL CHECK (json_valid(record_json)),
        PRIMARY KEY (slot_id, position)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX tracks_track_id_idx ON tracks(track_id);
      INSERT INTO workspace_state(singleton, library_initialized, revision, playback_json)
      VALUES (1, 0, 0, '{}');
    `);
  }

  private verify(database: DatabaseSync): void {
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version !== SCHEMA_VERSION) {
      throw new Error(`Unsupported user state schema version: ${version.user_version}`);
    }
    const check = database.prepare('PRAGMA quick_check').get() as { quick_check: string };
    if (check.quick_check !== 'ok') throw new Error(`SQLite integrity check failed: ${check.quick_check}`);
    const row = database.prepare('SELECT COUNT(*) AS count FROM workspace_state WHERE singleton = 1').get() as { count: number };
    if (row.count !== 1) throw new Error('SQLite workspace state is missing');

    // SQLite integrity alone does not prove that encrypted settings and JSON
    // records are readable by this application version. Validate a complete
    // logical snapshot before accepting a migrated or existing authority DB.
    const previousDatabase = this.database;
    this.database = database;
    try {
      this.loadUserData();
    } finally {
      this.database = previousDatabase;
    }
  }

  private db(): DatabaseSync {
    if (!this.database) throw new Error('UserStateRepository is not initialized');
    return this.database;
  }

  private transaction<T>(operation: () => T): T {
    const database = this.db();
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  private loadWorkspaceState(): {
    libraryInitialized: boolean;
    playback: Record<string, string>;
  } {
    const workspace = this.db().prepare(`
      SELECT library_initialized, revision, playback_json FROM workspace_state WHERE singleton = 1
    `).get() as unknown as WorkspaceRow;
    const playback = stringRecordSchema.parse(JSON.parse(workspace.playback_json) as unknown);
    return {
      libraryInitialized: workspace.library_initialized === 1,
      playback,
    };
  }

  private loadTracks(): UserTrackRecord[] {
    const rows = this.db().prepare(`
      SELECT record_json FROM tracks
      ORDER BY CASE slot_id
        WHEN 'local' THEN 0 WHEN 'cloud' THEN 1 WHEN 'online' THEN 2 ELSE 3 END, position
    `).all() as unknown as TrackRow[];
    return rows.map(row => (
      userTrackRecordSchema.parse(JSON.parse(row.record_json)) as UserTrackRecord
    ));
  }

  private replaceTracks(tracks: UserTrackRecord[]): void {
    this.db().exec('DELETE FROM tracks');
    const positions = new Map<string, number>();
    const insert = this.db().prepare(`
      INSERT INTO tracks(slot_id, position, track_id, record_json) VALUES (?, ?, ?, ?)
    `);
    for (const record of tracks) {
      const slotId = inferSlotId(record);
      const position = positions.get(slotId) ?? 0;
      positions.set(slotId, position + 1);
      insert.run(slotId, position, record.id, JSON.stringify({ ...record, slotId }));
    }
  }

  private replaceSettingsInsideTransaction(settings: Record<string, string>): void {
    const parsed = stringRecordSchema.parse(settings);
    const encoded = Object.entries(parsed)
      .filter(([key]) => key !== 'playback'
        && !isReplaceableCacheSettingKey(key)
        && !isRetiredSettingKey(key))
      .map(([key, value]) => [key, this.crypto.encodeSetting(key, value)] as const);
    this.db().exec('DELETE FROM settings');
    const insert = this.db().prepare('INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)');
    for (const [key, value] of encoded) insert.run(key, value, Date.now());
  }

  private prepareSettings(entries: Record<string, string>): {
    settings: Array<readonly [string, string]>;
    playback: string | undefined;
  } {
    const parsed = stringRecordSchema.parse(entries);
    return {
      settings: Object.entries(parsed)
        .filter(([key]) => key !== 'playback'
          && !isReplaceableCacheSettingKey(key)
          && !isRetiredSettingKey(key))
        .map(([key, value]) => [key, this.crypto.encodeSetting(key, value)] as const),
      playback: parsed['playback'],
    };
  }

  private upsertSetting(key: string, storedValue: string): void {
    this.db().prepare(`
      INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, storedValue, Date.now());
  }

  private updateWorkspace(libraryInitialized: boolean, playback: Record<string, string>): void {
    this.db().prepare(`
      UPDATE workspace_state
      SET library_initialized = ?, revision = revision + 1, playback_json = ?
      WHERE singleton = 1
    `).run(libraryInitialized ? 1 : 0, JSON.stringify(playback));
  }
}

export const userStateRepository = new UserStateRepository();
