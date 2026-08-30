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
  MENU_BAR_CONTROL_STRIP_WIDTH,
  createMenuBarControlImage,
} from './menuBarControlImage';

// Native Tray titles have no public width control. Full-width padding keeps the
// common CJK lyric case on a stable 24-slot footprint; narrow Latin glyphs can
// still render a little shorter because AppKit falls back across fonts.
const IDEOGRAPHIC_SPACE = '\u3000';
const CONTROL_REGION_COUNT = 3;
const CONTROL_FALLBACK_GRAPHEMES = SYSTEM_LYRICS_WINDOW_GRAPHEMES
  + CONTROL_REGION_COUNT;
const TEXT_PRESENTATION_SELECTOR = '\ufe0e';

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
  lineCursor: null,
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

/**
 * Builds the fixed grapheme lyric window rendered by the macOS status item.
 * Long lines follow the renderer-provided karaoke cursor without introducing
 * an ellipsis that would fight the scrolling text.
 */
export function formatMenuBarLyricsTitle(
  state: SystemLyricsState,
  requestedWindowSize = SYSTEM_LYRICS_WINDOW_GRAPHEMES,
): string {
  const windowSize = normalizedWindowSize(requestedWindowSize);
  const lyric = normalizeSystemLyricsText(state.line);
  const trackTitle = normalizeSystemLyricsText(state.title);
  const content = lyric || trackTitle || APP.NAME;
  const graphemes = splitGraphemes(content);

  if (graphemes.length <= windowSize) {
    return padGraphemeWindow(graphemes, windowSize);
  }

  const maximumOffset = graphemes.length - windowSize;
  const cursor = state.lineCursor === null || !Number.isFinite(state.lineCursor)
    ? 0
    : Math.max(0, Math.floor(state.lineCursor));
  const cursorAnchor = Math.min(Math.floor(windowSize * 2 / 3), windowSize - 1);
  const offset = Math.min(maximumOffset, Math.max(0, cursor - cursorAnchor));
  return graphemes.slice(offset, offset + windowSize).join('');
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
 * Owns the macOS status item. Player commands remain intents routed through the
 * renderer's player controller; this service only translates native pointer
 * interaction and renders the latest serializable playback snapshot.
 */
export class MenuBarLyricsService {
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

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  /** Starts the status item. Returns false on unsupported platforms or failure. */
  start(onAction: MenuBarLyricsActionHandler): boolean {
    this.onAction = onAction;
    if (this.platform !== 'darwin') return false;

    const existingTray = this.liveTray();
    if (existingTray) {
      existingTray.setContextMenu(null);
      existingTray.setToolTip('');
      this.render();
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
      this.render();
      logger.info('[MenuBarLyrics] Status item ready:', {
        bounds: tray.getBounds(),
        mode: 'lyrics-with-native-controls',
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
    this.state = { ...state };
    this.render();
  }

  /** Destroys the status item and clears retained renderer callbacks/state. */
  stop(): void {
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

  private bindPointerEvents(tray: Tray): void {
    tray.on('mouse-enter', () => {
      if (!this.isLiveTray(tray) || this.hovered) return;
      // Use the pre-hover title bounds as a transparent image canvas. Tray adds
      // its own image inset, so the control presentation can only expand here,
      // never contract underneath the pointer that triggered mouse-enter.
      const measuredWidth = Math.round(tray.getBounds().width);
      this.controlCanvasWidth = Number.isFinite(measuredWidth)
        ? Math.max(MENU_BAR_CONTROL_STRIP_WIDTH, measuredWidth)
        : MENU_BAR_CONTROL_STRIP_WIDTH;
      this.controlImageFailedForHover = false;
      this.hovered = true;
      this.render();
    });
    tray.on('mouse-leave', () => {
      if (!this.isLiveTray(tray)) return;
      this.hovered = false;
      this.render();
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

    // Electron's macOS Tray implementation reports `position` from AppKit's
    // locationInWindow, while `bounds` is the status item's screen rectangle.
    // The event x-coordinate is therefore already local to the status item.
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

  private render(): void {
    const tray = this.liveTray();
    if (!tray) return;

    if (this.hovered) {
      this.renderControls(tray);
      return;
    }

    const title = formatMenuBarLyricsTitle(this.state);
    const presentationKey = `lyrics:${title}`;
    if (presentationKey === this.lastPresentationKey) return;

    tray.setTitle(title, { fontType: 'monospaced' });
    if (this.usingControlImage) {
      tray.setImage(this.emptyImage ?? nativeImage.createEmpty());
      this.usingControlImage = false;
    }
    this.lastPresentationKey = presentationKey;
  }

  private renderControls(tray: Tray): void {
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
        // Keep one hover on a single presentation path. Retrying after a play
        // state change could replace the wide fallback title with an image and
        // move the pointer outside the status item before mouse-leave arrives.
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
      const presentationKey = `controls-image:${cacheKey}`;
      if (presentationKey === this.lastPresentationKey) return;

      // Add the full-width transparent template image before clearing the lyric
      // title, so entering the control state never shrinks the hover target.
      tray.setImage(image);
      tray.setTitle('');
      this.usingControlImage = true;
      this.lastPresentationKey = presentationKey;
      return;
    }

    const title = formatMenuBarControls(this.state.isPlaying);
    const presentationKey = `controls-title:${title}`;
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
