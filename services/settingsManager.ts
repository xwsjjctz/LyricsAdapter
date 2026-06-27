import { logger } from './logger';

const DOWNLOAD_PATH_KEY = 'la_download_path';
const FLOATING_PANEL_KEY = 'la_floating_panel';
const BG_BLUR_TRANS_KEY = 'la_bg_blur_trans';
const QQ_MUSIC_ENABLED_KEY = 'la_qq_music_enabled';
const ONLINE_SOURCE_KEY = 'la_online_source';
const GLASS_UI_KEY = 'la_glass_ui';
const GSAP_BUTTON_BOUNCE_KEY = 'la_gsap_button_bounce';
const FOCUS_BG_BLUR_RADIUS_KEY = 'la_focus_bg_blur_radius';
const FOCUS_LYRICS_FONT_SIZE_KEY = 'la_focus_lyrics_font_size';
const FOCUS_LYRIC_LINE_SPACING_KEY = 'la_focus_lyric_line_spacing';
const FOCUS_INACTIVE_LYRIC_BLUR_KEY = 'la_focus_inactive_lyric_blur';
const LIQUID_GLASS_KEY = 'la_liquid_glass';

/** Which online music source is active in Browse/Search. Mirrors `OnlineSource` in onlineMusicProvider. */
export type OnlineSource = 'qq' | 'netease';

type Listener = () => void;

class SettingsManager {
  private downloadPath: string = '';
  private floatingPanel: boolean = false;
  private bgBlurTrans: number = 1.0;
  private qqMusicEnabled: boolean = false;
  private onlineSource: OnlineSource = 'qq';
  private glassUI: boolean = false;
  // Keep the interaction enabled for existing installations after this setting ships.
  private gsapButtonBounce: boolean = true;
  private focusBgBlurRadius: number = 80;
  private focusLyricsFontSize: number = 24;
  private focusLyricLineSpacing: number = 32;
  private focusInactiveLyricBlur: number = 2;
  // Liquid Glass (纯CSS液态玻璃) — toolbar buttons + Focus Mode player console.
  private liquidGlass: boolean = true;
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

      const storedSource = localStorage.getItem(ONLINE_SOURCE_KEY);
      this.onlineSource = storedSource === 'netease' ? 'netease' : 'qq';

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

      const lyricLineSpacing = localStorage.getItem(FOCUS_LYRIC_LINE_SPACING_KEY);
      if (lyricLineSpacing) {
        const parsed = parseFloat(lyricLineSpacing);
        if (!isNaN(parsed)) {
          this.focusLyricLineSpacing = Math.max(12, Math.min(48, parsed));
        }
      }

      const inactiveLyricBlur = localStorage.getItem(FOCUS_INACTIVE_LYRIC_BLUR_KEY);
      if (inactiveLyricBlur) {
        const parsed = parseFloat(inactiveLyricBlur);
        if (!isNaN(parsed)) {
          this.focusInactiveLyricBlur = Math.max(0, Math.min(12, parsed));
        }
      }

      // Default to ON; only disable when explicitly stored as 'false'.
      this.liquidGlass = localStorage.getItem(LIQUID_GLASS_KEY) !== 'false';
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
  // @deprecated Floating Panel 已从实验性功能移除，暂时停用。后续迭代或移除。

  /** @deprecated Floating Panel 已停用，恒为 false，后续迭代或移除 */
  getFloatingPanel(): boolean {
    return this.floatingPanel;
  }

  /** @deprecated Floating Panel 已停用，后续迭代或移除 */
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

  // --- Online Source (QQ Music / NetEase Cloud Music) ---

  getOnlineSource(): OnlineSource {
    return this.onlineSource;
  }

  setOnlineSource(source: OnlineSource): void {
    this.onlineSource = source;
    try {
      localStorage.setItem(ONLINE_SOURCE_KEY, source);
    } catch (error) {
      logger.error('[SettingsManager] Failed to save online source:', error);
    }
    this.notify();
    logger.debug(`[SettingsManager] Online source set to: ${source}`);
  }

  // --- Glass UI (frosted header & control bar) ---
  // @deprecated Frosted Glass UI 已从实验性功能移除，暂时停用。后续迭代或移除。

  /** @deprecated Frosted Glass UI 已停用，恒为 false，后续迭代或移除 */
  getGlassUI(): boolean {
    return this.glassUI;
  }

  /** @deprecated Frosted Glass UI 已停用，后续迭代或移除 */
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

  // --- Focus Mode Lyric Line Spacing ---

  getFocusLyricLineSpacing(): number {
    return this.focusLyricLineSpacing;
  }

  setFocusLyricLineSpacing(value: number): void {
    this.focusLyricLineSpacing = Math.max(12, Math.min(48, value));
    try {
      localStorage.setItem(FOCUS_LYRIC_LINE_SPACING_KEY, String(this.focusLyricLineSpacing));
    } catch (error) {
      logger.error('[SettingsManager] Failed to save Focus Mode lyric line spacing:', error);
    }
    this.notify();
    logger.debug(`[SettingsManager] Focus Mode lyric line spacing set to: ${this.focusLyricLineSpacing}`);
  }

  // --- Focus Mode Inactive Lyric Blur ---

  getFocusInactiveLyricBlur(): number {
    return this.focusInactiveLyricBlur;
  }

  setFocusInactiveLyricBlur(value: number): void {
    this.focusInactiveLyricBlur = Math.max(0, Math.min(12, value));
    try {
      localStorage.setItem(FOCUS_INACTIVE_LYRIC_BLUR_KEY, String(this.focusInactiveLyricBlur));
    } catch (error) {
      logger.error('[SettingsManager] Failed to save Focus Mode inactive lyric blur:', error);
    }
    this.notify();
    logger.debug(`[SettingsManager] Focus Mode inactive lyric blur set to: ${this.focusInactiveLyricBlur}`);
  }

  // --- Liquid Glass (纯CSS液态玻璃) ---

  getLiquidGlass(): boolean {
    return this.liquidGlass;
  }

  setLiquidGlass(enabled: boolean): void {
    this.liquidGlass = enabled;
    try {
      localStorage.setItem(LIQUID_GLASS_KEY, enabled ? 'true' : 'false');
    } catch (error) {
      logger.error('[SettingsManager] Failed to save liquid glass:', error);
    }
    this.notify();
    logger.debug(`[SettingsManager] Liquid glass set to: ${enabled}`);
  }

  // --- Legacy (kept for backward compatibility, no-op now) ---

  async ensureLoaded(): Promise<void> {
    // No-op: all settings are synchronous via localStorage
  }
}

export const settingsManager = new SettingsManager();
