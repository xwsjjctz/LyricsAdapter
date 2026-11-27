// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(), on: vi.fn(), nativeOn: vi.fn(), unavailable: vi.fn(), version: vi.fn(),
  windows: vi.fn(), check: vi.fn(), install: vi.fn(), openExternal: vi.fn(),
  updater: { autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false, disableDifferentialDownload: true },
}));
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: mocks.version },
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { getAllWindows: mocks.windows },
  autoUpdater: { on: mocks.nativeOn },
  shell: { openExternal: mocks.openExternal },
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
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('opens the newest compatible Mac release only after an unsigned build checks manually', async () => {
    mocks.unavailable.mockReturnValue('unsigned');
    const release = (version: string, arch: string = process.arch, draft = false) => ({
      tag_name: `v${version}`,
      draft,
      prerelease: true,
      assets: [{ name: `LyricsAdapter-${version}-mac-${arch}.dmg`, state: 'uploaded' }],
    });
    const fetchReleases = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      release('0.5.0', 'other-arch'),
      release('0.4.3', process.arch, true),
      release('0.4.1'),
      release('0.4.2'),
      release('0.4.0'),
    ])));
    vi.stubGlobal('fetch', fetchReleases);
    const { initUpdater, scheduleStartupCheck } = await import('../../electron/updater');
    initUpdater(vi.fn(), vi.fn());
    expect(handler('updater:state')()).toEqual({ status: 'idle' });
    scheduleStartupCheck();
    await vi.runAllTimersAsync();
    expect(fetchReleases).not.toHaveBeenCalled();
    await expect(handler('updater:check')()).resolves.toEqual({ ok: true });
    expect(mocks.openExternal).toHaveBeenCalledWith('https://github.com/xwsjjctz/LyricsAdapter/releases/tag/v0.4.2#assets');
    expect(handler('updater:state')()).toEqual({ status: 'manual-available', version: '0.4.2' });
    await expect(handler('updater:quit-and-install')()).resolves.toMatchObject({ ok: false });
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === 'darwin')('allows a manual Mac check without app-update.yml when no installer is available', async () => {
    mocks.unavailable.mockReturnValue('unconfigured');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { tag_name: 'v0.4.1', draft: false, prerelease: true, assets: [] },
    ]))));
    const { initUpdater } = await import('../../electron/updater');
    initUpdater(vi.fn(), vi.fn());
    await expect(handler('updater:check')()).resolves.toEqual({ ok: true });
    expect(handler('updater:state')()).toEqual({ status: 'not-available' });
    expect(mocks.openExternal).not.toHaveBeenCalled();
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

  it('treats a tag whose release is not published yet as no update', async () => {
    const unpublished = Object.assign(
      new Error('Cannot find latest-mac.yml in the latest release artifacts (https://example.test/latest-mac.yml): HttpError: 404\nHeaders: {}'),
      { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' },
    );
    mocks.check.mockRejectedValue(unpublished);
    const { initUpdater } = await import('../../electron/updater');
    initUpdater(vi.fn(), vi.fn());

    await expect(handler('updater:check')()).resolves.toEqual({ ok: true });
    expect(handler('updater:state')()).toEqual({ status: 'not-available' });

    emit('error', unpublished);
    expect(handler('updater:state')()).toEqual({ status: 'not-available' });
  });

  it('shows only the first line of other update errors', async () => {
    mocks.check.mockRejectedValue(new Error(`HttpError: 500 "server error"\nHeaders: ${'x'.repeat(400)}\n    at stack`));
    const { initUpdater } = await import('../../electron/updater');
    initUpdater(vi.fn(), vi.fn());

    await expect(handler('updater:check')()).resolves.toEqual({ ok: false, reason: 'HttpError: 500 "server error"' });
    expect(handler('updater:state')()).toEqual({ status: 'error', message: 'HttpError: 500 "server error"' });

    emit('error', new Error('y'.repeat(300)));
    const state = handler('updater:state')() as { message: string };
    expect(state.message).toHaveLength(200);
    expect(state.message.endsWith('…')).toBe(true);
  });

  it('downloads updates differentially on every platform', async () => {
    const { initUpdater } = await import('../../electron/updater');
    const { autoUpdater } = await import('electron-updater');
    initUpdater(vi.fn(), vi.fn());
    expect(autoUpdater.disableDifferentialDownload).toBe(false);
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
