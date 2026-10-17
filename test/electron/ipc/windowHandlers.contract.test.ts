// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
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
    electronMocks.on.mockReset();
    electronMocks.removeListener.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

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
    expect(win.webContents.send).toHaveBeenCalledWith('window-before-close-flush', expect.any(Number));
  });

  function updateFixture() {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const win = {
      close: vi.fn(), isDestroyed: () => false,
      on: (event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener),
      webContents: { send: vi.fn() },
    };
    const controls = registerWindowControls(win as never);
    const respond = (saved: boolean, sender = win.webContents, requestId?: number) => {
      const callback = electronMocks.on.mock.calls.at(-1)?.[1] as Handler;
      const id = requestId ?? win.webContents.send.mock.calls.at(-1)?.[1];
      callback({ sender }, saved, id);
    };
    return { win, controls, listeners, respond };
  }

  it('waits for the owning renderer to save, then permits the updater to close without another flush', async () => {
    const { win, controls, listeners, respond } = updateFixture();
    const ready = controls.prepareForUpdate();
    respond(true, { send: vi.fn() }); // Another renderer cannot acknowledge the player's save.
    expect(electronMocks.removeListener).not.toHaveBeenCalled();
    respond(true);
    await expect(ready).resolves.toBe(true);
    expect(win.close).not.toHaveBeenCalled();
    const event = { preventDefault: vi.fn() };
    listeners.get('close')?.(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('leaves the window open on save failure and supports retry', async () => {
    const { win, controls, respond } = updateFixture();
    const failed = controls.prepareForUpdate();
    respond(false);
    await expect(failed).resolves.toBe(false);
    expect(win.close).not.toHaveBeenCalled();
    const retry = controls.prepareForUpdate();
    respond(true);
    await expect(retry).resolves.toBe(true);
  });

  it('rejects a timed-out save and ignores its late reply during a subsequent attempt', async () => {
    const { win, controls, respond } = updateFixture();
    const failed = controls.prepareForUpdate();
    const oldId = win.webContents.send.mock.calls.at(-1)?.[1] as number;
    await vi.advanceTimersByTimeAsync(3000);
    await expect(failed).resolves.toBe(false);
    const retry = controls.prepareForUpdate();
    let ready = false;
    void retry.then(() => { ready = true; });
    respond(true, win.webContents, oldId);
    await Promise.resolve();
    expect(ready).toBe(false);
    respond(true);
    await expect(retry).resolves.toBe(true);
    expect(win.close).not.toHaveBeenCalled();
  });

  it('tells the renderer when the window is minimized or hidden, once per change', () => {
    const state = { visible: true, minimized: false };
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const win = {
      isDestroyed: () => false,
      isVisible: () => state.visible,
      isMinimized: () => state.minimized,
      on: (event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener),
      webContents: { send: vi.fn() },
    };
    registerWindowControls(win as never);
    const visibilityMessages = () => win.webContents.send.mock.calls
      .filter(([channel]) => channel === 'window-visibility-changed')
      .map(([, visible]) => visible);

    state.minimized = true;
    listeners.get('minimize')?.();
    listeners.get('minimize')?.();
    state.minimized = false;
    listeners.get('restore')?.();
    state.visible = false;
    listeners.get('hide')?.();
    state.visible = true;
    listeners.get('show')?.();

    expect(visibilityMessages()).toEqual([false, true, false, true]);
  });

  it('restores the ordinary close handshake when update installation fails', async () => {
    const { controls, listeners, respond } = updateFixture();
    const ready = controls.prepareForUpdate();
    respond(true);
    await ready;
    controls.cancelUpdatePreparation();
    const event = { preventDefault: vi.fn() };
    listeners.get('close')?.(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });
});
