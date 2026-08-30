// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  BrowserWindow: vi.fn(),
  app: {
    isPackaged: false,
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
  };
}

describe('windowManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.app.getPath.mockReturnValue('/virtual/user-data');
    electronMocks.BrowserWindow.mockImplementation(() => createBrowserWindowStub());
  });

  it('keeps macOS renderer timers active without disabling throttling elsewhere', () => {
    expect(shouldThrottleRendererInBackground('darwin')).toBe(false);
    expect(shouldThrottleRendererInBackground('win32')).toBe(true);
    expect(shouldThrottleRendererInBackground('linux')).toBe(true);
  });

  it('uses the platform-specific background timer policy for the main window', async () => {
    await createWindow();

    expect(electronMocks.BrowserWindow).toHaveBeenCalledOnce();
    expect(electronMocks.BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      webPreferences: expect.objectContaining({
        backgroundThrottling: shouldThrottleRendererInBackground(process.platform),
      }),
    }));
  });
});
