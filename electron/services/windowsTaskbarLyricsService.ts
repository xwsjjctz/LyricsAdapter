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
import {
  loadWindowsTaskbarNativeBridge,
  type WindowsTaskbarNativeBridge,
} from '../native/windowsTaskbarNative';

export type WindowsTaskbarLyricsActionHandler = (
  action: SystemLyricsAction,
) => void | Promise<void>;

export interface TaskbarLyricsDisplay {
  bounds: Readonly<Rectangle>;
  workArea: Readonly<Rectangle>;
}

type DisposeSubscription = () => void;

export interface WindowsTaskbarLyricsServiceDependencies {
  platform: NodeJS.Platform;
  preloadPath: string;
  widgetUrl: string;
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  getPrimaryDisplay: () => TaskbarLyricsDisplay;
  loadNativeBridge: () => WindowsTaskbarNativeBridge | null;
  subscribeDisplayChanges: (listener: () => void) => DisposeSubscription;
  subscribeThemeChanges: (listener: () => void) => DisposeSubscription;
  subscribeSessionChanges: (
    onLock: () => void,
    onUnlock: () => void,
  ) => DisposeSubscription;
  subscribeTaskbarHealth: (listener: () => void) => DisposeSubscription;
}

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 40;
const WINDOW_MARGIN = 4;
const WINDOW_CORNER_RADIUS = 8;
const COVER_URL_LIMIT = 8192;
const RESTART_BASE_DELAY_MS = 500;
const RESTART_MAX_DELAY_MS = 30_000;
const TASKBAR_HEALTH_INTERVAL_MS = 1_500;
const TASKBAR_LYRICS_CHANNEL = 'taskbar-lyrics-state';

