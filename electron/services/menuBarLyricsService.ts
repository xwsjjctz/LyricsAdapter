import {
  Tray,
  nativeImage,
  type NativeImage,
  type Point,
  type Rectangle,
} from 'electron';
import { APP } from '../../src/constants/config';
import { splitGraphemes } from '../../src/shared/graphemes';
import { normalizeSystemLyricsText } from '../../src/shared/systemLyricsText';
import {
  SYSTEM_LYRICS_WINDOW_GRAPHEMES,
  type SystemLyricsAction,
  type SystemLyricsState,
} from '../../src/types/systemLyrics';
import { logger } from '../logger';
import {
  MACOS_STATUS_ITEM_WIDTH,
  loadMacosStatusbarNativeBridge,
  type MacosStatusbarNativeBridge,
} from '../native/macosStatusbarNative';
import {
  MENU_BAR_CONTROL_STRIP_WIDTH,
  createMenuBarControlImage,
} from './menuBarControlImage';

// Tray.setTitle() has no width API. This padding is retained only as a
// compatibility fallback when the AppKit Node-API module cannot be loaded.
const IDEOGRAPHIC_SPACE = '\u3000';
const CONTROL_REGION_COUNT = 3;
const CONTROL_FALLBACK_GRAPHEMES = SYSTEM_LYRICS_WINDOW_GRAPHEMES
  + CONTROL_REGION_COUNT;
const TEXT_PRESENTATION_SELECTOR = '\ufe0e';

export type MenuBarLyricsActionHandler = (
  action: SystemLyricsAction,
) => void | Promise<void>;

type MacosNativeBridgeLoader = () => MacosStatusbarNativeBridge | null;

const EMPTY_STATE: SystemLyricsState = {
  trackId: null,
  coverUrl: '',
  title: '',
  artist: '',
  line: '',
  nextLine: '',
  isPlaying: false,
  lineCursor: null,
  lineProgress: null,
};

const EMPTY_ACTION_HANDLER: MenuBarLyricsActionHandler = () => {};

function normalizedWindowSize(value: number): number {
  return Math.max(1, Math.floor(value));
}

function padGraphemeWindow(
  graphemes: readonly string[],
  windowSize: number,
): string {
  return [
    ...graphemes.slice(0, windowSize),
    ...Array.from(
      { length: Math.max(0, windowSize - graphemes.length) },
      () => IDEOGRAPHIC_SPACE,
    ),
  ].join('');
}

interface MenuBarLyricsWindow {
  graphemes: string[];
  offset: number;
  isLyric: boolean;
}

function resolveMenuBarLyricsWindow(
  state: SystemLyricsState,
  requestedWindowSize: number,
): MenuBarLyricsWindow {
  const windowSize = normalizedWindowSize(requestedWindowSize);
  const lyric = normalizeSystemLyricsText(state.line);
  const trackTitle = normalizeSystemLyricsText(state.title);
  const content = lyric || trackTitle || APP.NAME;
  const graphemes = splitGraphemes(content);
  if (graphemes.length <= windowSize) {
    return { graphemes, offset: 0, isLyric: lyric.length > 0 };
  }

  const maximumOffset = graphemes.length - windowSize;
  const cursor = state.lineCursor === null || !Number.isFinite(state.lineCursor)
    ? 0
    : Math.max(0, Math.floor(state.lineCursor));
  const cursorAnchor = Math.min(Math.floor(windowSize * 2 / 3), windowSize - 1);
  const offset = Math.min(maximumOffset, Math.max(0, cursor - cursorAnchor));
  return {
    graphemes: graphemes.slice(offset, offset + windowSize),
    offset,
    isLyric: lyric.length > 0,
  };
}

export interface MenuBarLyricsPresentation {
  text: string;
  highlightedGraphemes: number;
}

