/**
 * JSON file–based settings store (main process).
 *
 * Path: ~/.la/settings.json (跨平台用户目录下的隐藏文件夹)
 *
 * Sensitive fields (WebDAV 密码、QQ/网易云 cookie) 使用 Electron 内置
 * safeStorage API 加密后落盘，密钥由 OS 管理（macOS Keychain / Windows DPAPI）。
 *
 * 浏览器模式无法使用 safeStorage，回退到明文 localStorage。
 */
import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../logger';

/** 需要加密存储的键名集合。 */
const SENSITIVE_KEYS = new Set([
  'webdav-config',
  'qq_music_cookie',
  'netease_cookie',
]);

/** 加密前缀标记 —— 存在磁盘的值以 "enc:" 开头表示已加密。 */
const ENC_PREFIX = 'enc:';

class SettingsStore {
  private data: Record<string, string> = {};
  private filePath: string;
  private dirPath: string;

  constructor() {
    this.dirPath = path.join(os.homedir(), '.la');
    this.filePath = path.join(this.dirPath, 'settings.json');
    this.ensureDir();
    this.migrateFromLegacy();
    this.load();
  }

  // ========== 文件路径管理 ==========

  private ensureDir(): void {
    try {
      if (!fs.existsSync(this.dirPath)) {
        fs.mkdirSync(this.dirPath, { recursive: true });
        logger.info('[SettingsStore] Created directory:', this.dirPath);
      }
    } catch (e) {
      logger.error('[SettingsStore] Failed to create directory:', e);
    }
  }

  /**
   * 从旧位置 (~/Library/Application Support/LyricsAdapter/settings.json)
   * 迁移到新位置 (~/.la/settings.json)。
   * 仅在新文件不存在且旧文件存在时执行；迁移后不删除旧文件。
   */
  private migrateFromLegacy(): void {
    try {
      if (fs.existsSync(this.filePath)) return; // 新文件已存在
      const legacyPath = path.join(app.getPath('userData'), 'settings.json');
      if (!fs.existsSync(legacyPath)) return; // 旧文件不存在
      const content = fs.readFileSync(legacyPath, 'utf-8');
      const parsed = JSON.parse(content);
      fs.writeFileSync(this.filePath, JSON.stringify(parsed, null, 2), 'utf-8');
      logger.info('[SettingsStore] Migrated settings from legacy path:', legacyPath);
    } catch (e) {
      logger.warn('[SettingsStore] Migration from legacy path failed:', e);
    }
  }

  /** 仅暴露目录路径供日记使用。 */
  getDirectoryPath(): string {
    return this.dirPath;
  }

  // ========== 加密 / 解密 ==========

  private isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  /**
   * 加密敏感值。返回带 enc: 前缀的 hex 字符串。
   * 如果 safeStorage 不可用，返回原值（明文后备）。
   */
  private encrypt(plaintext: string): string {
    if (!this.isEncryptionAvailable()) {
      logger.warn('[SettingsStore] safeStorage unavailable, storing sensitive field as plaintext');
      return plaintext;
    }
    try {
      const encrypted = safeStorage.encryptString(plaintext);
      return ENC_PREFIX + encrypted.toString('hex');
    } catch (e) {
      logger.error('[SettingsStore] Encryption failed, storing as plaintext:', e);
      return plaintext;
    }
  }

  /**
   * 解密带 enc: 前缀的值。非 enc: 前缀的返回原值（兼容未加密遗留数据）。
   */
  private decrypt(stored: string): string {
    if (!stored.startsWith(ENC_PREFIX)) return stored; // 未加密的遗留数据
    if (!this.isEncryptionAvailable()) {
      logger.warn('[SettingsStore] safeStorage unavailable, cannot decrypt sensitive field');
      return '';
    }
    try {
      const hex = stored.slice(ENC_PREFIX.length);
      const buffer = Buffer.from(hex, 'hex');
      return safeStorage.decryptString(buffer);
    } catch (e) {
      logger.error('[SettingsStore] Decryption failed:', e);
      return '';
    }
  }

  /** 判断一个值是否需要解密（带 enc: 前缀）。 */
  private isEncrypted(stored: string): boolean {
    return stored.startsWith(ENC_PREFIX);
  }

  // ========== 加载 / 保存 ==========

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw);
        logger.info('[SettingsStore] Loaded', Object.keys(this.data).length, 'keys from', this.filePath);
      } else {
        this.data = {};
        logger.info('[SettingsStore] No existing settings file, starting fresh');
      }
    } catch (e) {
      logger.error('[SettingsStore] Failed to load settings:', e);
      this.data = {};
    }
  }

  private save(): void {
    try {
      this.ensureDir();
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      logger.error('[SettingsStore] Failed to save settings:', e);
    }
  }

  // ========== 公开 API ==========

  /**
   * Get a single value by key.
   * 敏感字段自动解密后返回。
   */
  get(key: string): string | undefined {
    const stored = this.data[key];
    if (stored === undefined) return undefined;
    return this.isEncrypted(stored) ? this.decrypt(stored) : stored;
  }

  /**
   * Get a copy of all key/value pairs.
   * 敏感字段自动解密。
   */
  getAll(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, stored] of Object.entries(this.data)) {
      result[key] = this.isEncrypted(stored) ? this.decrypt(stored) : stored;
    }
    return result;
  }

  /**
   * Set a single value and flush to disk.
   * 敏感字段自动加密后存储。
   */
  set(key: string, value: string): void {
    if (SENSITIVE_KEYS.has(key)) {
      this.data[key] = this.encrypt(value);
    } else {
      this.data[key] = value;
    }
    this.save();
  }

  /**
   * 批量写入并 flush。用于一次性保存大量设置（如播放状态）。
   * 敏感字段自动加密。
   */
  setMany(entries: Record<string, string>): void {
    for (const [key, value] of Object.entries(entries)) {
      if (SENSITIVE_KEYS.has(key)) {
        this.data[key] = this.encrypt(value);
      } else {
        this.data[key] = value;
      }
    }
    this.save();
  }

  /** Delete a key and flush to disk. */
  delete(key: string): void {
    delete this.data[key];
    this.save();
  }

  /** Replace all entries and flush to disk. */
  replaceAll(entries: Record<string, string>): void {
    this.data = {};
    for (const [key, value] of Object.entries(entries)) {
      if (SENSITIVE_KEYS.has(key)) {
        this.data[key] = this.encrypt(value);
      } else {
        this.data[key] = value;
      }
    }
    this.save();
  }
}

export const settingsStore = new SettingsStore();
