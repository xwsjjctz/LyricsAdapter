import { logger } from './logger';

const DOWNLOAD_PATH_KEY = 'download_path';

class SettingsManager {
  private downloadPath: string = '';

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const storedPath = localStorage.getItem(DOWNLOAD_PATH_KEY);
      if (storedPath) {
        this.downloadPath = storedPath;
        logger.debug('[SettingsManager] Download path loaded from storage:', storedPath);
      }
    } catch (error) {
      logger.error('[SettingsManager] Failed to load from storage:', error);
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(DOWNLOAD_PATH_KEY, this.downloadPath);
    } catch (error) {
      logger.error('[SettingsManager] Failed to save to storage:', error);
    }
  }

  setDownloadPath(path: string): void {
    this.downloadPath = path;
    this.saveToStorage();
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
    // In browser/Electron, we can't easily get the Downloads folder
    // So we'll return an empty string and let the user select
    return '';
  }
}

export const settingsManager = new SettingsManager();
