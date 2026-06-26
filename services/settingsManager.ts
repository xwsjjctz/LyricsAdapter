import { logger } from './logger';

const DOWNLOAD_PATH_KEY = 'la_download_path';
const FLOATING_PANEL_KEY = 'la_floating_panel';
const BG_BLUR_TRANS_KEY = 'la_bg_blur_trans';
const QQ_MUSIC_ENABLED_KEY = 'la_qq_music_enabled';
const GLASS_UI_KEY = 'la_glass_ui';
const GSAP_BUTTON_BOUNCE_KEY = 'la_gsap_button_bounce';
const FOCUS_BG_BLUR_RADIUS_KEY = 'la_focus_bg_blur_radius';
const FOCUS_LYRICS_FONT_SIZE_KEY = 'la_focus_lyrics_font_size';

type Listener = () => void;

class SettingsManager {
  private downloadPath: string = '';
  private floatingPanel: boolean = false;
  private bgBlurTrans: number = 1.0;
  private qqMusicEnabled: boolean = false;
  private glassUI: boolean = false;
  // Keep the interaction enabled for existing installations after this setting ships.
  private gsapButtonBounce: boolean = true;
  private focusBgBlurRadius: number = 80;
  private focusLyricsFontSize: number = 24;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      this.downloadPath = localStorage.getItem(DOWNLOAD_PATH_KEY) || '';

      this.floatingPanel = localStorage.getItem(FLOATING_PANEL_KEY) === 'true';

      const bt = localStorage.getItem(BG_BLUR_TRANS_KEY);
      if (bt) {
        const parsed = parseFloat(bt);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          this.bgBlurTrans = parsed;
        }
      }

      this.qqMusicEnabled = localStorage.getItem(QQ_MUSIC_ENABLED_KEY) === 'true';

      this.glassUI = localStorage.getItem(GLASS_UI_KEY) === 'true';

      this.gsapButtonBounce = localStorage.getItem(GSAP_BUTTON_BOUNCE_KEY) !== 'false';

      const blurRadius = localStorage.getItem(FOCUS_BG_BLUR_RADIUS_KEY);
      if (blurRadius) {
        const parsed = parseFloat(blurRadius);
        if (!isNaN(parsed)) {
          this.focusBgBlurRadius = Math.max(40, Math.min(80, parsed));
        }
      }

      const lyricFontSize = localStorage.getItem(FOCUS_LYRICS_FONT_SIZE_KEY);
      if (lyricFontSize) {
        const parsed = parseFloat(lyricFontSize);
        if (!isNaN(parsed)) {
          this.focusLyricsFontSize = Math.max(16, Math.min(40, parsed));
        }
      }
    } catch (error) {
      logger.error('[SettingsManager] Failed to load from localStorage:', error);
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

  // --- Download Path ---

  setDownloadPath(path: string): void {
    this.downloadPath = path;
    try {
      localStorage.setItem(DOWNLOAD_PATH_KEY, path);
    } catch (error) {
      logger.error('[SettingsManager] Failed to save download path:', error);
    }
    logger.debug('[SettingsManager] Download path saved:', path);
  }

  getDownloadPath(): string {
    return this.downloadPath;
  }

  hasDownloadPath(): boolean {
    return !!this.downloadPath;
  }

  // --- Floating Panel ---

  getFloatingPanel(): boolean {
    return this.floatingPanel;
  }

  setFloatingPanel(enabled: boolean): void {
    this.floatingPanel = enabled;
    try {
      localStorage.setItem(FLOATING_PANEL_KEY, enabled ? 'true' : 'false');
    } catch (error) {
      logger.error('[SettingsManager] Failed to save floating panel:', error);
    }
    this.notify();
    logger.debug(`[SettingsManager] Floating panel set to: ${enabled}`);
  }

  // --- Background Blur Transparency ---

  getBgBlurTrans(): number {
    return this.bgBlurTrans;
  }

  setBgBlurTrans(value: number): void {
    this.bgBlurTrans = Math.max(0, Math.min(1, value));
    try {
      localStorage.setItem(BG_BLUR_TRANS_KEY, String(this.bgBlurTrans));
    } catch (error) {
      logger.error('[SettingsManager] Failed to save bgBlurTrans:', error);
    }
    this.notify();
    logger.debug(`[SettingsManager] bgBlurTrans set to: ${this.bgBlurTrans}`);
  }

  // --- QQ Music Enabled ---

  getQqMusicEnabled(): boolean {
    return this.qqMusicEnabled;
  }

  setQqMusicEnabled(enabled: boolean): void {
    this.qqMusicEnabled = enabled;
    try {
      localStorage.setItem(QQ_MUSIC_ENABLED_KEY, enabled ? 'true' : 'false');
    } catch (error) {
      logger.error('[SettingsManager] Failed to save QQ Music enabled:', error);
    }
    this.notify();
    logger.debug(`[SettingsManager] QQ Music enabled set to: ${enabled}`);
  }

  // --- Glass UI (frosted header & control bar) ---

  getGlassUI(): boolean {
    return this.glassUI;
  }

  setGlassUI(enabled: boolean): void {
    this.glassUI = enabled;
    try {
      localStorage.setItem(GLASS_UI_KEY, enabled ? 'true' : 'false');
    } catch (error) {
      logger.error('[SettingsManager] Failed to save glass UI:', error);
    }
    this.notify();
    logger.debug(`[SettingsManager] Glass UI set to: ${enabled}`);
  }

  // --- GSAP Button Bounce ---

  getGsapButtonBounce(): boolean {
    return this.gsapButtonBounce;
  }

  setGsapButtonBounce(enabled: boolean): void {
    this.gsapButtonBounce = enabled;
    try {
      localStorage.setItem(GSAP_BUTTON_BOUNCE_KEY, enabled ? 'true' : 'false');
    } catch (error) {
      logger.error('[SettingsManager] Failed to save GSAP button bounce:', error);
    }
    this.notify();
    logger.debug(`[SettingsManager] GSAP button bounce set to: ${enabled}`);
  }

  // --- Focus Mode Background Blur Radius ---

  getFocusBgBlurRadius(): number {
    return this.focusBgBlurRadius;
  }

  setFocusBgBlurRadius(value: number): void {
    this.focusBgBlurRadius = Math.max(40, Math.min(80, value));
    try {
      localStorage.setItem(FOCUS_BG_BLUR_RADIUS_KEY, String(this.focusBgBlurRadius));
    } catch (error) {
      logger.error('[SettingsManager] Failed to save Focus Mode blur radius:', error);
    }
    this.notify();
    logger.debug(`[SettingsManager] Focus Mode blur radius set to: ${this.focusBgBlurRadius}`);
  }

  // --- Focus Mode Lyric Font Size ---

  getFocusLyricsFontSize(): number {
    return this.focusLyricsFontSize;
  }

  setFocusLyricsFontSize(value: number): void {
    this.focusLyricsFontSize = Math.max(16, Math.min(40, value));
    try {
      localStorage.setItem(FOCUS_LYRICS_FONT_SIZE_KEY, String(this.focusLyricsFontSize));
    } catch (error) {
      logger.error('[SettingsManager] Failed to save Focus Mode lyric font size:', error);
    }
    this.notify();
    logger.debug(`[SettingsManager] Focus Mode lyric font size set to: ${this.focusLyricsFontSize}`);
  }

  // --- Legacy (kept for backward compatibility, no-op now) ---

  async ensureLoaded(): Promise<void> {
    // No-op: all settings are synchronous via localStorage
  }
}

export const settingsManager = new SettingsManager();
