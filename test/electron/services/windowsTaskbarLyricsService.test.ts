import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/../electron/logger', () => ({ logger: loggerMocks }));
vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => 'C:\\LyricsAdapter') },
  BrowserWindow: class {},
  nativeTheme: { on: vi.fn(), removeListener: vi.fn() },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
  screen: { getPrimaryDisplay: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}));

import {
  WindowsTaskbarLyricsService,
  calculateTaskbarLyricsPlacement,
  resolveTaskbarLyricsPreloadPath,
  sanitizeTaskbarCoverUrl,
  type TaskbarLyricsDisplay,
  type WindowsTaskbarLyricsServiceDependencies,
} from '@/../electron/services/windowsTaskbarLyricsService';

describe('resolveTaskbarLyricsPreloadPath', () => {
  it('resolves the dedicated preload from Electron app root in ESM builds', () => {
    expect(resolveTaskbarLyricsPreloadPath('C:\\LyricsAdapter')).toBe(
      path.join('C:\\LyricsAdapter', 'dist-electron', 'taskbar-lyrics-preload.cjs'),
    );
  });
});

class FakeWebContents extends EventEmitter {
  readonly send = vi.fn();
  readonly setWindowOpenHandler = vi.fn();
}

class FakeWindow extends EventEmitter {
  readonly webContents = new FakeWebContents();
  readonly loadURL = vi.fn(async () => {});
  readonly setAlwaysOnTop = vi.fn();
  readonly setIgnoreMouseEvents = vi.fn();
  readonly setBounds = vi.fn();
  readonly showInactive = vi.fn();
  readonly hide = vi.fn();
  destroyed = false;
  readonly isDestroyed = vi.fn(() => this.destroyed);
  readonly destroy = vi.fn(() => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  });
}

const BOTTOM_TASKBAR_DISPLAY: TaskbarLyricsDisplay = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1032 },
};

const PLAYING_STATE = {
  trackId: 'track-1',
  title: '测试歌曲',
  artist: '测试歌手',
  coverUrl: 'cover://track-1',
  line: '当前歌词',
  lineCursor: 0,
  nextLine: '下一行',
  isPlaying: true,
};

interface TestSubscriptions {
  display?: () => void;
  theme?: () => void;
  lock?: () => void;
  unlock?: () => void;
  disposeDisplay: ReturnType<typeof vi.fn>;
  disposeTheme: ReturnType<typeof vi.fn>;
  disposeSession: ReturnType<typeof vi.fn>;
}

function createHarness(
  windows: FakeWindow[] = [new FakeWindow()],
  overrides: Partial<WindowsTaskbarLyricsServiceDependencies> = {},
) {
  let windowIndex = 0;
  const subscriptions: TestSubscriptions = {
    disposeDisplay: vi.fn(),
    disposeTheme: vi.fn(),
    disposeSession: vi.fn(),
  };
  const getPrimaryDisplay = vi.fn(() => BOTTOM_TASKBAR_DISPLAY);
  const createWindow = vi.fn((_options: BrowserWindowConstructorOptions) => (
    windows[windowIndex++] as unknown as BrowserWindow
  ));
  const dependencies: WindowsTaskbarLyricsServiceDependencies = {
    platform: 'win32',
    preloadPath: 'C:\\LyricsAdapter\\dist-electron\\taskbar-lyrics-preload.cjs',
    widgetUrl: 'app://localhost/taskbar-lyrics.html',
    createWindow,
    getPrimaryDisplay,
    subscribeDisplayChanges: listener => {
      subscriptions.display = listener;
      return subscriptions.disposeDisplay;
    },
    subscribeThemeChanges: listener => {
      subscriptions.theme = listener;
      return subscriptions.disposeTheme;
    },
    subscribeSessionChanges: (onLock, onUnlock) => {
      subscriptions.lock = onLock;
      subscriptions.unlock = onUnlock;
      return subscriptions.disposeSession;
    },
    ...overrides,
  };

  return {
    service: new WindowsTaskbarLyricsService(dependencies),
    dependencies,
    subscriptions,
    createWindow,
    getPrimaryDisplay,
    windows,
  };
}

describe('calculateTaskbarLyricsPlacement', () => {
  it('places a 420x40 widget immediately left of the reserved bottom tray area', () => {
    expect(calculateTaskbarLyricsPlacement(BOTTOM_TASKBAR_DISPLAY)).toEqual({
      x: 1285,
      y: 1036,
      width: 420,
      height: 40,
      edge: 'bottom',
      compact: false,
    });
  });

  it('supports top taskbars and displays with negative coordinates', () => {
    expect(calculateTaskbarLyricsPlacement({
      bounds: { x: -1600, y: -200, width: 1600, height: 900 },
      workArea: { x: -1600, y: -152, width: 1600, height: 852 },
    })).toEqual({
      x: -600,
      y: -196,
      width: 420,
      height: 40,
      edge: 'top',
      compact: false,
    });
  });

  it('uses compact height for a short horizontal taskbar', () => {
    expect(calculateTaskbarLyricsPlacement({
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
      workArea: { x: 0, y: 0, width: 1280, height: 690 },
    })).toMatchObject({ height: 28, compact: true });
  });

  it('hides for auto-hidden, unknown, and vertical taskbars', () => {
    expect(calculateTaskbarLyricsPlacement({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })).toBeNull();
    expect(calculateTaskbarLyricsPlacement({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 48, y: 0, width: 1872, height: 1080 },
    })).toBeNull();
  });
});

