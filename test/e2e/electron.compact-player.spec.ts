import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IpcMainInvokeEvent } from 'electron';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const run = promisify(execFile);
const require = createRequire(import.meta.url);
interface NativeItem { id: string; hidden: boolean; x: number; y: number; width: number; height: number; label: string }
interface NativeSnapshot { windowNumber: number; items: NativeItem[] }

for (const native of [false, true]) {
  test(`${native ? 'native glass' : 'web'} player and wall reflow without overlaps or Focus control flashes`, async ({}, testInfo) => {
    test.skip(native && (process.platform !== 'darwin' || Number(os.release().split('.')[0]) < 25), 'Requires macOS 26');
    test.setTimeout(90_000);
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-compact-player-')));
    const isolatedHome = path.join(root, 'home');
    const userData = path.join(root, 'data');
    await mkdir(path.join(isolatedHome, '.la'), { recursive: true });
    await mkdir(path.join(userData, 'covers'), { recursive: true });
    await writeFile(path.join(isolatedHome, '.la/settings.json'), JSON.stringify({ 'app-language': 'en' }));
    const audio = Buffer.alloc(44 + 8000 * 2 * 120);
    audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
    audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
    const songs = Array.from({ length: 60 }, (_, index) => ({
      id: `compact-${index}`, title: `A song for the long journey ${index}`, artist: 'LyricsAdapter / 很长的歌手名称',
      album: 'Responsive wall', duration: 120, source: 'local', available: true,
      filePath: path.join(root, `${index}.wav`), coverUrl: `cover://compact-${index}.png`,
      syncedLyrics: [{ time: 0, text: '陪你走过漫长的旅程' }, { time: 30, text: '让音乐留在此刻' }],
    }));
    for (const song of songs) {
      await writeFile(song.filePath, audio);
      await copyFile(path.join(repo, 'app-icon.png'), path.join(userData, 'covers', `${song.id}.png`));
    }
    await writeFile(path.join(userData, 'library-index.json'), JSON.stringify({ songs, settings: {
      activeSlotId: 'local', localSlot: { currentTrackIndex: 0, currentTime: 12, volume: .4,
        playbackMode: 'order', scrollPosition: 0, filterType: 'default', categorySelection: null },
    } }));
    const probePath = path.join(root, 'probe.node');
    if (native) {
      const version = require('electron/package.json').version as string;
      await run('clang++', ['-std=c++17', '-fobjc-arc', '-shared', '-undefined', 'dynamic_lookup',
        '-I', path.join(os.homedir(), '.electron-gyp', version, 'include/node'), '-framework', 'AppKit',
        path.join(repo, 'test/native/focusGlassProbe.mm'), '-o', probePath]);
    }
    const env = Object.fromEntries(Object.entries({ ...process.env,
      HOME: isolatedHome, USERPROFILE: isolatedHome, APPDATA: path.join(root, 'app-data'),
      LOCALAPPDATA: path.join(root, 'local-app-data'), XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_DATA_HOME: path.join(root, 'xdg-data'), XDG_CACHE_HOME: path.join(root, 'cache'),
      NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: native ? '0' : '1',
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    delete env['ELECTRON_RUN_AS_NODE'];
    let app: ElectronApplication | undefined;
    try {
      app = await electron.launch({ cwd: root, args: [
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userData}`, repo,
      ], env });
      const page = await app.firstWindow();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const probe = async (id?: string): Promise<NativeSnapshot> => JSON.parse(await app!.evaluate(({ BrowserWindow }, args) => {
        const { createRequire } = process.getBuiltinModule('module');
        const bridge = createRequire(args.file)(args.file) as { probe: (handle: Buffer, id?: string) => string };
        const handle = BrowserWindow.getAllWindows()[0]!.getNativeWindowHandle();
        return args.id ? bridge.probe(handle, args.id) : bridge.probe(handle);
      }, { file: probePath, id }));
      const audioState = () => page.locator('audio').evaluate((node: HTMLAudioElement) => ({
        paused: node.paused, time: node.currentTime, volume: node.volume, src: node.currentSrc,
      }));
      const resize = async (width: number, height = 800) => {
        await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height), { width, height });
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      };
      const panel = page.getByTestId('main-controlbar');
      await expect(page.locator('.wall-tile').first()).toBeVisible();
      if (native) await expect(panel).toHaveAttribute('data-native-controlbar', 'true');
      await expect.poll(() => page.locator('audio').evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(2);
      if (!(await audioState()).paused) await page.keyboard.press('Space');
      await expect.poll(async () => (await audioState()).paused).toBe(true);
      const before = await audioState();
      for (const width of [360, 393, 600, 719, 720, 900, 1200]) {
        await resize(width);
        const compact = width < 720;
        await expect(panel).toHaveAttribute('data-compact-controlbar', String(compact));
        await expect.poll(() => page.locator('.wall-tile').evaluateAll(nodes => Math.min(...nodes.map(node => node.getBoundingClientRect().width))))
          .toBeGreaterThanOrEqual(Math.floor(width / (compact ? 3 : 6)));
        const geometry = await page.locator('.wall-tile').evaluateAll(nodes => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          right: Math.max(...nodes.map(node => node.getBoundingClientRect().right)),
          shapes: new Set(nodes.map(node => { const r = node.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })).size,
        }));
        expect(geometry.overflow).toBe(false); expect(geometry.right).toBeLessThanOrEqual(width);
        expect(geometry.shapes).toBeGreaterThan(1);
        if (native) {
          await expect.poll(async () => (await probe()).items.find(item => item.id === 'player-controlbar-mode')?.hidden).toBe(compact);
          const items = (await probe()).items;
          const item = (suffix: string) => items.find(node => node.id === `player-controlbar-${suffix}`)!;
          for (const suffix of ['seek', 'slider-glass', 'volume-button', 'mode']) expect(item(suffix).hidden).toBe(compact);
          for (const suffix of ['focus', 'title', 'artist', 'previous', 'play', 'next']) expect(item(suffix).hidden).toBe(false);
          const glass = item('glass'), title = item('title'), previous = item('previous'), next = item('next');
          expect(title.x + title.width).toBeLessThanOrEqual(previous.x);
          expect(item('focus').x + item('focus').width).toBeLessThan(title.x);
          expect(previous.x + previous.width).toBeLessThanOrEqual(item('play').x);
          expect(item('play').x + item('play').width).toBeLessThanOrEqual(next.x);
          expect(next.x + next.width).toBeLessThanOrEqual(glass.x + glass.width);
        } else {
          await expect(panel.getByRole('slider', { name: 'Playback position' })).toBeVisible({ visible: !compact });
          await expect(panel.getByRole('slider', { name: 'Volume', exact: true })).toBeVisible({ visible: process.platform !== 'darwin' && !compact });
          expect(await panel.getByRole('button').count()).toBe(compact ? 3 : 5);
          const bounds = await panel.evaluate(node => {
            const info = node.querySelector('.player-track-info')!.getBoundingClientRect();
            const transport = node.querySelector('.player-transport')!.getBoundingClientRect();
            return { infoRight: info.right, infoWidth: info.width, controlsLeft: transport.x, controlsRight: transport.right, panelRight: node.getBoundingClientRect().right };
          });
          expect(bounds.infoRight).toBeLessThanOrEqual(bounds.controlsLeft);
          expect(bounds.controlsRight).toBeLessThanOrEqual(bounds.panelRight);
          if (compact) expect(bounds.infoWidth).toBeGreaterThan(140);
        }
        expect(await audioState()).toEqual(before);
        if (width === 393 || width === 1200) {
          if (native && process.env['LA_RESPONSIVE_SCREENSHOTS'] === '1') {
            const file = testInfo.outputPath(`native-${width}.png`);
            await mkdir(path.dirname(file), { recursive: true });
            await run('screencapture', ['-x', '-l', String((await probe()).windowNumber), file]);
          } else if (!native) await page.screenshot({ path: testInfo.outputPath(`web-${width}.png`) });
        }
      }
      // A density change keeps the song in view, even far down a virtualized wall.
      await page.locator('.poster-wall').evaluate(node => { node.scrollTop = 1200; });
      await page.waitForTimeout(100);
      const anchoredId = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('.wall-tile')?.getAttribute('data-track-id'));
      expect(anchoredId).toBeTruthy();
      await resize(393);
      await expect(page.locator(`.wall-tile[data-track-id="${anchoredId}"]`)).toBeInViewport();
      if (native) {
        const toggle = () => probe('player-controlbar-play');
        await toggle(); await expect.poll(async () => (await audioState()).paused).toBe(false);
        await toggle(); await expect.poll(async () => (await audioState()).paused).toBe(true);
        await probe('player-controlbar-next');
        await expect.poll(async () => (await probe()).items.find(item => item.id === 'player-controlbar-title')?.label).toBe(songs[1]!.title);
        await probe('player-controlbar-previous');
        await expect.poll(async () => (await probe()).items.find(item => item.id === 'player-controlbar-title')?.label).toBe(songs[0]!.title);
        // Delay only the IPC response, after the native start. This reproduces
        // busy-machine startup without changing production lifecycle ordering.
        await app.evaluate(({ ipcMain }) => {
          type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
          const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
          const original = handlers.get('ipc:focusGlass:start')!;
          ipcMain.removeHandler('ipc:focusGlass:start');
          ipcMain.handle('ipc:focusGlass:start', async (event, ...args: unknown[]) => {
            const result = original(event, ...args);
            await new Promise(resolve => setTimeout(resolve, 700));
            return result;
          });
        });
        await page.evaluate(() => {
          document.documentElement.dataset['webFocusFlashes'] = '0';
          new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) {
              if (node instanceof Element && (node.matches('[data-testid="focus-web-controls"]') || node.querySelector('[data-testid="focus-web-controls"]'))) {
                document.documentElement.dataset['webFocusFlashes'] = String(Number(document.documentElement.dataset['webFocusFlashes']) + 1);
              }
            }
          }).observe(document.body, { childList: true, subtree: true });
        });
        await page.keyboard.press('ControlOrMeta+Enter');
        const focus = page.locator('.focus-mode-overlay');
        await expect(focus).toHaveAttribute('data-focus-layout', 'portrait');
        for (const [width, height] of [[900, 720], [800, 800], [900, 720], [600, 800], [1200, 800]] as const) {
          await resize(width, height);
          const portrait = width <= height;
          await expect(focus).toHaveAttribute('data-focus-layout', portrait ? 'portrait' : 'landscape');
          if (portrait) await expect(page.getByTestId('focus-portrait-controls')).toBeAttached();
          else await expect(page.getByTestId('focus-native-controls')).toHaveAttribute('data-native-status', 'active');
          await expect(page.getByTestId('focus-web-controls')).toHaveCount(0);
          expect(await page.locator('html').getAttribute('data-web-focus-flashes')).toBe('0');
          await expect.poll(async () => (await probe()).items.filter(item => item.id === 'focus-glass-host').length).toBe(portrait ? 0 : 1);
        }
      } else {
        await panel.getByTestId('main-play-button').click();
        await expect.poll(async () => (await audioState()).paused).toBe(false);
        await panel.getByTestId('main-play-button').click();
        await expect.poll(async () => (await audioState()).paused).toBe(true);
        await panel.getByRole('button', { name: 'Next Track' }).click();
        await expect(panel).toContainText(songs[1]!.title);
        await panel.getByRole('button', { name: 'Previous Track' }).click();
        await expect(panel).toContainText(songs[0]!.title);
      }
      expect(errors).toEqual([]);
    } finally {
      await app?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
