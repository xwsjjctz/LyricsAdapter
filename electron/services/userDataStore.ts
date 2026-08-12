/**
 * User Data Store — ~/.la/users.json
 *
 * 存储 **纯用户数据**（不可重建）：
 *   tracks    — 曲目列表（仅 id/path/source 等用户行为字段，不含元数据）
 *   settings  — 用户配置（主题/语言/WebDAV/凭据，合并自原 settings.json）
 *   playback  — 播放状态（音量/模式/进度/激活插槽）
 *
 * 设计原则：
 * - 缓存可清（IndexedDB、covers/、library-index.json），但 users.json 永远保留
 * - tracks 中只存 "哪些文件属于当前用户" 的归属信息，不存可重新解析的元数据
 * - settings + playback 已通过 settingsStore 从 settings.json 同步过来
 */
import { safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../logger';
import { writeJsonAtomic, readJsonWithBackup } from '../utils/atomicWrite';
import { isSensitiveSettingKey, USER_DATA_SCHEMA_VERSION } from '../../src/shared/persistencePolicy';
import {
  isStoredUserDataSnapshot,
  normalizeStoredUserDataSnapshot,
} from '../../src/shared/userDataSchema';

// ========== 类型定义 ==========

/** users.json 中一条曲目的最小化结构（仅用户不可重建的字段）。 */
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
}

export interface UserDataFile {
  schemaVersion: typeof USER_DATA_SCHEMA_VERSION;
  libraryInitialized: boolean;
  tracks: UserTrackRecord[];
  settings: Record<string, string>;
  playback: Record<string, string>;
}

// ========== 敏感字段加密（复用 settingsStore 逻辑） ==========

const ENC_PREFIX = 'enc:';

function isEncryptionAvailable(): boolean {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function encrypt(plaintext: string): string {
  if (!isEncryptionAvailable()) {
    throw new Error('safeStorage is unavailable; refusing to persist sensitive user data as plaintext');
  }
  try {
    const buf = safeStorage.encryptString(plaintext);
    return ENC_PREFIX + buf.toString('hex');
  } catch (error) {
    logger.error('[UserDataStore] Encryption failed:', error);
    throw error;
  }
}

function decrypt(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  if (!isEncryptionAvailable()) {
    throw new Error('safeStorage is unavailable; cannot decrypt sensitive user data');
  }
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'hex'));
  } catch (error) {
    logger.error('[UserDataStore] Decryption failed:', error);
    throw error;
  }
}

/** 对 settings 中敏感字段加密后返回新对象。已带 enc: 前缀的跳过。 */
function encryptSettings(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) {
    // 避免双重加密：settings.json 中敏感字段可能已被 settingsStore 加密
    out[k] = (isSensitiveSettingKey(k) && !v.startsWith(ENC_PREFIX)) ? encrypt(v) : v;
  }
  return out;
}

/** 对 settings 中敏感字段解密后返回新对象。 */
function decryptSettings(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) {
    out[k] = isSensitiveSettingKey(k) ? decrypt(v) : v;
  }
  return out;
}

// ========== Store class ==========

class UserDataStore {
  private filePath: string;
  private dirPath: string;

  constructor() {
    this.dirPath = path.join(os.homedir(), '.la');
    this.filePath = path.join(this.dirPath, 'users.json');
    this.ensureDir();
  }

  private ensureDir(): void {
    try {
      if (!fs.existsSync(this.dirPath)) {
        fs.mkdirSync(this.dirPath, { recursive: true });
      }
    } catch (e) {
      logger.error('[UserDataStore] Failed to create directory:', e);
    }
  }

  // ========== 公开 API ==========