describe('sanitizeTaskbarCoverUrl', () => {
  it('keeps only cover and HTTPS URLs', () => {
    expect(sanitizeTaskbarCoverUrl('cover://track-1')).toBe('cover://track-1');
    expect(sanitizeTaskbarCoverUrl('https://img.example/cover.jpg')).toBe(
      'https://img.example/cover.jpg',
    );
    expect(sanitizeTaskbarCoverUrl('http://img.example/cover.jpg')).toBe('');
    expect(sanitizeTaskbarCoverUrl('file:///C:/music/cover.jpg')).toBe('');
    expect(sanitizeTaskbarCoverUrl('blob:app://localhost/id')).toBe('');
    expect(sanitizeTaskbarCoverUrl('not a URL')).toBe('');
  });
});

describe('WindowsTaskbarLyricsService', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('does not subscribe or create a window outside Windows', () => {
    const harness = createHarness([new FakeWindow()], { platform: 'darwin' });

    expect(harness.service.start(vi.fn())).toBe(false);
    harness.service.update(PLAYING_STATE);

    expect(harness.createWindow).not.toHaveBeenCalled();
    expect(harness.subscriptions.display).toBeUndefined();
  });

  it('creates a secure click-through window lazily for the first track', () => {
    const harness = createHarness();
    const window = harness.windows[0]!;

    expect(harness.service.start(vi.fn())).toBe(true);
    expect(harness.createWindow).not.toHaveBeenCalled();
    harness.service.update(PLAYING_STATE);

    expect(harness.createWindow).toHaveBeenCalledOnce();
    const options = harness.createWindow.mock.calls[0]![0];
    expect(options).toMatchObject({
      show: false,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
    });
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'pop-up-menu');
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
    expect(window.loadURL).toHaveBeenCalledWith('app://localhost/taskbar-lyrics.html');
  });

  it('renders only the latest state once the taskbar page finishes loading', () => {
    const harness = createHarness();
    const window = harness.windows[0]!;
    harness.service.start(vi.fn());
    harness.service.update({ ...PLAYING_STATE, line: 'stale line' });
    harness.service.update({ ...PLAYING_STATE, line: 'latest line' });

    expect(window.webContents.send).not.toHaveBeenCalled();
    window.webContents.emit('did-finish-load');

    expect(window.setBounds).toHaveBeenCalledWith({
      x: 1285,
      y: 1036,
      width: 420,
      height: 40,
    }, false);
    expect(window.webContents.send).toHaveBeenCalledWith('taskbar-lyrics-state', {
      coverUrl: 'cover://track-1',
      line: 'latest line',
      nextLine: '下一行',
    });
    expect(window.showInactive).toHaveBeenCalledOnce();
  });

  it('hides on an empty state and while the Windows session is locked', () => {
    const harness = createHarness();
    const window = harness.windows[0]!;
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);
    window.webContents.emit('did-finish-load');

    harness.subscriptions.lock?.();
    expect(window.hide).toHaveBeenCalledOnce();
    harness.subscriptions.unlock?.();
    expect(window.showInactive).toHaveBeenCalledTimes(2);

    harness.service.update({ ...PLAYING_STATE, trackId: null });
    expect(window.hide).toHaveBeenCalledTimes(2);
  });

  it('repositions on display changes and hides when no horizontal taskbar is known', () => {
    const harness = createHarness();
    const window = harness.windows[0]!;
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);
    window.webContents.emit('did-finish-load');

    harness.getPrimaryDisplay.mockReturnValue({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    });
    harness.subscriptions.display?.();

    expect(window.hide).toHaveBeenCalledOnce();
  });

  it('recreates a renderer that exits while a track is active', () => {
    vi.useFakeTimers();
    const harness = createHarness([new FakeWindow(), new FakeWindow()]);
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);

    harness.windows[0]!.webContents.emit('render-process-gone');
    expect(harness.windows[0]!.destroy).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(499);
    expect(harness.createWindow).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(harness.createWindow).toHaveBeenCalledTimes(2);
  });

  it('destroys the window and removes global subscriptions on stop', () => {
    const harness = createHarness();
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);
    harness.service.stop();

    expect(harness.windows[0]!.destroy).toHaveBeenCalledOnce();
    expect(harness.subscriptions.disposeDisplay).toHaveBeenCalledOnce();
    expect(harness.subscriptions.disposeTheme).toHaveBeenCalledOnce();
    expect(harness.subscriptions.disposeSession).toHaveBeenCalledOnce();
  });
});
