import { logger } from './logger';
import { indexedDBStorage } from './indexedDBStorage';

const DOWNLOAD_PATH_KEY = 'download_path';

class SettingsManager {
  private downloadPath: string = '';

  constructor() {
    this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    try {
      // Initialize IndexedDB first
      await indexedDBStorage.initialize();

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

  // Get the default download path based on platform
  getDefaultDownloadPath(): string {
    // In Electron, we can't easily get the Downloads folder
    // So we'll return an empty string and let the user select
    return '';
  }
}

export const settingsManager = new SettingsManager();