  /** 完整读取 users.json。主文件损坏时回退 .bak；已有文件均不可读时抛错。 */
  load(): UserDataFile {
    try {
      const hadStoredData = fs.existsSync(this.filePath) || fs.existsSync(`${this.filePath}.bak`);
      const result = readJsonWithBackup<unknown>(this.filePath, {
        validate: isStoredUserDataSnapshot,
      });
      if (result) {
        const parsed = normalizeStoredUserDataSnapshot(result.data);
        if (!parsed) throw new Error('users.json failed schema validation');
        return {
          schemaVersion: USER_DATA_SCHEMA_VERSION,
          libraryInitialized: parsed.libraryInitialized,
          tracks: parsed.tracks,
          settings: decryptSettings(parsed.settings),
          playback: parsed.playback,
        };
      }
      if (hadStoredData) {
        throw new Error('users.json and its backup are unreadable');
      }
    } catch (e) {
      logger.error('[UserDataStore] Failed to load:', e);
      throw e;
    }
    return {
      schemaVersion: USER_DATA_SCHEMA_VERSION,
      libraryInitialized: false,
      tracks: [],
      settings: {},
      playback: {},
    };
  }

  /** 完整写入 users.json（原子写 + .bak 备份）。settings 中的敏感字段自动加密。 */
  save(data: UserDataFile): boolean {
    try {
      this.ensureDir();
      const toWrite: UserDataFile = {
        schemaVersion: USER_DATA_SCHEMA_VERSION,
        libraryInitialized: data.libraryInitialized ?? true,
        tracks: data.tracks,
        settings: encryptSettings(data.settings || {}),
        playback: data.playback || {},
      };
      writeJsonAtomic(this.filePath, toWrite, {
        keepBackup: true,
        validate: isStoredUserDataSnapshot,
      });
      return true;
    } catch (e) {
      logger.error('[UserDataStore] Failed to save:', e);
      return false;
    }
  }

  /** 只替换 tracks 列表（不清除 settings/playback）。 */
  saveTracks(tracks: UserTrackRecord[]): boolean {
    const existing = this.load();
    existing.tracks = tracks;
    existing.libraryInitialized = true;
    return this.save(existing);
  }

  /** Atomically update library membership + playback while preserving settings. */
  saveLibraryState(
    tracks: UserTrackRecord[],
    playback: Record<string, string>,
    settings?: Record<string, string>,
  ): boolean {
    const existing = this.load();
    existing.tracks = tracks;
    existing.playback = playback;
    if (settings) existing.settings = settings;
    existing.libraryInitialized = true;
    return this.save(existing);
  }

  /** 只替换 settings。 */
  saveSettings(settings: Record<string, string>): boolean {
    const existing = this.load();
    existing.settings = settings;
    return this.save(existing);
  }

  /** 只替换 playback。 */
  savePlayback(playback: Record<string, string>): boolean {
    const existing = this.load();
    existing.playback = playback;
    return this.save(existing);
  }

  /** 文件路径（供日志用）。 */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * 首次迁移：将 settings.json 和 library-index.json 中的数据
   * 汇入 users.json。当 users.json 已存在时跳过。
   */
  migrateFromLegacy(): void {
    if (fs.existsSync(this.filePath) || fs.existsSync(`${this.filePath}.bak`)) return;

    logger.info('[UserDataStore] First run — migrating legacy data to', this.filePath);
    const data: UserDataFile = {
      schemaVersion: USER_DATA_SCHEMA_VERSION,
      libraryInitialized: false,
      tracks: [],
      settings: {},
      playback: {},
    };

    // 1) 从 settings.json 迁移 settings + playback
    const legacySettingsPath = path.join(os.homedir(), '.la', 'settings.json');
    if (fs.existsSync(legacySettingsPath)) {
      try {
        const raw = fs.readFileSync(legacySettingsPath, 'utf-8');
        const allSettings: Record<string, string> = JSON.parse(raw);
        // playback 键全局存储
        if (allSettings['playback']) {
          data.playback['_json'] = allSettings['playback'];
          delete allSettings['playback'];
        }
        data.settings = allSettings;
        logger.info('[UserDataStore] Migrated settings from', legacySettingsPath);
      } catch (e) {
        logger.warn('[UserDataStore] Failed to migrate settings:', e);
      }
    }

    // 2) 尝试从 library-index.json 迁移 tracks（走 IPC 传入，这里不做）
    // 实际的 track 迁移在渲染层 save 时自动完成（buildMinimalTracks + dual-write）

    if (this.save(data)) {
      logger.info('[UserDataStore] users.json created at', this.filePath);
    } else {
      logger.error('[UserDataStore] Failed to create users.json at', this.filePath);
    }
  }
}

export const userDataStore = new UserDataStore();
