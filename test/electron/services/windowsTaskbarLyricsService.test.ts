import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  WindowsTaskbarAttachResult,
  WindowsTaskbarNativeBridge,
} from '@/../electron/native/windowsTaskbarNative';

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
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
  readonly nativeHandle: Buffer;
  readonly webContents = new FakeWebContents();
  readonly getNativeWindowHandle = vi.fn(() => this.nativeHandle);
  readonly loadURL = vi.fn(async () => {});
  readonly setAlwaysOnTop = vi.fn();
  readonly setIgnoreMouseEvents = vi.fn();
  readonly showInactive = vi.fn();
  readonly hide = vi.fn();
  destroyed = false;
  readonly isDestroyed = vi.fn(() => this.destroyed);
  readonly destroy = vi.fn(() => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  });

  constructor(handle = 1) {
    super();
    this.nativeHandle = Buffer.alloc(8);
    this.nativeHandle.writeBigUInt64LE(BigInt(handle));
  }
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
  lineProgress: 0,
  nextLine: '下一行',
  isPlaying: true,
};

const ATTACH_RESULT: WindowsTaskbarAttachResult = {
  changed: true,
  changeReason: 'initial-attach',
  edge: 'bottom',
  dpi: 96,
  boundsPx: { x: 1285, y: 4, width: 420, height: 40 },
  taskbarClass: 'Shell_TrayWnd',
};

function createBridge(): WindowsTaskbarNativeBridge & {
  getApiVersion: ReturnType<typeof vi.fn>;
  attachTaskbarWindow: ReturnType<typeof vi.fn>;
  detachTaskbarWindow: ReturnType<typeof vi.fn>;
  setTaskbarWindowVisible: ReturnType<typeof vi.fn>;
} {
  return {
    getApiVersion: vi.fn(() => 2),
    attachTaskbarWindow: vi.fn(() => ATTACH_RESULT),
    detachTaskbarWindow: vi.fn(() => true),
    setTaskbarWindowVisible: vi.fn(() => true),
  };
}

interface TestSubscriptions {
  display?: () => void;
  theme?: () => void;
  lock?: () => void;
  unlock?: () => void;
  health?: () => void;
  disposeDisplay: ReturnType<typeof vi.fn>;
  disposeTheme: ReturnType<typeof vi.fn>;
  disposeSession: ReturnType<typeof vi.fn>;
  disposeHealth: ReturnType<typeof vi.fn>;
}