/** Resolve the visible lyric window and its completed karaoke prefix. */
export function buildMenuBarLyricsPresentation(
  state: SystemLyricsState,
  requestedWindowSize = SYSTEM_LYRICS_WINDOW_GRAPHEMES,
): MenuBarLyricsPresentation {
  const window = resolveMenuBarLyricsWindow(state, requestedWindowSize);
  const absoluteProgress = window.isLyric
    && state.lineProgress !== null
    && Number.isFinite(state.lineProgress)
    ? Math.max(0, Math.floor(state.lineProgress))
    : 0;
  return {
    text: window.graphemes.join(''),
    highlightedGraphemes: Math.min(
      window.graphemes.length,
      Math.max(0, absoluteProgress - window.offset),
    ),
  };
}

/** Padded title used only by the Electron Tray compatibility fallback. */
export function formatMenuBarLyricsTitle(
  state: SystemLyricsState,
  requestedWindowSize = SYSTEM_LYRICS_WINDOW_GRAPHEMES,
): string {
  const windowSize = normalizedWindowSize(requestedWindowSize);
  const window = resolveMenuBarLyricsWindow(state, windowSize);
  return window.graphemes.length < windowSize
    ? padGraphemeWindow(window.graphemes, windowSize)
    : window.graphemes.join('');
}

function centeredControlFallback(controls: readonly string[]): string {
  const graphemes = controls.flatMap((control, index) => (
    index === 0 ? [control] : [IDEOGRAPHIC_SPACE, control]
  ));
  const remaining = Math.max(
    0,
    CONTROL_FALLBACK_GRAPHEMES - graphemes.length,
  );
  const leftPadding = Math.floor(remaining / 2);
  const rightPadding = remaining - leftPadding;
  return [
    IDEOGRAPHIC_SPACE.repeat(leftPadding),
    ...graphemes,
    IDEOGRAPHIC_SPACE.repeat(rightPadding),
  ].join('');
}

/** Text-only fallback when macOS cannot load one of the native SF Symbols. */
export function formatMenuBarControls(isPlaying: boolean): string {
  return centeredControlFallback([
    `⏮${TEXT_PRESENTATION_SELECTOR}`,
    `${isPlaying ? '⏸' : '▶'}${TEXT_PRESENTATION_SELECTOR}`,
    `⏭${TEXT_PRESENTATION_SELECTOR}`,
  ]);
}

/**
 * Owns the macOS status item. AppKit fixes its width and draws the karaoke
 * prefix; player commands remain intents handled by the renderer controller.
 */
