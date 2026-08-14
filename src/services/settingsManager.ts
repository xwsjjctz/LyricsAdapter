import { logger } from './logger';
import { appStorage } from './appStorage';
import type { OnlineSource as OnlineMusicSource } from './onlineMusicProvider';

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

/** Which online music source is active in Browse/Search. Mirrors `OnlineSource` in onlineMusicProvider. */
export type OnlineSource = OnlineMusicSource;

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
  private focusLyricsFontSize: number = 30;
  private focusLyricLineSpacing: number = 32;
  private focusInactiveLyricBlur: number = 2;
  private listeners: Set<Listener> = new Set();
  /** Prevent an older failed async write from rolling back a newer value. */
  private persistenceRevisions = new Map<string, number>();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      this.downloadPath = '';
      this.floatingPanel = false;
      this.bgBlurTrans = 1.0;
      this.qqMusicEnabled = false;
      this.onlineSource = 'qq';
      this.glassUI = false;
      this.gsapButtonBounce = true;
      this.focusBgBlurRadius = 80;
      this.focusLyricsFontSize = 30;
      this.focusLyricLineSpacing = 32;
      this.focusInactiveLyricBlur = 2;

      this.downloadPath = appStorage.getItem(DOWNLOAD_PATH_KEY) || '';

      this.floatingPanel = appStorage.getItem(FLOATING_PANEL_KEY) === 'true';

      const bt = appStorage.getItem(BG_BLUR_TRANS_KEY);
      if (bt) {
        const parsed = parseFloat(bt);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          this.bgBlurTrans = parsed;
        }
      }

      this.qqMusicEnabled = appStorage.getItem(QQ_MUSIC_ENABLED_KEY) === 'true';

      const storedSource = appStorage.getItem(ONLINE_SOURCE_KEY);
      this.onlineSource = storedSource === 'netease' || storedSource === 'soda' ? storedSource : 'qq';

      this.glassUI = appStorage.getItem(GLASS_UI_KEY) === 'true';

      this.gsapButtonBounce = appStorage.getItem(GSAP_BUTTON_BOUNCE_KEY) !== 'false';

      const blurRadius = appStorage.getItem(FOCUS_BG_BLUR_RADIUS_KEY);
      if (blurRadius) {
        const parsed = parseFloat(blurRadius);
        if (!isNaN(parsed)) {
          this.focusBgBlurRadius = Math.max(40, Math.min(80, parsed));
        }
      }

      const lyricFontSize = appStorage.getItem(FOCUS_LYRICS_FONT_SIZE_KEY);
      if (lyricFontSize) {
        const parsed = parseFloat(lyricFontSize);
        if (!isNaN(parsed)) {
          this.focusLyricsFontSize = Math.max(16, Math.min(40, parsed));
        }
      }

      const lyricLineSpacing = appStorage.getItem(FOCUS_LYRIC_LINE_SPACING_KEY);
      if (lyricLineSpacing) {
        const parsed = parseFloat(lyricLineSpacing);
        if (!isNaN(parsed)) {
          this.focusLyricLineSpacing = Math.max(12, Math.min(48, parsed));
        }
      }

      const inactiveLyricBlur = appStorage.getItem(FOCUS_INACTIVE_LYRIC_BLUR_KEY);
      if (inactiveLyricBlur) {
        const parsed = parseFloat(inactiveLyricBlur);
        if (!isNaN(parsed)) {
          this.focusInactiveLyricBlur = Math.max(0, Math.min(12, parsed));
        }
      }
    } catch (error) {
      logger.error('[SettingsManager] Failed to load from settings store:', error);
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

  private async persistSetting(
    key: string,
    value: string,
    rollback: () => void,
    notifyOnRollback = true,
  ): Promise<boolean> {
    const revision = (this.persistenceRevisions.get(key) ?? 0) + 1;
    this.persistenceRevisions.set(key, revision);
    try {
      await appStorage.setItem(key, value);
      return true;
    } catch (error) {
      if (this.persistenceRevisions.get(key) === revision) {
        rollback();
        if (notifyOnRollback) this.notify();
      }
      logger.error(`[SettingsManager] Failed to persist ${key}; rolled back current runtime state when safe:`, error);
      return false;
    }
  }

  // --- Download Path ---

  setDownloadPath(path: string): Promise<boolean> {
    const previous = this.downloadPath;
    this.downloadPath = path;
    const persisted = this.persistSetting(DOWNLOAD_PATH_KEY, path, () => { this.downloadPath = previous; }, false);
    logger.debug('[SettingsManager] Download path saved:', path);
    return persisted;
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
  setFloatingPanel(enabled: boolean): Promise<boolean> {
    const previous = this.floatingPanel;
    this.floatingPanel = enabled;
    const persisted = this.persistSetting(FLOATING_PANEL_KEY, enabled ? 'true' : 'false', () => { this.floatingPanel = previous; });
    this.notify();
    logger.debug(`[SettingsManager] Floating panel set to: ${enabled}`);
    return persisted;
  }

  // --- Background Blur Transparency ---

  getBgBlurTrans(): number {
    return this.bgBlurTrans;
  }

  setBgBlurTrans(value: number): Promise<boolean> {
    const previous = this.bgBlurTrans;
    this.bgBlurTrans = Math.max(0, Math.min(1, value));
    const persisted = this.persistSetting(BG_BLUR_TRANS_KEY, String(this.bgBlurTrans), () => { this.bgBlurTrans = previous; });
    this.notify();
    logger.debug(`[SettingsManager] bgBlurTrans set to: ${this.bgBlurTrans}`);
    return persisted;
  }

  // --- QQ Music Enabled ---

  getQqMusicEnabled(): boolean {
    return this.qqMusicEnabled;
  }

  setQqMusicEnabled(enabled: boolean): Promise<boolean> {
    const previous = this.qqMusicEnabled;
    this.qqMusicEnabled = enabled;
    const persisted = this.persistSetting(QQ_MUSIC_ENABLED_KEY, enabled ? 'true' : 'false', () => { this.qqMusicEnabled = previous; });
    this.notify();
    logger.debug(`[SettingsManager] QQ Music enabled set to: ${enabled}`);
    return persisted;
  }

  // --- Online Source (QQ Music / NetEase Cloud Music / Soda Music) ---

  getOnlineSource(): OnlineSource {
    return this.onlineSource;
  }

  setOnlineSource(source: OnlineSource): Promise<boolean> {
    const previous = this.onlineSource;
    this.onlineSource = source;
    const persisted = this.persistSetting(ONLINE_SOURCE_KEY, source, () => { this.onlineSource = previous; });
    this.notify();
    logger.debug(`[SettingsManager] Online source set to: ${source}`);
    return persisted;
  }

  // --- Glass UI (frosted header & control bar) ---
  // @deprecated Frosted Glass UI 已从实验性功能移除，暂时停用。后续迭代或移除。

  /** @deprecated Frosted Glass UI 已停用，恒为 false，后续迭代或移除 */
  getGlassUI(): boolean {
    return this.glassUI;
  }

  /** @deprecated Frosted Glass UI 已停用，后续迭代或移除 */
  setGlassUI(enabled: boolean): Promise<boolean> {
    const previous = this.glassUI;
    this.glassUI = enabled;
    const persisted = this.persistSetting(GLASS_UI_KEY, enabled ? 'true' : 'false', () => { this.glassUI = previous; });
    this.notify();
    logger.debug(`[SettingsManager] Glass UI set to: ${enabled}`);
    return persisted;
  }

  // --- GSAP Button Bounce ---

  getGsapButtonBounce(): boolean {
    return this.gsapButtonBounce;
  }

  setGsapButtonBounce(enabled: boolean): Promise<boolean> {
    const previous = this.gsapButtonBounce;
    this.gsapButtonBounce = enabled;
    const persisted = this.persistSetting(GSAP_BUTTON_BOUNCE_KEY, enabled ? 'true' : 'false', () => { this.gsapButtonBounce = previous; });
    this.notify();
    logger.debug(`[SettingsManager] GSAP button bounce set to: ${enabled}`);
    return persisted;
  }

  // --- Focus Mode Background Blur Radius ---

  getFocusBgBlurRadius(): number {
    return this.focusBgBlurRadius;
  }

  setFocusBgBlurRadius(value: number): Promise<boolean> {
    const previous = this.focusBgBlurRadius;
    this.focusBgBlurRadius = Math.max(40, Math.min(80, value));
    const persisted = this.persistSetting(FOCUS_BG_BLUR_RADIUS_KEY, String(this.focusBgBlurRadius), () => { this.focusBgBlurRadius = previous; });
    this.notify();
    logger.debug(`[SettingsManager] Focus Mode blur radius set to: ${this.focusBgBlurRadius}`);
    return persisted;
  }

  // --- Focus Mode Lyric Font Size ---

  getFocusLyricsFontSize(): number {
    return this.focusLyricsFontSize;
  }

  setFocusLyricsFontSize(value: number): Promise<boolean> {
    const previous = this.focusLyricsFontSize;
    this.focusLyricsFontSize = Math.max(16, Math.min(40, value));
    const persisted = this.persistSetting(FOCUS_LYRICS_FONT_SIZE_KEY, String(this.focusLyricsFontSize), () => { this.focusLyricsFontSize = previous; });
    this.notify();
    logger.debug(`[SettingsManager] Focus Mode lyric font size set to: ${this.focusLyricsFontSize}`);
    return persisted;
  }

  // --- Focus Mode Lyric Line Spacing ---

  getFocusLyricLineSpacing(): number {
    return this.focusLyricLineSpacing;
  }

  setFocusLyricLineSpacing(value: number): Promise<boolean> {
    const previous = this.focusLyricLineSpacing;
    this.focusLyricLineSpacing = Math.max(12, Math.min(48, value));
    const persisted = this.persistSetting(FOCUS_LYRIC_LINE_SPACING_KEY, String(this.focusLyricLineSpacing), () => { this.focusLyricLineSpacing = previous; });
    this.notify();
    logger.debug(`[SettingsManager] Focus Mode lyric line spacing set to: ${this.focusLyricLineSpacing}`);
    return persisted;
  }

  // --- Focus Mode Inactive Lyric Blur ---

  getFocusInactiveLyricBlur(): number {
    return this.focusInactiveLyricBlur;
  }

  setFocusInactiveLyricBlur(value: number): Promise<boolean> {
    const previous = this.focusInactiveLyricBlur;
    this.focusInactiveLyricBlur = Math.max(0, Math.min(12, value));
    const persisted = this.persistSetting(FOCUS_INACTIVE_LYRIC_BLUR_KEY, String(this.focusInactiveLyricBlur), () => { this.focusInactiveLyricBlur = previous; });
    this.notify();
    logger.debug(`[SettingsManager] Focus Mode inactive lyric blur set to: ${this.focusInactiveLyricBlur}`);
    return persisted;
  }

  // --- Legacy (kept for backward compatibility, no-op now) ---

  async ensureLoaded(): Promise<void> {
    // No-op: AppStorage is initialized before UI modules are imported.
    // 保留以兼容旧调用点；真正的初始化在构造时 loadFromStorage() 完成。
  }

  /**
   * 重新从 appStorage 加载全部设置并通知订阅者。
   *
   * settingsManager 在模块导入时同步 loadFromStorage()，但此时 appStorage.init()
   * 可能尚未完成（尤其清空 userData 后内存 cache 为空，需从 ~/.la/settings.json
   * 异步恢复）。useLibraryLoad 在 appStorage 完成恢复后调用本方法，
   * 使偏好设置（下载路径、在线源、模糊度等）在不重启的前提下恢复生效。
   */
  reload(): void {
    this.loadFromStorage();
    this.notify();
    logger.info('[SettingsManager] Settings reloaded after settings restore');
  }
}

export const settingsManager = new SettingsManager();
