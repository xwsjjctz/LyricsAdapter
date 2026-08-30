import path from 'node:path';
import {
  app,
  Menu,
  Tray,
  nativeImage,
  type MenuItemConstructorOptions,
  type NativeImage,
} from 'electron';
import { APP } from '../../src/constants/config';
import type { SystemLyricsAction, SystemLyricsState } from '../../src/types/systemLyrics';
import { logger } from '../logger';

// A status item competes with the notch and the user's other menu extras.
// Keeping the line compact prevents macOS from moving the whole item out of
// view when a lyric is unusually long.
export const MENU_BAR_LYRICS_MAX_GRAPHEMES = 18;
const MENU_BAR_ICON_NAME = 'music.note';
const MENU_BAR_FALLBACK_ICON_SIZE = 16;

export type MenuBarLyricsActionHandler = (
  action: SystemLyricsAction,
) => void | Promise<void>;

const EMPTY_STATE: SystemLyricsState = {
  trackId: null,
  title: '',
  artist: '',
  line: '',
  nextLine: '',
  isPlaying: false,
};

const EMPTY_ACTION_HANDLER: MenuBarLyricsActionHandler = () => {};

interface MenuBarImage {
  image: NativeImage;
  source: 'system-symbol' | 'application-icon' | 'title-only';
}

function createMenuBarImage(): MenuBarImage {
  try {
    // SF Symbols automatically follows light/dark menu-bar appearance when it
    // is marked as a template image. Unlike createEmpty(), this also leaves a
    // visible status-item anchor when no track is active yet.
    const systemSymbol = nativeImage.createFromNamedImage(MENU_BAR_ICON_NAME);
    if (!systemSymbol.isEmpty()) {
      systemSymbol.setTemplateImage(true);
      return { image: systemSymbol, source: 'system-symbol' };
    }
  } catch (error) {
    logger.warn('[MenuBarLyrics] Native music symbol is unavailable:', error);
  }

  try {
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app-icon.png')
      : path.join(app.getAppPath(), 'app-icon.png');
    const applicationIcon = nativeImage.createFromPath(iconPath);
    if (!applicationIcon.isEmpty()) {
      const resized = applicationIcon.resize({
        width: MENU_BAR_FALLBACK_ICON_SIZE,
        height: MENU_BAR_FALLBACK_ICON_SIZE,
        quality: 'best',
      });
      return {
        image: resized.isEmpty() ? applicationIcon : resized,
        source: 'application-icon',
      };
    }
  } catch (error) {
    logger.warn('[MenuBarLyrics] Application menu-bar icon is unavailable:', error);
  }

  // Retain title-only lyrics as a last-resort fallback instead of disabling the
  // whole surface because an icon could not be decoded.
  const emptyImage = nativeImage.createEmpty();
  emptyImage.setTemplateImage(true);
  return { image: emptyImage, source: 'title-only' };
}

function compactText(value: string | null | undefined): string {
  return value?.replace(/\s+/gu, ' ').trim() ?? '';
}

function splitGraphemes(value: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value),
      segment => segment.segment,
    );
  }
  return Array.from(value);
}

export function truncateMenuBarText(
  value: string,
  maxGraphemes = MENU_BAR_LYRICS_MAX_GRAPHEMES,
): string {
  const compacted = compactText(value);
  const graphemes = splitGraphemes(compacted);
  const safeMaximum = Math.max(1, Math.floor(maxGraphemes));
  if (graphemes.length <= safeMaximum) return compacted;
  if (safeMaximum === 1) return '…';
  return `${graphemes.slice(0, safeMaximum - 1).join('')}…`;
}

/**
 * Formats a status-item title without exposing an unbounded lyric line to the
 * macOS menu bar. When lyrics are unavailable, the track title is still useful;
 * when playback is paused, the last visible line remains in place with a state
 * marker instead of disappearing.
 */
export function formatMenuBarLyricsTitle(
  state: SystemLyricsState,
  maxGraphemes = MENU_BAR_LYRICS_MAX_GRAPHEMES,
): string {
  if (!state.trackId) return APP.NAME;
  const lyric = compactText(state.line);
  const trackTitle = compactText(state.title);

  const content = lyric || `♪ ${trackTitle || APP.NAME}`;
  const title = state.isPlaying ? content : `已暂停 · ${content}`;
  return truncateMenuBarText(title, maxGraphemes);
}