export class MenuBarLyricsService {
  private nativeBridge: MacosStatusbarNativeBridge | null = null;
  private tray: Tray | null = null;
  private emptyImage: NativeImage | null = null;
  private state: SystemLyricsState = EMPTY_STATE;
  private onAction: MenuBarLyricsActionHandler = EMPTY_ACTION_HANDLER;
  private lastPresentationKey = '';
  private hovered = false;
  private usingControlImage = false;
  private controlCanvasWidth = MENU_BAR_CONTROL_STRIP_WIDTH;
  private readonly controlImageCache = new Map<string, NativeImage>();
  private controlImageFailedForHover = false;
  private reportedControlImageFallback = false;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly loadNativeBridge: MacosNativeBridgeLoader = (
      () => loadMacosStatusbarNativeBridge(platform)
    ),
  ) {}

  /** Starts the status item. Returns false on unsupported platforms or failure. */
  start(onAction: MenuBarLyricsActionHandler): boolean {
    this.onAction = onAction;
    if (this.platform !== 'darwin') return false;

    if (this.nativeBridge) {
      this.renderNative();
      return true;
    }

    try {
      const bridge = this.loadNativeBridge();
      if (bridge?.startStatusItem(
        {
          width: MACOS_STATUS_ITEM_WIDTH,
          controlStripWidth: MENU_BAR_CONTROL_STRIP_WIDTH,
        },
        action => this.runAction(action),
      )) {
        this.nativeBridge = bridge;
        this.lastPresentationKey = '';
        this.renderNative();
        logger.info('[MenuBarLyrics] Native AppKit status item ready:', {
          width: MACOS_STATUS_ITEM_WIDTH,
          mode: 'fixed-width-karaoke-lyrics-with-native-controls',
        });
        return true;
      }
    } catch (error) {
      logger.warn(
        '[MenuBarLyrics] Native AppKit status item unavailable; using Tray fallback:',
        error,
      );
    }

    return this.startTrayFallback();
  }

  /** Updates the current line and playback state. Safe to call before start(). */
  update(state: SystemLyricsState): void {
    this.state = { ...state };
    if (this.nativeBridge) {
      this.renderNative();
    } else {
      this.renderTrayFallback();
    }
  }

  /** Destroys the status item and clears retained renderer callbacks/state. */
  stop(): void {
    const bridge = this.nativeBridge;
    this.nativeBridge = null;
    if (bridge) {
      try {
        bridge.stopStatusItem();
      } catch (error) {
        logger.warn('[MenuBarLyrics] Failed to stop native AppKit status item:', error);
      }
    }
    this.destroyTray();
    this.state = EMPTY_STATE;
    this.onAction = EMPTY_ACTION_HANDLER;
    this.lastPresentationKey = '';
    this.hovered = false;
    this.usingControlImage = false;
    this.emptyImage = null;
    this.controlImageCache.clear();
    this.controlImageFailedForHover = false;
    this.reportedControlImageFallback = false;
  }

  private renderNative(): void {
    const bridge = this.nativeBridge;
    if (!bridge) return;

    const presentation = buildMenuBarLyricsPresentation(this.state);
    const presentationKey = [
      presentation.text,
      presentation.highlightedGraphemes,
      this.state.isPlaying ? 'playing' : 'paused',
    ].join(':');
    if (presentationKey === this.lastPresentationKey) return;

    try {
      bridge.updateStatusItem({
        text: presentation.text,
        highlightedGraphemes: presentation.highlightedGraphemes,
        isPlaying: this.state.isPlaying,
      });
      this.lastPresentationKey = presentationKey;
    } catch (error) {
      logger.error('[MenuBarLyrics] Failed to update native AppKit status item:', error);
    }
  }

  private startTrayFallback(): boolean {
    const existingTray = this.liveTray();
    if (existingTray) {
      existingTray.setContextMenu(null);
      existingTray.setToolTip('');
      this.renderTrayFallback();
      return true;
    }

    try {
      const emptyImage = nativeImage.createEmpty();
      const tray = new Tray(emptyImage);
      this.tray = tray;
      this.emptyImage = emptyImage;
      this.lastPresentationKey = '';
      this.hovered = false;
      this.usingControlImage = false;
      this.controlImageFailedForHover = false;
      this.reportedControlImageFallback = false;
      tray.setContextMenu(null);
      tray.setIgnoreDoubleClickEvents(true);
      tray.setToolTip('');
      this.bindPointerEvents(tray);
      this.renderTrayFallback();
      logger.warn('[MenuBarLyrics] Tray fallback status item ready; width is not fixed.');
      return true;
    } catch (error) {
      logger.error('[MenuBarLyrics] Failed to start:', error);
      this.destroyTray();
      return false;
    }
  }

  private bindPointerEvents(tray: Tray): void {
    tray.on('mouse-enter', () => {
      if (!this.isLiveTray(tray) || this.hovered) return;
      const measuredWidth = Math.round(tray.getBounds().width);
      this.controlCanvasWidth = Number.isFinite(measuredWidth)
        ? Math.max(MENU_BAR_CONTROL_STRIP_WIDTH, measuredWidth)
        : MENU_BAR_CONTROL_STRIP_WIDTH;
      this.controlImageFailedForHover = false;
      this.hovered = true;
      this.renderTrayFallback();
    });
    tray.on('mouse-leave', () => {
      if (!this.isLiveTray(tray)) return;
      this.hovered = false;
      this.renderTrayFallback();
      this.controlImageFailedForHover = false;
    });
    tray.on('click', (_event, bounds, position) => {
      if (!this.hovered || !this.isLiveTray(tray)) return;
      const action = this.actionAtPosition(bounds, position);
      if (action) this.runAction(action);
    });
  }

  private actionAtPosition(
    bounds: Rectangle,
    position: Point,
  ): SystemLyricsAction | null {
    if (
      !Number.isFinite(bounds.width)
      || !Number.isFinite(position.x)
      || bounds.width <= 0
    ) {
      return null;
    }

    const relativeX = position.x;
    if (relativeX < 0 || relativeX > bounds.width) return null;
    const controlWidth = Math.min(bounds.width, MENU_BAR_CONTROL_STRIP_WIDTH);
    const controlStart = (bounds.width - controlWidth) / 2;
    const controlX = relativeX - controlStart;
    if (controlX < 0 || controlX >= controlWidth) return null;

    const ratio = Math.min(controlX / controlWidth, 1 - Number.EPSILON);
    if (ratio < 1 / CONTROL_REGION_COUNT) return 'previous';
    if (ratio < 2 / CONTROL_REGION_COUNT) return 'toggle-play';
    return 'next';
  }

  private renderTrayFallback(): void {
    const tray = this.liveTray();
    if (!tray) return;

    if (this.hovered) {
      this.renderFallbackControls(tray);
      return;
    }

    const title = formatMenuBarLyricsTitle(this.state);
    const presentationKey = `fallback-lyrics:${title}`;
    if (presentationKey === this.lastPresentationKey) return;

    tray.setTitle(title, { fontType: 'monospaced' });
    if (this.usingControlImage) {
      tray.setImage(this.emptyImage ?? nativeImage.createEmpty());
      this.usingControlImage = false;
    }
    this.lastPresentationKey = presentationKey;
  }

  private renderFallbackControls(tray: Tray): void {
    const cacheKey = `${this.controlCanvasWidth}:${this.state.isPlaying}`;
    let image = this.controlImageFailedForHover
      ? undefined
      : this.controlImageCache.get(cacheKey);
    if (image === undefined && !this.controlImageFailedForHover) {
      const createdImage = createMenuBarControlImage(
        this.state.isPlaying,
        this.controlCanvasWidth,
      );
      if (createdImage) {
        image = createdImage;
        if (this.controlImageCache.size >= 8) this.controlImageCache.clear();
        this.controlImageCache.set(cacheKey, createdImage);
      } else {
        this.controlImageFailedForHover = true;
        if (!this.reportedControlImageFallback) {
          this.reportedControlImageFallback = true;
          logger.warn(
            '[MenuBarLyrics] Native SF Symbol controls unavailable; using text fallback.',
          );
        }
      }
    }

    if (image) {
      const presentationKey = `fallback-controls-image:${cacheKey}`;
      if (presentationKey === this.lastPresentationKey) return;
      tray.setImage(image);
      tray.setTitle('');
      this.usingControlImage = true;
      this.lastPresentationKey = presentationKey;
      return;
    }

    const title = formatMenuBarControls(this.state.isPlaying);
    const presentationKey = `fallback-controls-title:${title}`;
    if (presentationKey === this.lastPresentationKey) return;
    tray.setTitle(title, { fontType: 'monospaced' });
    if (this.usingControlImage) {
      tray.setImage(this.emptyImage ?? nativeImage.createEmpty());
      this.usingControlImage = false;
    }
    this.lastPresentationKey = presentationKey;
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

  private isLiveTray(tray: Tray): boolean {
    return this.tray === tray && !tray.isDestroyed();
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
    this.hovered = false;
    this.usingControlImage = false;
    this.controlImageFailedForHover = false;
    this.lastPresentationKey = '';
    if (tray) tray.destroy();
  }
}

export const menuBarLyricsService = new MenuBarLyricsService();
