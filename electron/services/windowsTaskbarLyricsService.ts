import path from 'node:path';
import {
  app,
  BrowserWindow,
  nativeTheme,
  powerMonitor,
  screen,
  type BrowserWindowConstructorOptions,
  type Rectangle,
} from 'electron';
import type { SystemLyricsAction, SystemLyricsState } from '../../src/types/systemLyrics';
import { logger } from '../logger';

export type WindowsTaskbarLyricsActionHandler = (
  action: SystemLyricsAction,
) => void | Promise<void>;

export interface TaskbarLyricsDisplay {
  bounds: Readonly<Rectangle>;
  workArea: Readonly<Rectangle>;
}

export interface TaskbarLyricsPlacement extends Rectangle {
  edge: 'top' | 'bottom';
  compact: boolean;
}

type DisposeSubscription = () => void;

export interface WindowsTaskbarLyricsServiceDependencies {
  platform: NodeJS.Platform;
  preloadPath: string;
  widgetUrl: string;
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  getPrimaryDisplay: () => TaskbarLyricsDisplay;
  subscribeDisplayChanges: (listener: () => void) => DisposeSubscription;
  subscribeThemeChanges: (listener: () => void) => DisposeSubscription;
  subscribeSessionChanges: (
    onLock: () => void,
    onUnlock: () => void,
  ) => DisposeSubscription;
}

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 40;
const COMPACT_HEIGHT_THRESHOLD = 36;
const MINIMUM_TASKBAR_THICKNESS = 26;
const MINIMUM_WINDOW_WIDTH = 160;
const WINDOW_MARGIN = 4;
const COVER_URL_LIMIT = 8192;
const RESTART_BASE_DELAY_MS = 500;
const RESTART_MAX_DELAY_MS = 30_000;
const TASKBAR_LYRICS_CHANNEL = 'taskbar-lyrics-state';