/**
 * Owns the macOS NSStatusItem exposed by Electron's Tray API. The service is
 * deliberately transport-agnostic: renderer/main wiring can feed state through
 * any IPC surface and translate menu clicks back into player intents.
 */
export class MenuBarLyricsService {
  private tray: Tray | null = null;
  private state: SystemLyricsState = EMPTY_STATE;
  private onAction: MenuBarLyricsActionHandler = EMPTY_ACTION_HANDLER;
  private lastTitle = '';
  private menuPlayingState: boolean | null = null;

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  /** Starts the status item. Returns false on unsupported platforms or failure. */
  start(onAction: MenuBarLyricsActionHandler): boolean {
    this.onAction = onAction;
    if (this.platform !== 'darwin') return false;

    if (this.tray && !this.tray.isDestroyed()) {
      this.refreshContextMenu(true);
      this.render();
      return true;
    }

    try {
      const { image, source } = createMenuBarImage();
      this.tray = new Tray(image);
      this.lastTitle = '';
      this.menuPlayingState = null;
      this.refreshContextMenu(true);
      this.render();
      logger.info('[MenuBarLyrics] Status item ready:', {
        iconSource: source,
        bounds: this.tray.getBounds(),
      });
      return true;
    } catch (error) {
      logger.error('[MenuBarLyrics] Failed to start:', error);
      this.destroyTray();
      return false;
    }
  }

  /** Updates the current line and playback state. Safe to call before start(). */
  update(state: SystemLyricsState): void {
    const playbackStateChanged = state.isPlaying !== this.state.isPlaying;
    this.state = { ...state };
    this.refreshContextMenu(playbackStateChanged);
    this.render();
  }

  /** Destroys the status item and clears retained renderer callbacks/state. */
  stop(): void {
    this.destroyTray();
    this.state = EMPTY_STATE;
    this.onAction = EMPTY_ACTION_HANDLER;
    this.lastTitle = '';
    this.menuPlayingState = null;
  }

  private render(): void {
    const tray = this.liveTray();
    if (!tray) return;

    const title = formatMenuBarLyricsTitle(this.state);
    if (title !== this.lastTitle) {
      tray.setTitle(title);
      this.lastTitle = title;
    }

    const trackTitle = compactText(this.state.title);
    const artist = compactText(this.state.artist);
    const stateLabel = this.state.isPlaying ? '正在播放' : '已暂停';
    const trackLabel = [trackTitle, artist].filter(Boolean).join(' — ');
    tray.setToolTip(trackLabel ? `${APP.NAME} — ${stateLabel}：${trackLabel}` : APP.NAME);
  }

  private refreshContextMenu(force = false): void {
    const tray = this.liveTray();
    if (!tray || (!force && this.menuPlayingState === this.state.isPlaying)) return;

    const template: MenuItemConstructorOptions[] = [
      {
        label: this.state.isPlaying ? '暂停' : '播放',
        click: () => this.runAction('toggle-play'),
      },
      { type: 'separator' },
      {
        label: '上一首',
        click: () => this.runAction('previous'),
      },
      {
        label: '下一首',
        click: () => this.runAction('next'),
      },
    ];

    tray.setContextMenu(Menu.buildFromTemplate(template));
    this.menuPlayingState = this.state.isPlaying;
  }

  private runAction(action: SystemLyricsAction): void {
    try {
      void Promise.resolve(this.onAction(action)).catch(error => {
        logger.warn(`[MenuBarLyrics] ${action} action failed:`, error);
      });
    } catch (error) {
      logger.warn(`[MenuBarLyrics] ${action} action failed:`, error);
    }
  }

  private liveTray(): Tray | null {
    if (!this.tray) return null;
    if (!this.tray.isDestroyed()) return this.tray;
    this.tray = null;
    return null;
  }

  private destroyTray(): void {
    const tray = this.liveTray();
    this.tray = null;
    if (tray) tray.destroy();
  }
}

export const menuBarLyricsService = new MenuBarLyricsService();
