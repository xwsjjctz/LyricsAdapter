import { logger } from './logger';
import { indexedDBStorage } from './indexedDBStorage';

const DOWNLOAD_PATH_KEY = 'download_path';

class SettingsManager {
  private downloadPath: string = '';
  private initialized: boolean = false;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    try {
      await indexedDBStorage.initialize();
      this.initialized = true;

      const storedPath = await indexedDBStorage.getSetting(DOWNLOAD_PATH_KEY);
      if (storedPath) {
        this.downloadPath = storedPath;
        logger.debug('[SettingsManager] Download path loaded from storage:', storedPath);
      }
    } catch (error) {
      logger.error('[SettingsManager] Failed to load from storage:', error);
    }
  }

  private async saveToStorage(): Promise<void> {
    try {
      await indexedDBStorage.setSetting(DOWNLOAD_PATH_KEY, this.downloadPath);
    } catch (error) {
      logger.error('[SettingsManager] Failed to save to storage:', error);
    }
  }

  async setDownloadPath(path: string): Promise<void> {
    this.downloadPath = path;
    await this.saveToStorage();
    logger.debug('[SettingsManager] Download path saved:', path);
  }

  getDownloadPath(): string {
    return this.downloadPath;
  }

  hasDownloadPath(): boolean {
    return !!this.downloadPath;
  }

  async ensureLoaded(): Promise<void> {
    await this.initPromise;
  }
}

export const settingsManager = new SettingsManager();