/** Resolve from Electron's application root so ESM builds never rely on __dirname. */
export function resolveTaskbarLyricsPreloadPath(appPath: string): string {
  return path.join(appPath, 'dist-electron', 'taskbar-lyrics-preload.cjs');
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rectangleEnd(rectangle: Readonly<Rectangle>, axis: 'x' | 'y'): number {
  return rectangle[axis] + rectangle[axis === 'x' ? 'width' : 'height'];
}

/**
 * Infers a horizontal taskbar from Electron's display work area. This is the
 * strongest placement signal available without reintroducing a Win32 bridge.
 * Auto-hidden, unknown, and vertical taskbars deliberately return null so the
 * overlay never floats over ordinary desktop content.
 */
export function calculateTaskbarLyricsPlacement(
  display: TaskbarLyricsDisplay,
): TaskbarLyricsPlacement | null {
  const { bounds, workArea } = display;
  const leftInset = Math.max(0, workArea.x - bounds.x);
  const topInset = Math.max(0, workArea.y - bounds.y);
  const rightInset = Math.max(0, rectangleEnd(bounds, 'x') - rectangleEnd(workArea, 'x'));
  const bottomInset = Math.max(0, rectangleEnd(bounds, 'y') - rectangleEnd(workArea, 'y'));
  const horizontalThickness = Math.max(topInset, bottomInset);
  const verticalThickness = Math.max(leftInset, rightInset);

  if (
    horizontalThickness < MINIMUM_TASKBAR_THICKNESS
    || verticalThickness > horizontalThickness
  ) {
    return null;
  }

  const edge = topInset > bottomInset ? 'top' : 'bottom';
  const thickness = edge === 'top' ? topInset : bottomInset;
  const height = Math.floor(Math.min(WINDOW_HEIGHT, thickness - 2));
  if (height < 24) return null;

  // Electron cannot expose the notification-area bounds. Reserve a conservative
  // right-hand section and keep the overlay immediately to its left.
  const rightReserve = clamp(Math.round(bounds.width * 0.11), 176, 240);
  const availableWidth = Math.floor(bounds.width - rightReserve - (WINDOW_MARGIN * 2));
  if (availableWidth < MINIMUM_WINDOW_WIDTH) return null;

  const width = Math.min(WINDOW_WIDTH, availableWidth);
  const x = Math.round(
    bounds.x + bounds.width - rightReserve - WINDOW_MARGIN - width,
  );
  const taskbarY = edge === 'top'
    ? bounds.y
    : bounds.y + bounds.height - thickness;
  const y = Math.round(taskbarY + ((thickness - height) / 2));

  return {
    x,
    y,
    width,
    height,
    edge,
    compact: height < COMPACT_HEIGHT_THRESHOLD,
  };
}

/** Only renderer-safe cached covers and remote HTTPS artwork cross this surface. */
export function sanitizeTaskbarCoverUrl(value: string): string {
  if (!value || value.length > COVER_URL_LIMIT) return '';
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'cover:' || protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

function defaultDependencies(): WindowsTaskbarLyricsServiceDependencies {
  return {
    platform: process.platform,
    preloadPath: resolveTaskbarLyricsPreloadPath(app.getAppPath()),
    widgetUrl: 'app://localhost/taskbar-lyrics.html',
    createWindow: options => new BrowserWindow(options),
    getPrimaryDisplay: () => screen.getPrimaryDisplay(),
    subscribeDisplayChanges: listener => {
      screen.on('display-added', listener);
      screen.on('display-removed', listener);
      screen.on('display-metrics-changed', listener);
      return () => {
        screen.removeListener('display-added', listener);
        screen.removeListener('display-removed', listener);
        screen.removeListener('display-metrics-changed', listener);
      };
    },
    subscribeThemeChanges: listener => {
      nativeTheme.on('updated', listener);
      return () => nativeTheme.removeListener('updated', listener);
    },
    subscribeSessionChanges: (onLock, onUnlock) => {
      powerMonitor.on('lock-screen', onLock);
      powerMonitor.on('suspend', onLock);
      powerMonitor.on('unlock-screen', onUnlock);
      powerMonitor.on('resume', onUnlock);
      return () => {
        powerMonitor.removeListener('lock-screen', onLock);
        powerMonitor.removeListener('suspend', onLock);
        powerMonitor.removeListener('unlock-screen', onUnlock);
        powerMonitor.removeListener('resume', onUnlock);
      };
    },
  };
}

/**
 * Owns the Windows taskbar lyrics BrowserWindow. It is a click-through Electron
 * overlay, not an Explorer child HWND, so the implementation stays entirely in
 * the existing TypeScript/Electron toolchain.
 */
export class WindowsTaskbarLyricsService {
  private readonly dependencies: WindowsTaskbarLyricsServiceDependencies;
  private window: BrowserWindow | null = null;
  private state: SystemLyricsState | null = null;
  private loaded = false;
  private enabled = false;
  private sessionLocked = false;
  private restartAttempt = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private subscriptions: DisposeSubscription[] = [];

  constructor(
    dependencies: Partial<WindowsTaskbarLyricsServiceDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies(), ...dependencies };
  }

  /** Enables the Windows surface. The presentation is intentionally read-only. */
  start(_onAction: WindowsTaskbarLyricsActionHandler): boolean {
    if (this.dependencies.platform !== 'win32') return false;
    if (this.enabled) return true;

    this.enabled = true;
    this.subscriptions = [
      this.dependencies.subscribeDisplayChanges(() => this.refreshPlacement()),
      this.dependencies.subscribeThemeChanges(() => this.renderState()),
      this.dependencies.subscribeSessionChanges(
        () => {
          this.sessionLocked = true;
          this.liveWindow()?.hide();
        },
        () => {
          this.sessionLocked = false;
          this.renderState();
        },
      ),
    ];
    return true;
  }

  /** Caches the latest renderer snapshot and paints it when the page is ready. */
  update(state: SystemLyricsState): void {
    this.state = { ...state };
    if (!this.enabled || this.dependencies.platform !== 'win32') return;

    if (!state.trackId) {
      this.liveWindow()?.hide();
      return;
    }

    this.ensureWindow();
    this.renderState();
  }

  /** Destroys the Chromium surface and unregisters every global listener. */
  stop(): void {
    this.enabled = false;
    this.state = null;
    this.loaded = false;
    this.sessionLocked = false;
    this.restartAttempt = 0;
    this.clearRestartTimer();

    for (const dispose of this.subscriptions.splice(0)) dispose();

    const window = this.window;
    this.window = null;
    if (window && !window.isDestroyed()) window.destroy();
  }

  private ensureWindow(): BrowserWindow | null {
    const existing = this.liveWindow();
    if (existing || !this.enabled || !this.state?.trackId) return existing;
    if (this.restartTimer) return null;

    try {
      const window = this.dependencies.createWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        x: -32_000,
        y: -32_000,
        title: 'LyricsAdapter Taskbar Lyrics',
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        backgroundMaterial: 'none',
        focusable: false,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        thickFrame: false,
        roundedCorners: false,
        paintWhenInitiallyHidden: true,
        webPreferences: {
          preload: this.dependencies.preloadPath,
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          sandbox: false,
          spellcheck: false,
          backgroundThrottling: false,
        },
      });
      this.window = window;
      this.loaded = false;

      window.setAlwaysOnTop(true, 'pop-up-menu');
      window.setIgnoreMouseEvents(true, { forward: true });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.on('did-finish-load', () => {
        if (this.window !== window) return;
        this.loaded = true;
        this.restartAttempt = 0;
        this.renderState();
      });
      window.webContents.on('render-process-gone', () => {
        this.handleWindowFailure(window, 'Taskbar lyrics renderer exited.');
      });
      window.on('closed', () => {
        if (this.window !== window) return;
        this.window = null;
        this.loaded = false;
        this.scheduleRestart();
      });

      void window.loadURL(this.dependencies.widgetUrl).catch(error => {
        this.handleWindowFailure(window, 'Failed to load taskbar lyrics page.', error);
      });
      return window;
    } catch (error) {
      logger.error('[WindowsTaskbarLyrics] Failed to create Electron window:', error);
      this.scheduleRestart();
      return null;
    }
  }

  private liveWindow(): BrowserWindow | null {
    if (!this.window) return null;
    if (!this.window.isDestroyed()) return this.window;
    this.window = null;
    this.loaded = false;
    return null;
  }

  private refreshPlacement(): boolean {
    const window = this.liveWindow();
    if (!window || this.sessionLocked) return false;

    const placement = calculateTaskbarLyricsPlacement(
      this.dependencies.getPrimaryDisplay(),
    );
    if (!placement) {
      window.hide();
      return false;
    }

    const { edge: _edge, compact: _compact, ...bounds } = placement;
    window.setBounds(bounds, false);
    return true;
  }

  private renderState(): void {
    const state = this.state;
    const window = this.liveWindow();
    if (!state?.trackId || !window || !this.loaded || this.sessionLocked) return;
    if (!this.refreshPlacement()) return;

    window.webContents.send(TASKBAR_LYRICS_CHANNEL, {
      coverUrl: sanitizeTaskbarCoverUrl(state.coverUrl),
      line: state.line,
      nextLine: state.nextLine,
    });
    window.showInactive();
  }

  private handleWindowFailure(
    window: BrowserWindow,
    message: string,
    error?: unknown,
  ): void {
    if (this.window !== window) return;
    if (error === undefined) logger.warn(`[WindowsTaskbarLyrics] ${message}`);
    else logger.error(`[WindowsTaskbarLyrics] ${message}`, error);

    this.window = null;
    this.loaded = false;
    if (!window.isDestroyed()) window.destroy();
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (!this.enabled || !this.state?.trackId || this.restartTimer) return;
    const delay = Math.min(
      RESTART_BASE_DELAY_MS * (2 ** Math.min(this.restartAttempt, 6)),
      RESTART_MAX_DELAY_MS,
    );
    this.restartAttempt += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.enabled || !this.state?.trackId) return;
      this.ensureWindow();
    }, delay);
    this.restartTimer.unref();
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }
}

export const windowsTaskbarLyricsService = new WindowsTaskbarLyricsService();
