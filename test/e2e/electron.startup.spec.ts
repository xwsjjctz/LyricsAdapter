import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { PersistenceBootstrap } from '../../src/types/typedIpc';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('startup covers slow restoration and enlarges the icon to reveal the saved layout', async ({}, testInfo) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-startup-')));
  const home = path.join(root, 'home');
  const data = path.join(root, 'data');
  await mkdir(path.join(home, '.la'), { recursive: true });
  await mkdir(data, { recursive: true });
  await writeFile(path.join(home, '.la/settings.json'), JSON.stringify({ 'app-language': 'en' }));
  const settings = { 'app-language': 'en', 'app-theme': 'default-light', 'la_library_layout': 'list' };
  const song = { id: 'startup-online', title: 'Restored from cache', artist: 'Test artist',
    album: 'Startup test', duration: 60, source: 'qq', songmid: 'startup-online' };
  const playback = { activeSlotId: 'online', onlineSlot: { currentTrackIndex: -1, currentTime: 0,
    volume: .35, playbackMode: 'order', scrollPosition: 0, filterType: 'default', categorySelection: null } };
  const bootstrap: PersistenceBootstrap = {
    settings: { status: 'ready', data: settings },
    userData: { status: 'ready', data: { schemaVersion: 1, libraryInitialized: true,
      tracks: [{ ...song, slotId: 'online' }], settings, playback: { _json: JSON.stringify(playback) } } },
    libraryIndex: { status: 'ready', data: { songs: [], onlineSongs: [song], settings: playback } },
  };
  const env = Object.fromEntries(Object.entries({ ...process.env,
    HOME: home, USERPROFILE: home, APPDATA: path.join(root, 'app-data'),
    LOCALAPPDATA: path.join(root, 'local-app-data'), XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: data, XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1',
    LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: process.platform === 'darwin' ? '0' : '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE'];
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ cwd: root, args: [
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${data}`, repo,
    ], env });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('html')).toHaveAttribute('data-startup', 'ready');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800));

    // Delay the aggregate read in this isolated process, while exercising the
    // real preload, settings hydration, library restoration and renderer.
    await app.evaluate(({ ipcMain }, snapshot) => {
      const gate = { requested: false, release: () => {} };
      const waiting = new Promise<void>(resolve => { gate.release = resolve; });
      (globalThis as typeof globalThis & { startupGate?: typeof gate }).startupGate = gate;
      ipcMain.removeHandler('ipc:persistence:loadBootstrap');
      ipcMain.handle('ipc:persistence:loadBootstrap', async () => {
        gate.requested = true; await waiting; return { ok: true, data: snapshot };
      });
    }, bootstrap);
    await page.addInitScript(() => {
      const probe: { scale: number; opacity: number; title: string; list: boolean }[] = [];
      (window as typeof window & { startupProbe?: typeof probe }).startupProbe = probe;
      const sample = () => {
        const screen = document.getElementById('app-startup');
        const icon = screen?.querySelector('img.app-startup__icon');
        if (screen && icon && document.documentElement.dataset['startup'] === 'revealing') {
          const style = getComputedStyle(icon);
          probe.push({ scale: style.transform === 'none' ? 1 : new DOMMatrix(style.transform).a,
            opacity: Number(style.opacity), title: document.querySelector('.library-track-row')?.textContent ?? '',
            list: !!document.querySelector('.library-track-row') });
        }
        if (document.documentElement.dataset['startup'] !== 'ready') requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.reload();
    await expect.poll(() => app!.evaluate(() =>
      (globalThis as typeof globalThis & { startupGate?: { requested: boolean } }).startupGate?.requested)).toBe(true);
    const screen = page.locator('#app-startup');
    await expect(screen).toBeVisible();
    const startupBackground = await screen.evaluate(element => {
      const style = getComputedStyle(element);
      return { image: style.backgroundImage, size: style.backgroundSize, position: style.backgroundPosition };
    });
    await expect(page.locator('#root')).toHaveAttribute('inert');
    const artwork = screen.locator('img');
    await expect.poll(() => artwork.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
    const icon = screen.locator('.app-startup__icon');
    const bounds = await icon.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2)).toBeLessThan(1);
    expect(Math.abs(bounds!.y + bounds!.height / 2 - viewport.height / 2)).toBeLessThan(1);
    await page.screenshot({ path: testInfo.outputPath('startup-wide.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(393, 851));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(393);
    await page.screenshot({ path: testInfo.outputPath('startup-portrait.png') });
    await expect(page.locator('html')).toHaveAttribute('data-startup', 'loading');

    await app.evaluate(() =>
      (globalThis as typeof globalThis & { startupGate?: { release: () => void } }).startupGate?.release());
    await expect(screen).toHaveCount(0);
    await expect(page.locator('#root')).not.toHaveAttribute('inert');
    await expect(page.locator('html')).toHaveClass(/theme-dark/);
    await expect(page.locator('.library-track-row')).toContainText('Restored from cache');
    expect(await page.locator('.app-background').evaluate(element => {
      const style = getComputedStyle(element);
      return { image: style.backgroundImage, size: style.backgroundSize, position: style.backgroundPosition };
    })).toEqual(startupBackground);
    await page.screenshot({ path: testInfo.outputPath('library-portrait.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1200);
    await page.screenshot({ path: testInfo.outputPath('library-wide.png') });
    const samples = await page.evaluate(() =>
      (window as typeof window & { startupProbe?: { scale: number; opacity: number; title: string; list: boolean }[] }).startupProbe!);
    expect(samples.some(sample => sample.scale > 1.1 && sample.opacity > 0 && sample.opacity < 1)).toBe(true);
    expect(samples.every(sample => sample.list && sample.title.includes('Restored from cache'))).toBe(true);

    // The same saved view reopens with reduced motion, without zooming or a
    // persistent interaction-blocking screen on a fast cached launch.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-startup', 'ready');
    await expect(screen).toHaveCount(0);
    await expect(page.locator('.library-track-row')).toContainText('Restored from cache');
    const reduced = await page.evaluate(() =>
      (window as typeof window & { startupProbe?: { scale: number }[] }).startupProbe!);
    expect(reduced.every(sample => sample.scale === 1)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
