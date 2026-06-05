import { logger } from './logger';
import { indexedDBStorage } from './indexedDBStorage';

const DOWNLOAD_PATH_KEY = 'download_path';
const FLOATING_PANEL_KEY = 'floating_panel';
const BG_BLUR_TRANS_KEY = 'bg_blur_trans';

type Listener = () => void;

class SettingsManager {
  private downloadPath: string = '';
  private floatingPanel: boolean = false;
  private bgBlurTrans: number = 1.0;
  private initPromise: Promise<void>;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.initPromise = this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    try {
      await indexedDBStorage.initialize();

      const [storedPath, storedFloatingPanel, storedBgBlurTrans] = await Promise.all([
        indexedDBStorage.getSetting(DOWNLOAD_PATH_KEY),
        indexedDBStorage.getSetting(FLOATING_PANEL_KEY),
        indexedDBStorage.getSetting(BG_BLUR_TRANS_KEY),
      ]);

      if (storedPath) {
        this.downloadPath = storedPath;
        logger.debug('[SettingsManager] Download path loaded from storage:', storedPath);
      }

      if (storedFloatingPanel === 'true') {
        this.floatingPanel = true;
        logger.debug('[SettingsManager] Floating panel enabled from storage');
      }

      if (storedBgBlurTrans) {
        const parsed = parseFloat(storedBgBlurTrans);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          this.bgBlurTrans = parsed;
          logger.debug('[SettingsManager] bgBlurTrans loaded from storage:', parsed);
        }
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
        indexedDBStorage.setSetting(BG_BLUR_TRANS_KEY, String(this.bgBlurTrans)),
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

  getBgBlurTrans(): number {
    return this.bgBlurTrans;
  }

  setBgBlurTrans(value: number): void {
    this.bgBlurTrans = Math.max(0, Math.min(1, value));
    this.saveToStorage();
    this.notify();
    logger.debug(`[SettingsManager] bgBlurTrans set to: ${this.bgBlurTrans}`);
  }

  async ensureLoaded(): Promise<void> {
    await this.initPromise;
  }
}

export const settingsManager = new SettingsManager();