function createHarness(
  windows: FakeWindow[] = [new FakeWindow()],
  overrides: Partial<WindowsTaskbarLyricsServiceDependencies> = {},
  bridge = createBridge(),
) {
  let windowIndex = 0;
  const subscriptions: TestSubscriptions = {
    disposeDisplay: vi.fn(),
    disposeTheme: vi.fn(),
    disposeSession: vi.fn(),
    disposeHealth: vi.fn(),
  };
  const getPrimaryDisplay = vi.fn(() => BOTTOM_TASKBAR_DISPLAY);
  const createWindow = vi.fn((_options: BrowserWindowConstructorOptions) => (
    windows[windowIndex++] as unknown as BrowserWindow
  ));
  const loadNativeBridge = vi.fn((): WindowsTaskbarNativeBridge | null => bridge);
  const dependencies: WindowsTaskbarLyricsServiceDependencies = {
    platform: 'win32',
    preloadPath: 'C:\\LyricsAdapter\\dist-electron\\taskbar-lyrics-preload.cjs',
    widgetUrl: 'app://localhost/taskbar-lyrics.html',
    createWindow,
    getPrimaryDisplay,
    loadNativeBridge,
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
    subscribeTaskbarHealth: listener => {
      subscriptions.health = listener;
      return subscriptions.disposeHealth;
    },
    ...overrides,
  };

  return {
    service: new WindowsTaskbarLyricsService(dependencies),
    bridge,
    dependencies,
    subscriptions,
    createWindow,
    getPrimaryDisplay,
    loadNativeBridge,
    windows,
  };
}

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

  it('does not load the native bridge, subscribe, or create a window outside Windows', () => {
    const loadNativeBridge = vi.fn(() => createBridge());
    const harness = createHarness(
      [new FakeWindow()],
      { platform: 'darwin', loadNativeBridge },
    );

    expect(harness.service.start(vi.fn())).toBe(false);
    harness.service.update(PLAYING_STATE);

    expect(loadNativeBridge).not.toHaveBeenCalled();
    expect(harness.createWindow).not.toHaveBeenCalled();
    expect(harness.subscriptions.display).toBeUndefined();
    expect(harness.subscriptions.health).toBeUndefined();
  });

  it('refuses to start when the native bridge is missing', () => {
    const loadNativeBridge = vi.fn(() => null);
    const harness = createHarness([new FakeWindow()], { loadNativeBridge });

    expect(harness.service.start(vi.fn())).toBe(false);

    expect(loadNativeBridge).toHaveBeenCalledOnce();
    expect(harness.subscriptions.display).toBeUndefined();
    expect(harness.subscriptions.health).toBeUndefined();
    expect(loggerMocks.error).toHaveBeenCalledWith(
      '[WindowsTaskbarLyrics] Native taskbar bridge is unavailable.',
    );
  });

  it('refuses to start when loading the native bridge throws', () => {
    const error = new Error('native module failed to load');
    const loadNativeBridge = vi.fn(() => {
      throw error;
    });
    const harness = createHarness([new FakeWindow()], { loadNativeBridge });

    expect(harness.service.start(vi.fn())).toBe(false);

    expect(harness.subscriptions.display).toBeUndefined();
    expect(harness.subscriptions.health).toBeUndefined();
    expect(loggerMocks.error).toHaveBeenCalledWith(
      '[WindowsTaskbarLyrics] Failed to load native taskbar bridge:',
      error,
    );
  });

  it('creates and attaches one secure non-activating child window lazily', () => {
    const harness = createHarness();
    const window = harness.windows[0]!;

    expect(harness.service.start(vi.fn())).toBe(true);
    expect(harness.createWindow).not.toHaveBeenCalled();
    harness.service.update(PLAYING_STATE);

    expect(harness.createWindow).toHaveBeenCalledOnce();
    const options = harness.createWindow.mock.calls[0]![0];
    expect(options).toMatchObject({
      width: 420,
      height: 40,
      x: 0,
      y: 0,
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
    expect(window.getNativeWindowHandle).toHaveBeenCalledOnce();
    expect(window.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(false);
    expect(harness.bridge.attachTaskbarWindow).toHaveBeenCalledWith(
      window.nativeHandle,
      {
        widthDip: 420,
        heightDip: 40,
        gapDip: 4,
        cornerRadiusDip: 8,
      },
    );
    expect(window.loadURL).toHaveBeenCalledWith('app://localhost/taskbar-lyrics.html');
    expect(window.showInactive).not.toHaveBeenCalled();
    expect(harness.bridge.setTaskbarWindowVisible).not.toHaveBeenCalled();
  });

  it('renders only the latest state once attachment and page loading are ready', () => {
    const harness = createHarness();
    const window = harness.windows[0]!;
    harness.service.start(vi.fn());
    harness.service.update({ ...PLAYING_STATE, line: 'stale line' });
    harness.service.update({ ...PLAYING_STATE, line: 'latest line' });

    expect(window.webContents.send).not.toHaveBeenCalled();
    expect(window.showInactive).not.toHaveBeenCalled();
    window.webContents.emit('did-finish-load');

    expect(window.webContents.send).toHaveBeenCalledWith('taskbar-lyrics-state', {
      coverUrl: 'cover://track-1',
      line: 'latest line',
      nextLine: '下一行',
    });
    expect(harness.bridge.setTaskbarWindowVisible).toHaveBeenCalledWith(
      window.nativeHandle,
      true,
    );
    expect(window.showInactive).not.toHaveBeenCalled();
  });

  it('stays hidden after an attachment failure and shows after a health retry succeeds', () => {
    const harness = createHarness();
    const window = harness.windows[0]!;
    const error = new Error('Explorer taskbar is unavailable');
    harness.bridge.attachTaskbarWindow
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockReturnValue(ATTACH_RESULT);

    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);
    window.webContents.emit('did-finish-load');

    expect(window.hide).toHaveBeenCalledOnce();
    expect(window.webContents.send).not.toHaveBeenCalled();
    expect(window.showInactive).not.toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      '[WindowsTaskbarLyrics] Taskbar attachment deferred:',
      error,
    );

    harness.subscriptions.health?.();

    expect(harness.bridge.attachTaskbarWindow).toHaveBeenCalledTimes(2);
    expect(window.webContents.send).toHaveBeenCalledWith('taskbar-lyrics-state', {
      coverUrl: 'cover://track-1',
      line: '当前歌词',
      nextLine: '下一行',
    });
    expect(harness.bridge.setTaskbarWindowVisible).toHaveBeenCalledWith(
      window.nativeHandle,
      true,
    );
  });

  it('refreshes attachment and presentation for display and health changes', () => {
    const harness = createHarness();
    const window = harness.windows[0]!;
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);
    window.webContents.emit('did-finish-load');

    harness.subscriptions.display?.();
    harness.subscriptions.health?.();

    expect(harness.bridge.attachTaskbarWindow).toHaveBeenCalledTimes(3);
    expect(harness.bridge.setTaskbarWindowVisible).toHaveBeenCalledTimes(3);
    expect(window.webContents.send).toHaveBeenCalledTimes(3);
  });

  it('reports a changed attachment when Explorer provides a replacement taskbar', () => {
    const harness = createHarness();
    const window = harness.windows[0]!;
    const replacement: WindowsTaskbarAttachResult = {
      ...ATTACH_RESULT,
      changed: true,
      changeReason: 'taskbar-replaced',
      edge: 'top',
      dpi: 144,
      boundsPx: { x: 900, y: 2, width: 630, height: 60 },
    };
    harness.bridge.attachTaskbarWindow
      .mockReturnValueOnce({ ...ATTACH_RESULT, changed: false })
      .mockReturnValueOnce(replacement);

    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);
    window.webContents.emit('did-finish-load');
    harness.subscriptions.health?.();

    expect(harness.bridge.attachTaskbarWindow).toHaveBeenCalledTimes(2);
    expect(loggerMocks.info).toHaveBeenCalledWith(
      '[WindowsTaskbarLyrics] Embedded into Explorer taskbar:',
      {
        reason: 'taskbar-replaced',
        edge: 'top',
        dpi: 144,
        boundsPx: replacement.boundsPx,
      },
    );
    expect(harness.bridge.setTaskbarWindowVisible).toHaveBeenCalledTimes(2);
  });

  it('hides on an empty state and while the Windows session is locked', () => {
    const harness = createHarness();
    const window = harness.windows[0]!;
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);
    window.webContents.emit('did-finish-load');

    harness.subscriptions.lock?.();
    expect(harness.bridge.setTaskbarWindowVisible).toHaveBeenLastCalledWith(
      window.nativeHandle,
      false,
    );
    const attachCallsBeforeLockedHealth = harness.bridge.attachTaskbarWindow.mock.calls.length;
    harness.subscriptions.health?.();
    expect(harness.bridge.attachTaskbarWindow).toHaveBeenCalledTimes(
      attachCallsBeforeLockedHealth,
    );

    harness.subscriptions.unlock?.();
    expect(harness.bridge.setTaskbarWindowVisible).toHaveBeenLastCalledWith(
      window.nativeHandle,
      true,
    );

    harness.service.update({ ...PLAYING_STATE, trackId: null });
    expect(harness.bridge.setTaskbarWindowVisible).toHaveBeenLastCalledWith(
      window.nativeHandle,
      false,
    );
  });

  it('detaches before destroying a renderer that exits and then recreates it', () => {
    vi.useFakeTimers();
    const harness = createHarness([new FakeWindow(1), new FakeWindow(2)]);
    const firstWindow = harness.windows[0]!;
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);

    firstWindow.webContents.emit('render-process-gone');

    expect(harness.bridge.detachTaskbarWindow).toHaveBeenCalledOnce();
    expect(harness.bridge.detachTaskbarWindow).toHaveBeenCalledWith(
      firstWindow.nativeHandle,
    );
    expect(firstWindow.destroy).toHaveBeenCalledOnce();
    expect(
      harness.bridge.detachTaskbarWindow.mock.invocationCallOrder[0],
    ).toBeLessThan(firstWindow.destroy.mock.invocationCallOrder[0]!);
    vi.advanceTimersByTime(499);
    expect(harness.createWindow).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(harness.createWindow).toHaveBeenCalledTimes(2);
    expect(harness.bridge.attachTaskbarWindow).toHaveBeenLastCalledWith(
      harness.windows[1]!.nativeHandle,
      expect.any(Object),
    );
  });

  it('detaches before destroy and removes every global subscription on stop', () => {
    const harness = createHarness();
    const window = harness.windows[0]!;
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);
    harness.service.stop();

    expect(harness.bridge.detachTaskbarWindow).toHaveBeenCalledOnce();
    expect(harness.bridge.detachTaskbarWindow).toHaveBeenCalledWith(
      window.nativeHandle,
    );
    expect(window.destroy).toHaveBeenCalledOnce();
    expect(
      harness.bridge.detachTaskbarWindow.mock.invocationCallOrder[0],
    ).toBeLessThan(window.destroy.mock.invocationCallOrder[0]!);
    expect(harness.subscriptions.disposeDisplay).toHaveBeenCalledOnce();
    expect(harness.subscriptions.disposeTheme).toHaveBeenCalledOnce();
    expect(harness.subscriptions.disposeSession).toHaveBeenCalledOnce();
    expect(harness.subscriptions.disposeHealth).toHaveBeenCalledOnce();
  });
});
