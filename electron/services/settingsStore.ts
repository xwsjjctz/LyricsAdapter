/**
 * JSON file–based settings store (main process).
 *
 * Replaces renderer‑side localStorage with durable disk persistence.
 * Combined with the origin unification (feat/unified-origin), this ensures
 * settings, WebDAV credentials, theme, shortcuts etc. are shared between
 * dev (app://localhost) and production builds.
 *
 * The file is written to {userData}/settings.json.
 * All methods are synchronous (the file is held in memory and flushed on write).
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

class SettingsStore {
  private data: Record<string, string> = {};
  private filePath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, 'settings.json');
    this.load();
  }

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
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      logger.error('[SettingsStore] Failed to save settings:', e);
    }
  }

  /** Get a single value by key. Returns undefined if key not found. */
  get(key: string): string | undefined {
    return this.data[key];
  }

  /** Get a copy of all key/value pairs. */
  getAll(): Record<string, string> {
    return { ...this.data };
  }

  /** Set a single value and flush to disk. */
  set(key: string, value: string): void {
    this.data[key] = value;
    this.save();
  }

  /** Delete a key and flush to disk. */
  delete(key: string): void {
    delete this.data[key];
    this.save();
  }

  /** Replace all entries and flush to disk. */
  replaceAll(entries: Record<string, string>): void {
    this.data = { ...entries };
    this.save();
  }
}

export const settingsStore = new SettingsStore();
