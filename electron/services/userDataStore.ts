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

// ========== 类型定义 ==========

/** users.json 中一条曲目的最小化结构（仅用户不可重建的字段）。 */
export interface UserTrackRecord {
  id: string;
  slotId?: 'local' | 'cloud' | 'online' | 'playlist';
  filePath?: string;
  webdavPath?: string;
  fileName?: string;
  fileSize?: number;
  lastModified?: number;
  source?: string;
  addedAt?: string;
  playCount?: number;
  lastPlayed?: string | null;
  songmid?: string;
  available?: boolean;
}

export interface UserDataFile {
  tracks: UserTrackRecord[];
  settings: Record<string, string>;
  playback: Record<string, string>;
}

// ========== 敏感字段加密（复用 settingsStore 逻辑） ==========

const SENSITIVE_KEYS = new Set([
  'webdav-config',
  'qq_music_cookie',
  'netease_cookie',
]);

const ENC_PREFIX = 'enc:';

function isEncryptionAvailable(): boolean {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function encrypt(plaintext: string): string {
  if (!isEncryptionAvailable()) return plaintext;
  try {
    const buf = safeStorage.encryptString(plaintext);
    return ENC_PREFIX + buf.toString('hex');
  } catch {
    return plaintext;
  }
}

function decrypt(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  if (!isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'hex'));
  } catch {
    return '';
  }
}

/** 对 settings 中敏感字段加密后返回新对象。已带 enc: 前缀的跳过。 */
function encryptSettings(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) {
    // 避免双重加密：settings.json 中敏感字段可能已被 settingsStore 加密
    out[k] = (SENSITIVE_KEYS.has(k) && !v.startsWith(ENC_PREFIX)) ? encrypt(v) : v;
  }
  return out;
}

/** 对 settings 中敏感字段解密后返回新对象。 */
function decryptSettings(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) {
    out[k] = SENSITIVE_KEYS.has(k) ? decrypt(v) : v;
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

  /** 完整读取 users.json。文件不存在返回默认结构。 */
  load(): UserDataFile {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed: UserDataFile = JSON.parse(raw);
        // 解密 settings 中的敏感字段
        parsed.settings = decryptSettings(parsed.settings || {});
        return parsed;
      }
    } catch (e) {
      logger.error('[UserDataStore] Failed to load:', e);
    }
    return { tracks: [], settings: {}, playback: {} };
  }

  /** 完整写入 users.json。settings 中的敏感字段自动加密。 */
  save(data: UserDataFile): void {
    try {
      this.ensureDir();
      const toWrite: UserDataFile = {
        tracks: data.tracks,
        settings: encryptSettings(data.settings || {}),
        playback: data.playback || {},
      };
      fs.writeFileSync(this.filePath, JSON.stringify(toWrite, null, 2), 'utf-8');
    } catch (e) {
      logger.error('[UserDataStore] Failed to save:', e);
    }
  }

  /** 只替换 tracks 列表（不清除 settings/playback）。 */
  saveTracks(tracks: UserTrackRecord[]): void {
    const existing = this.load();
    existing.tracks = tracks;
    this.save(existing);
  }

  /** 只替换 settings。 */
  saveSettings(settings: Record<string, string>): void {
    const existing = this.load();
    existing.settings = settings;
    this.save(existing);
  }

  /** 只替换 playback。 */
  savePlayback(playback: Record<string, string>): void {
    const existing = this.load();
    existing.playback = playback;
    this.save(existing);
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
    if (fs.existsSync(this.filePath)) return;

    logger.info('[UserDataStore] First run — migrating legacy data to', this.filePath);
    const data: UserDataFile = { tracks: [], settings: {}, playback: {} };

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

    this.save(data);
    logger.info('[UserDataStore] users.json created at', this.filePath);
  }
}

export const userDataStore = new UserDataStore();