/** Resolve from Electron's application root so ESM builds never rely on __dirname. */
export function resolveTaskbarLyricsPreloadPath(appPath: string): string {
  return path.join(appPath, 'dist-electron', 'taskbar-lyrics-preload.cjs');
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
    loadNativeBridge: () => loadWindowsTaskbarNativeBridge(),
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
    subscribeTaskbarHealth: listener => {
      const timer = setInterval(listener, TASKBAR_HEALTH_INTERVAL_MS);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}

/**
 * Owns the Windows taskbar lyrics BrowserWindow and embeds its HWND as a small,
 * non-activating Explorer taskbar child through the Windows-only Node-API bridge.
 */
export class WindowsTaskbarLyricsService {
  private readonly dependencies: WindowsTaskbarLyricsServiceDependencies;
  private bridge: WindowsTaskbarNativeBridge | null = null;
  private window: BrowserWindow | null = null;
  private nativeHandle: Buffer | null = null;
  private state: SystemLyricsState | null = null;
  private loaded = false;
  private attached = false;
  private enabled = false;
  private sessionLocked = false;
  private lastAttachmentError = '';
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

    try {
      this.bridge = this.dependencies.loadNativeBridge();
    } catch (error) {
      logger.error('[WindowsTaskbarLyrics] Failed to load native taskbar bridge:', error);
      this.bridge = null;
      return false;
    }
    if (!this.bridge) {
      logger.error('[WindowsTaskbarLyrics] Native taskbar bridge is unavailable.');
      return false;
    }

    this.enabled = true;
    this.subscriptions = [
      this.dependencies.subscribeDisplayChanges(() => {
        if (this.refreshAttachment()) this.renderState();
      }),
      this.dependencies.subscribeThemeChanges(() => this.renderState()),
      this.dependencies.subscribeSessionChanges(
        () => {
          this.sessionLocked = true;
          this.setWindowVisible(false);
        },
        () => {
          this.sessionLocked = false;
          this.refreshAttachment();
          this.renderState();
        },
      ),
      this.dependencies.subscribeTaskbarHealth(() => {
        if (!this.state?.trackId || this.sessionLocked) return;
        if (this.refreshAttachment()) this.renderState();
      }),
    ];
    return true;
  }

  /** Caches the latest renderer snapshot and paints it when the page is ready. */
  update(state: SystemLyricsState): void {
    this.state = { ...state };
    if (!this.enabled || this.dependencies.platform !== 'win32') return;

    if (!state.trackId) {
      this.setWindowVisible(false);
      return;
    }

    this.ensureWindow();
    this.renderState();
  }

  /** Destroys the Chromium surface and unregisters every global listener. */
  stop(): void {
    this.enabled = false;
    this.setWindowVisible(false);
    this.state = null;
    this.loaded = false;
    this.attached = false;
    this.sessionLocked = false;
    this.lastAttachmentError = '';
    this.restartAttempt = 0;
    this.clearRestartTimer();

    for (const dispose of this.subscriptions.splice(0)) dispose();

    const window = this.window;
    const nativeHandle = this.nativeHandle;
    this.window = null;
    this.nativeHandle = null;
    this.detachHandle(nativeHandle);
    if (window && !window.isDestroyed()) window.destroy();
    this.bridge = null;
  }

  private ensureWindow(): BrowserWindow | null {
    const existing = this.liveWindow();
    if (existing || !this.enabled || !this.state?.trackId) return existing;
    if (this.restartTimer) return null;

    try {
      const display = this.dependencies.getPrimaryDisplay();
      const window = this.dependencies.createWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        // Create on the target monitor while hidden so Chromium adopts its DPI
        // before the native HWND becomes an Explorer taskbar child.
        x: display.bounds.x,
        y: display.bounds.y,
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
      this.nativeHandle = window.getNativeWindowHandle();
      this.loaded = false;
      this.attached = false;

      // The child HWND owns only the visible widget rectangle, so the rest of
      // the Explorer taskbar remains untouched without click-through tricks.
      window.setIgnoreMouseEvents(false);
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
        const nativeHandle = this.nativeHandle;
        this.window = null;
        this.nativeHandle = null;
        this.loaded = false;
        this.attached = false;
        this.detachHandle(nativeHandle);
        this.scheduleRestart();
      });

      this.refreshAttachment();
      void window.loadURL(this.dependencies.widgetUrl).catch(error => {
        this.handleWindowFailure(window, 'Failed to load taskbar lyrics page.', error);
      });
      return window;
    } catch (error) {
      logger.error('[WindowsTaskbarLyrics] Failed to create Electron window:', error);
      const window = this.window;
      const nativeHandle = this.nativeHandle;
      this.window = null;
      this.nativeHandle = null;
      this.loaded = false;
      this.attached = false;
      this.detachHandle(nativeHandle);
      if (window && !window.isDestroyed()) window.destroy();
      this.scheduleRestart();
      return null;
    }
  }

  private liveWindow(): BrowserWindow | null {
    if (!this.window) return null;
    if (!this.window.isDestroyed()) return this.window;
    const nativeHandle = this.nativeHandle;
    this.window = null;
    this.nativeHandle = null;
    this.loaded = false;
    this.attached = false;
    this.detachHandle(nativeHandle);
    return null;
  }

  private refreshAttachment(): boolean {
    const window = this.liveWindow();
    const nativeHandle = this.nativeHandle;
    const bridge = this.bridge;
    if (!window || !nativeHandle || !bridge || this.sessionLocked) return false;

    try {
      const result = bridge.attachTaskbarWindow(nativeHandle, {
        widthDip: WINDOW_WIDTH,
        heightDip: WINDOW_HEIGHT,
        gapDip: WINDOW_MARGIN,
        cornerRadiusDip: WINDOW_CORNER_RADIUS,
      });
      this.attached = true;
      this.lastAttachmentError = '';
      if (result.changed) {
        logger.info('[WindowsTaskbarLyrics] Embedded into Explorer taskbar:', {
          reason: result.changeReason,
          edge: result.edge,
          dpi: result.dpi,
          boundsPx: result.boundsPx,
        });
      }
      return true;
    } catch (error) {
      this.attached = false;
      this.setWindowVisible(false);
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.lastAttachmentError) {
        logger.warn('[WindowsTaskbarLyrics] Taskbar attachment deferred:', error);
        this.lastAttachmentError = message;
      }
      return false;
    }
  }

  private renderState(): void {
    const state = this.state;
    const window = this.liveWindow();
    if (!state?.trackId || !window || !this.loaded || this.sessionLocked) return;
    if (!this.attached) return;

    window.webContents.send(TASKBAR_LYRICS_CHANNEL, {
      coverUrl: sanitizeTaskbarCoverUrl(state.coverUrl),
      line: state.line,
      nextLine: state.nextLine,
    });
    this.setWindowVisible(true);
  }

  private setWindowVisible(visible: boolean): boolean {
    const window = this.liveWindow();
    const bridge = this.bridge;
    const nativeHandle = this.nativeHandle;
    if (!window) return false;

    if (this.attached && bridge && nativeHandle) {
      try {
        return bridge.setTaskbarWindowVisible(nativeHandle, visible);
      } catch (error) {
        this.attached = false;
        logger.warn('[WindowsTaskbarLyrics] Failed to change taskbar child visibility:', error);
      }
    }

    if (!visible) window.hide();
    return false;
  }

  private handleWindowFailure(
    window: BrowserWindow,
    message: string,
    error?: unknown,
  ): void {
    if (this.window !== window) return;
    if (error === undefined) logger.warn(`[WindowsTaskbarLyrics] ${message}`);
    else logger.error(`[WindowsTaskbarLyrics] ${message}`, error);

    const nativeHandle = this.nativeHandle;
    this.window = null;
    this.nativeHandle = null;
    this.loaded = false;
    this.attached = false;
    this.detachHandle(nativeHandle);
    if (!window.isDestroyed()) window.destroy();
    this.scheduleRestart();
  }

  private detachHandle(nativeHandle: Buffer | null): void {
    if (!nativeHandle || !this.bridge) return;
    try {
      this.bridge.detachTaskbarWindow(nativeHandle);
    } catch (error) {
      logger.warn('[WindowsTaskbarLyrics] Failed to detach taskbar child HWND:', error);
    }
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
