// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  once: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle,
    once: electronMocks.once,
  },
}));

vi.mock('@/../electron/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

import { registerWindowControls } from '@/../electron/ipc/windowHandlers';

type Handler = (_event: unknown, ...args: unknown[]) => unknown;

function registeredHandler(channel: string): Handler {
  const match = electronMocks.handle.mock.calls.find(([name]) => name === channel);
  if (!match) throw new Error(`Missing handler for ${channel}`);
  return match[1] as Handler;
}

describe('window close persistence handshake', () => {
  beforeEach(() => {
    electronMocks.handle.mockReset();
    electronMocks.once.mockReset();
  });

  it('closes an already-flushed title-bar request without requesting a second renderer flush', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const win = {
      close: vi.fn(),
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      isMaximized: vi.fn().mockReturnValue(false),
      isFullScreen: vi.fn().mockReturnValue(false),
      isDestroyed: vi.fn().mockReturnValue(false),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
      }),
      webContents: { send: vi.fn() },
    };

    registerWindowControls(win as never);
    await registeredHandler('window-close')({}, true);
    const closeEvent = { preventDefault: vi.fn() };
    listeners.get('close')?.(closeEvent);

    expect(win.close).toHaveBeenCalledTimes(1);
    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalledWith('window-before-close-flush');
  });

  it('keeps the renderer flush handshake for a native window close', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const win = {
      close: vi.fn(),
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      isMaximized: vi.fn().mockReturnValue(false),
      isFullScreen: vi.fn().mockReturnValue(false),
      isDestroyed: vi.fn().mockReturnValue(false),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
      }),
      webContents: { send: vi.fn() },
    };

    registerWindowControls(win as never);
    const closeEvent = { preventDefault: vi.fn() };
    listeners.get('close')?.(closeEvent);

    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith('window-before-close-flush');
  });
});
