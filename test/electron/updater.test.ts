// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(), on: vi.fn(), nativeOn: vi.fn(), unavailable: vi.fn(), version: vi.fn(),
  windows: vi.fn(), check: vi.fn(), install: vi.fn(),
  updater: { autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false, disableDifferentialDownload: false },
}));
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: mocks.version },
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { getAllWindows: mocks.windows },
  autoUpdater: { on: mocks.nativeOn },
}));
vi.mock('electron-updater', () => ({
  autoUpdater: { ...mocks.updater, on: mocks.on, checkForUpdates: mocks.check, quitAndInstall: mocks.install },
}));
vi.mock('../../electron/services/updaterAvailability', () => ({ getUpdaterUnavailableReason: mocks.unavailable }));
vi.mock('../../electron/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

function handler(channel: string) {
  return mocks.handle.mock.calls.find(([name]) => name === channel)?.[1] as () => unknown;
}
function emit(event: string, value: unknown) {
  const callback = mocks.on.mock.calls.find(([name]) => name === event)?.[1] as (value: unknown) => void;
  callback(value);
}
const info = { version: '0.4.1', files: [], path: 'app.zip', sha512: 'hash', releaseDate: '2026-10-11' };
function finishDownload() {
  emit('update-downloaded', info);
  const nativeReady = mocks.nativeOn.mock.calls.find(([name]) => name === 'update-downloaded')?.[1] as (() => void) | undefined;
  nativeReady?.();
}

describe('app updates', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.version.mockReturnValue('0.4.0');
    mocks.unavailable.mockReturnValue(null);
    mocks.windows.mockReturnValue([]);
    mocks.check.mockReset().mockResolvedValue(null);
    mocks.install.mockReset();
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('does not poll or install for an unsigned Mac build', async () => {
    mocks.unavailable.mockReturnValue('unsigned');
    const { initUpdater, scheduleStartupCheck } = await import('../../electron/updater');
    initUpdater(vi.fn(), vi.fn());
    expect(handler('updater:state')()).toEqual({ status: 'unavailable', reason: 'unsigned' });
    await expect(handler('updater:check')()).resolves.toMatchObject({ ok: false });
    await expect(handler('updater:quit-and-install')()).resolves.toMatchObject({ ok: false });
    scheduleStartupCheck();
    await vi.runAllTimersAsync();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it('sends live progress to the player and the separate settings renderer', async () => {
    const windows = [0, 1].map(() => ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } }));
    mocks.windows.mockReturnValue(windows);
    const { initUpdater } = await import('../../electron/updater');
    initUpdater(vi.fn(), vi.fn());
    emit('update-available', info);
    emit('download-progress', { percent: 42 });
    for (const win of windows) {
      expect(win.webContents.send).toHaveBeenLastCalledWith('updater-event', {
        status: 'downloading', info, progress: { percent: 42 },
      });
    }
  });

  it('requires a downloaded update and a successful save, and can retry after a failed save', async () => {
    const prepare = vi.fn().mockResolvedValue(false), cancel = vi.fn();
    const { initUpdater } = await import('../../electron/updater');
    initUpdater(prepare, cancel);
    await expect(handler('updater:quit-and-install')()).resolves.toEqual({ ok: false });
    expect(prepare).not.toHaveBeenCalled();
    finishDownload();
    await expect(handler('updater:quit-and-install')()).resolves.toEqual({ ok: false });
    expect(mocks.install).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    prepare.mockResolvedValue(true);
    finishDownload();
    await expect(handler('updater:quit-and-install')()).resolves.toEqual({ ok: true });
    expect(mocks.install).toHaveBeenCalledOnce();
  });

  it('restores close protection on an asynchronous installation error', async () => {
    const cancel = vi.fn();
    const { initUpdater } = await import('../../electron/updater');
    initUpdater(vi.fn().mockResolvedValue(true), cancel);
    finishDownload();
    await handler('updater:quit-and-install')();
    emit('error', new Error('Signature validation failed'));
    expect(cancel).toHaveBeenCalledOnce();
    expect(handler('updater:state')()).toMatchObject({ status: 'error', message: 'Signature validation failed' });
  });

  it('keeps stable 1.x releases off the prerelease feed', async () => {
    mocks.version.mockReturnValue('1.0.0');
    const { initUpdater } = await import('../../electron/updater');
    const { autoUpdater } = await import('electron-updater');
    initUpdater(vi.fn(), vi.fn());
    expect(autoUpdater.allowPrerelease).toBe(false);
  });

  it('does not let the delayed startup check replace a download started manually', async () => {
    const { initUpdater, scheduleStartupCheck } = await import('../../electron/updater');
    initUpdater(vi.fn(), vi.fn());
    scheduleStartupCheck();
    emit('update-available', info);
    await vi.runAllTimersAsync();
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === 'darwin')('waits for Squirrel signature verification before offering restart', async () => {
    const prepare = vi.fn().mockResolvedValue(true);
    const { initUpdater } = await import('../../electron/updater');
    initUpdater(prepare, vi.fn());
    emit('update-downloaded', info);
    expect(handler('updater:state')()).toMatchObject({ status: 'downloading' });
    await expect(handler('updater:quit-and-install')()).resolves.toEqual({ ok: false });
    expect(prepare).not.toHaveBeenCalled();
    const nativeReady = mocks.nativeOn.mock.calls.find(([name]) => name === 'update-downloaded')?.[1] as () => void;
    nativeReady();
    expect(handler('updater:state')()).toMatchObject({ status: 'downloaded' });
  });
});
