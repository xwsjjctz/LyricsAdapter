import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const run = promisify(execFile);
const require = createRequire(import.meta.url);

test('playlist switcher previews, reverses, cancels and commits without changing playback', async ({}, testInfo) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-playlist-switcher-')));
  const isolatedHome = path.join(root, 'home');
  const userData = path.join(root, 'data');
  await mkdir(path.join(isolatedHome, '.la'), { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(isolatedHome, '.la/settings.json'), JSON.stringify({ 'app-language': 'en' }));
  const audio = Buffer.alloc(44 + 8000 * 2 * 120);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  const songs = ['Amber', 'Blue', 'Coral'].map((title, index) => ({
    id: `switcher-${index}`, title, artist: 'Test Artist', album: 'Playlist switcher',
    duration: 120, source: 'local', available: true, filePath: path.join(root, `${index}.wav`),
    syncedLyrics: [{ time: 0, text: 'A quiet moment' }, { time: 30, text: 'For another journey' }],
  }));
  for (const song of songs) await writeFile(song.filePath, audio);
  await writeFile(path.join(userData, 'library-index.json'), JSON.stringify({ songs, settings: {
    activeSlotId: 'local', localSlot: { currentTrackIndex: 0, currentTime: 12, volume: .4,
      playbackMode: 'order', scrollPosition: 0, filterType: 'default', categorySelection: null },
  } }));
  const native = process.platform === 'darwin' && Number(os.release().split('.')[0]) >= 25;
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
    XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: process.platform === 'darwin' ? '0' : '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE'];
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ cwd: root, args: [
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userData}`, repo,
    ], env });
    const page = await app.firstWindow();
    const controlbar = page.getByTestId('main-controlbar');
    const assertControlbarVisible = async () => {
      await expect(controlbar).toBeVisible();
      if (!native) return;
      await expect(controlbar).toHaveAttribute('data-native-controlbar', 'true');
      // Let the occlusion detector send its update after the overlay/resize;
      // otherwise inspecting the previous native frame could miss a regression.
      await page.evaluate(() => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      // Inspect the actual AppKit glass and host, not just their transparent DOM anchor.
      await expect.poll(async () => {
        const snapshot = JSON.parse(await app!.evaluate(({ BrowserWindow }, file) => {
          const { createRequire } = process.getBuiltinModule('module');
          const bridge = createRequire(file)(file) as { probe: (handle: Buffer) => string };
          return bridge.probe(BrowserWindow.getAllWindows()[0]!.getNativeWindowHandle());
        }, probePath)) as { items: { id: string; alpha: number; hidden: boolean }[] };
        const host = snapshot.items.find(item => item.id === 'player-controlbar-host');
        const glass = snapshot.items.find(item => item.id === 'player-controlbar-glass');
        return !!host && !host.hidden && !!glass && !glass.hidden && glass.alpha > .99;
      }).toBe(true);
    };
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800));
    const tiles = page.locator('.wall-tile');
    await expect(tiles).toHaveCount(3);
    const audioState = () => page.locator('audio').evaluate((node: HTMLAudioElement) => ({
      time: node.currentTime, paused: node.paused, volume: node.volume, src: node.currentSrc,
    }));
    await expect.poll(() => page.locator('audio').evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(2);
    if (!(await audioState()).paused) await page.keyboard.press('Space');
    await expect.poll(async () => (await audioState()).paused).toBe(true);
    await assertControlbarVisible();
    const before = await audioState();
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const begin = async () => { await page.keyboard.down(modifier); await page.keyboard.press('Backquote'); };
    const dialog = page.getByTestId('playlist-switcher');
    const selected = dialog.getByRole('option', { selected: true });

    await begin();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('option')).toHaveCount(2);
    await assertControlbarVisible();
    await expect(selected).toHaveAccessibleName('Online History');
    await expect(tiles).toHaveCount(3);
    await page.keyboard.press('Backquote'); await expect(selected).toHaveAccessibleName('Local');
    await page.keyboard.press('Shift+Backquote'); await expect(selected).toHaveAccessibleName('Online History');
    await page.keyboard.press('Space'); expect(await audioState()).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath('switcher-wide.png') });
    await page.keyboard.up(modifier);
    // On the first rendered frame, no outgoing tiles remain fading or sinking.
    expect(await page.evaluate(() => new Promise<number>(resolve => {
      requestAnimationFrame(() => resolve(document.querySelectorAll('.wall-tile').length));
    }))).toBe(0);
    await expect(dialog).toHaveCount(0); await expect(tiles).toHaveCount(0);
    expect(await audioState()).toEqual(before);

    await begin(); await expect(selected).toHaveAccessibleName('Local');
    await page.keyboard.press('Escape'); await page.keyboard.up(modifier);
    await expect(dialog).toHaveCount(0); await expect(tiles).toHaveCount(0);

    await begin();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(393, 851));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(393);
    expect(await dialog.evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(393);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(393);
    await assertControlbarVisible();
    await page.screenshot({ path: testInfo.outputPath('switcher-portrait.png') });
    await dialog.getByRole('option', { name: 'Local', exact: true }).click();
    await page.keyboard.up(modifier);
    await expect(tiles).toHaveCount(3); expect(await audioState()).toEqual(before);

    // Separate chords return to the previously used source immediately;
    // repeat several times without changing the playing track or checkpoint.
    for (const name of ['Online History', 'Local', 'Online History', 'Local']) {
      await begin(); await expect(selected).toHaveAccessibleName(name);
      await page.keyboard.up(modifier);
      expect(await page.evaluate(() => new Promise<number>(resolve => {
        requestAnimationFrame(() => resolve(document.querySelectorAll('.wall-tile').length));
      }))).toBe(name === 'Local' ? 3 : 0);
      expect(await audioState()).toEqual(before);
    }

    // Available above FocusMode too: cancel preserves it, confirmation navigates
    // to the chosen list while leaving the playing slot and checkpoint intact.
    await page.keyboard.press('ControlOrMeta+Enter');
    const focus = page.locator('.focus-mode-overlay');
    await expect(focus).toHaveAttribute('data-focus-layout', 'portrait');
    await begin(); await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape'); await page.keyboard.up(modifier);
    await expect(focus).toHaveCount(1);
    await begin(); await page.keyboard.up(modifier);
    await expect(focus).toHaveCount(0); await expect(tiles).toHaveCount(0);
    expect(await audioState()).toEqual(before);

    // Seed seven additional playlists through the real provider/preload path in
    // this isolated app, so wrapping and vertical scrolling exercise nine items.
    const cover = await page.evaluate(() => new URL('default-cover.jpg', location.href).href);
    await app.evaluate(({ ipcMain }, coverUrl) => {
      ipcMain.removeHandler('netease-request');
      ipcMain.handle('netease-request', (_event, channel: string) => ({ success: true,
        data: channel === '/nuser/account/get' ? { code: 200, profile: { userId: 1 } }
          : { code: 200, playlist: Array.from({ length: 7 }, (_, index) => ({
            id: index + 1, name: `Journey ${index + 1}`, trackCount: 10, coverImgUrl: coverUrl,
          })) },
      }));
    }, cover);
    await page.evaluate(async () => {
      const api = (window as typeof window & { electron: { settingsSet: (key: string, value: string) => Promise<void> } }).electron;
      await api.settingsSet('netease_cookie', 'MUSIC_U=switcher-layout-fixture;');
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-startup', 'ready');
    // Wait for provider refresh before freezing the switcher's items.
    await expect.poll(async () => {
      await begin();
      const count = await dialog.getByRole('option').count();
      await page.keyboard.press('Escape'); await page.keyboard.up(modifier);
      return count;
    }).toBe(9);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setMinimumSize(300, 360));
    await begin();
    await expect(dialog.getByRole('option')).toHaveCount(9);
    const layout = () => dialog.evaluate(node => {
      const box = node.getBoundingClientRect();
      const list = node.querySelector('[role="listbox"]')!.getBoundingClientRect();
      const cards = [...node.querySelectorAll('[role="option"]')].map(card => card.getBoundingClientRect());
      const active = node.querySelector('[aria-selected="true"]')!.getBoundingClientRect();
      const bar = document.querySelector('[data-testid="main-controlbar"]')!.getBoundingClientRect();
      return { width: box.width, artwork: node.querySelector('.playlist-switcher__artwork')!.getBoundingClientRect().width,
        rows: new Set(cards.map(card => Math.round(card.top))).size,
        fits: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom < bar.top,
        overflow: document.documentElement.scrollWidth > innerWidth,
        selectionVisible: active.top >= list.top - 1 && active.bottom <= list.bottom + 1,
      };
    });
    const resize = async (width: number, height: number) => {
      await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height), { width, height });
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      await expect.poll(async () => { const state = await layout(); return state.fits && !state.overflow; }).toBe(true);
      await assertControlbarVisible();
    };
    await resize(1200, 800);
    const wide = await layout();
    expect(wide.rows).toBe(2);
    await page.screenshot({ path: testInfo.outputPath('switcher-grid-wide.png') });
    await resize(640, 700);
    const medium = await layout();
    expect(medium.width).toBeLessThan(wide.width);
    expect(medium.artwork).toBeLessThan(wide.artwork);
    expect(medium.rows).toBe(2);
    await resize(393, 851);
    const portrait = await layout();
    expect(portrait.width).toBeLessThan(medium.width);
    expect(portrait.artwork).toBeLessThan(medium.artwork);
    expect(portrait.rows).toBe(3);
    await page.screenshot({ path: testInfo.outputPath('switcher-grid-portrait.png') });
    // Select the last item and keep it in view through narrower/shorter resizes.
    for (let index = 0; index < 7; index++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await layout()).selectionVisible).toBe(true);
    for (const [width, height] of [[300, 600], [640, 360], [1200, 800]] as const) {
      await resize(width, height);
      await expect.poll(async () => (await layout()).selectionVisible).toBe(true);
    }
    await page.keyboard.press('Escape'); await page.keyboard.up(modifier);
    await expect(dialog).toHaveCount(0);
    await assertControlbarVisible();
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
