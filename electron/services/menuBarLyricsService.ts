import {
  Tray,
  nativeImage,
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

// Native Tray titles have no public width control. Full-width padding keeps
// Chinese lyrics and the Chinese hover controls on the same 18-slot footprint;
// narrow Latin glyphs can still render a little shorter because AppKit falls
// back to a different font for CJK text.
const IDEOGRAPHIC_SPACE = '\u3000';
const SCROLL_CURSOR_ANCHOR = 12;
const CONTROL_REGION_COUNT = 3;

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
 * Builds the fixed 18-grapheme lyric window rendered by the macOS status item. Long
 * lines follow the renderer-provided karaoke cursor without introducing an
 * ellipsis that would fight the scrolling text.
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
  const cursorAnchor = Math.min(SCROLL_CURSOR_ANCHOR, windowSize - 1);
  const offset = Math.min(maximumOffset, Math.max(0, cursor - cursorAnchor));
  return graphemes.slice(offset, offset + windowSize).join('');
}

function centeredControlLabel(label: string, width: number): string {
  const graphemes = splitGraphemes(label).slice(0, width);
  const remaining = Math.max(0, width - graphemes.length);
  const leftPadding = Math.floor(remaining / 2);
  const rightPadding = remaining - leftPadding;
  return [
    IDEOGRAPHIC_SPACE.repeat(leftPadding),
    ...graphemes,
    IDEOGRAPHIC_SPACE.repeat(rightPadding),
  ].join('');
}

/** Build three equally-sized hover targets while retaining the lyric width. */
export function formatMenuBarControls(isPlaying: boolean): string {
  const segmentWidth = Math.floor(
    SYSTEM_LYRICS_WINDOW_GRAPHEMES / CONTROL_REGION_COUNT,
  );
  return [
    centeredControlLabel('上一首', segmentWidth),
    centeredControlLabel(isPlaying ? '暂停' : '播放', segmentWidth),
    centeredControlLabel('下一首', segmentWidth),
  ].join('');
}

/**
 * Owns the title-only macOS status item. Player commands remain intents routed
 * through the renderer's player controller; this service only translates native
 * pointer interaction and renders the latest serializable playback snapshot.
 */
export class MenuBarLyricsService {
  private tray: Tray | null = null;
  private state: SystemLyricsState = EMPTY_STATE;
  private onAction: MenuBarLyricsActionHandler = EMPTY_ACTION_HANDLER;
  private lastTitle = '';
  private hovered = false;

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
      const tray = new Tray(nativeImage.createEmpty());
      this.tray = tray;
      this.lastTitle = '';
      this.hovered = false;
      tray.setContextMenu(null);
      tray.setIgnoreDoubleClickEvents(true);
      tray.setToolTip('');
      this.bindPointerEvents(tray);
      this.render();
      logger.info('[MenuBarLyrics] Status item ready:', {
        bounds: tray.getBounds(),
        mode: 'title-only',
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
    this.lastTitle = '';
    this.hovered = false;
  }

  private bindPointerEvents(tray: Tray): void {
    tray.on('mouse-enter', () => {
      if (!this.isLiveTray(tray)) return;
      this.hovered = true;
      this.render();
    });
    tray.on('mouse-leave', () => {
      if (!this.isLiveTray(tray)) return;
      this.hovered = false;
      this.render();
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
      !Number.isFinite(bounds.x)
      || !Number.isFinite(bounds.width)
      || !Number.isFinite(position.x)
      || bounds.width <= 0
    ) {
      return null;
    }

    const relativeX = position.x - bounds.x;
    if (relativeX < 0 || relativeX > bounds.width) return null;
    const ratio = Math.min(relativeX / bounds.width, 1 - Number.EPSILON);
    if (ratio < 1 / CONTROL_REGION_COUNT) return 'previous';
    if (ratio < 2 / CONTROL_REGION_COUNT) return 'toggle-play';
    return 'next';
  }

  private render(): void {
    const tray = this.liveTray();
    if (!tray) return;

    const title = this.hovered
      ? formatMenuBarControls(this.state.isPlaying)
      : formatMenuBarLyricsTitle(this.state);
    if (title === this.lastTitle) return;

    tray.setTitle(title, { fontType: 'monospaced' });
    this.lastTitle = title;
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
    if (tray) tray.destroy();
  }
}

export const menuBarLyricsService = new MenuBarLyricsService();
