// @vitest-environment node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../electron',
);

const electronMocks = vi.hoisted(() => ({
  BrowserWindow: vi.fn(),
  app: {
    isPackaged: false,
    getAppPath: vi.fn().mockReturnValue('/virtual/app'),
    getPath: vi.fn().mockReturnValue('/virtual/user-data'),
    on: vi.fn(),
  },
}));

vi.mock('electron', () => electronMocks);
vi.mock('@/../electron/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}));

import {
  createWindow,
  resolveWindowsAppUserModelId,
  resolveWindowsWindowIconPath,
  shouldThrottleRendererInBackground,
} from '@/../electron/windowManager';

function createBrowserWindowStub() {
  return {
    webContents: {
      session: {
        webRequest: {
          onBeforeSendHeaders: vi.fn(),
          onHeadersReceived: vi.fn(),
        },
      },
      executeJavaScript: vi.fn(),
      on: vi.fn(),
    },
    loadURL: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    setAppDetails: vi.fn(),
  };
}

describe('windowManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.app.getAppPath.mockReturnValue('/virtual/app');
    electronMocks.app.getPath.mockReturnValue('/virtual/user-data');
    electronMocks.BrowserWindow.mockImplementation(() => createBrowserWindowStub());
  });

  it('keeps macOS renderer timers active without disabling throttling elsewhere', () => {
    expect(shouldThrottleRendererInBackground('darwin')).toBe(false);
    expect(shouldThrottleRendererInBackground('win32')).toBe(true);
    expect(shouldThrottleRendererInBackground('linux')).toBe(true);
  });

  it('resolves the Windows window icon from the packaged resources directory', () => {
    expect(resolveWindowsWindowIconPath({
      appPath: '/virtual/app',
      resourcesPath: '/virtual/resources',
      isPackaged: true,
    })).toBe(path.join('/virtual/resources', 'app-icon-win.ico'));

    expect(resolveWindowsWindowIconPath({
      appPath: '/virtual/app',
      resourcesPath: '/virtual/resources',
      isPackaged: false,
    })).toBe(path.join('/virtual/app', 'app-icon-win.ico'));
  });

  it('isolates development from the packaged Windows application identity', () => {
    expect(resolveWindowsAppUserModelId(true)).toBe('com.lyricsadapter.app');
    expect(resolveWindowsAppUserModelId(false)).toBe('com.lyricsadapter.app.development');
  });

  it('uses the platform timer policy and disables spell checking for the main window', async () => {
    await createWindow();

    expect(electronMocks.BrowserWindow).toHaveBeenCalledOnce();
    expect(electronMocks.BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      webPreferences: expect.objectContaining({
        preload: path.join(electronDirectory, 'preload.cjs'),
        backgroundThrottling: shouldThrottleRendererInBackground(process.platform),
        spellcheck: false,
      }),
    }));

    const windowOptions = electronMocks.BrowserWindow.mock.calls[0]?.[0];
    if (process.platform === 'win32') {
      expect(windowOptions).toEqual(expect.objectContaining({
        icon: path.join('/virtual/app', 'app-icon-win.ico'),
      }));
      const window = electronMocks.BrowserWindow.mock.results[0]?.value;
      expect(window.setAppDetails).toHaveBeenCalledWith({
        appId: 'com.lyricsadapter.app.development',
        appIconPath: path.join('/virtual/app', 'app-icon-win.ico'),
        appIconIndex: 0,
      });
    } else {
      expect(windowOptions).not.toHaveProperty('icon');
    }
  });
});
