import { logger } from './logger';
import { indexedDBStorage } from './indexedDBStorage';

const DOWNLOAD_PATH_KEY = 'download_path';
const FLOATING_PANEL_KEY = 'floating_panel';

type Listener = () => void;

class SettingsManager {
  private downloadPath: string = '';
  private floatingPanel: boolean = false;
  private initPromise: Promise<void>;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.initPromise = this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    try {
      await indexedDBStorage.initialize();

      const [storedPath, storedFloatingPanel] = await Promise.all([
        indexedDBStorage.getSetting(DOWNLOAD_PATH_KEY),
        indexedDBStorage.getSetting(FLOATING_PANEL_KEY),
      ]);

      if (storedPath) {
        this.downloadPath = storedPath;
        logger.debug('[SettingsManager] Download path loaded from storage:', storedPath);
      }

      if (storedFloatingPanel === 'true') {
        this.floatingPanel = true;
        logger.debug('[SettingsManager] Floating panel enabled from storage');
      }
    } catch (error) {
      logger.error('[SettingsManager] Failed to load from storage:', error);
    }
  }

  private async saveToStorage(): Promise<void> {
    try {
      await Promise.all([
        indexedDBStorage.setSetting(DOWNLOAD_PATH_KEY, this.downloadPath),
        indexedDBStorage.setSetting(FLOATING_PANEL_KEY, this.floatingPanel ? 'true' : 'false'),
      ]);
    } catch (error) {
      logger.error('[SettingsManager] Failed to save to storage:', error);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
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

  getFloatingPanel(): boolean {
    return this.floatingPanel;
  }

  setFloatingPanel(enabled: boolean): void {
    this.floatingPanel = enabled;
    this.saveToStorage();
    this.notify();
    logger.debug(`[SettingsManager] Floating panel set to: ${enabled}`);
  }

  async ensureLoaded(): Promise<void> {
    await this.initPromise;
  }
}

export const settingsManager = new SettingsManager();
