import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const run = promisify(execFile);
const require = createRequire(import.meta.url);
interface NativeItem {
  id: string; hidden: boolean; focused: boolean; alpha: number; x: number; y: number; width: number; height: number;
  label: string; appearance: string; material: number | null; radius: number | null; selected: boolean;
}
interface NativeSnapshot { windowNumber: number; items: NativeItem[] }

test('macOS playlist switcher draws on Clear Liquid Glass while the page keeps the gesture', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin' || Number(os.release().split('.')[0]) < 25, 'Requires macOS 26');
  test.setTimeout(120_000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-switcher-glass-')));
  const home = path.join(root, 'home');
  const userData = path.join(root, 'data');
  await mkdir(path.join(home, '.la'), { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(home, '.la/settings.json'), JSON.stringify({ 'app-language': 'en', la_qq_music_enabled: 'true' }));
  // Seven online playlists appear once the test signs in to this fixture plugin.
  const plugin = path.join(home, '.la/plugin/netease');
  await mkdir(plugin, { recursive: true });
  await writeFile(path.join(plugin, 'manifest.json'), JSON.stringify({ id: 'netease', name: 'NetEase fixture', version: '1.0.0', apiVersion: 1, main: 'index.cjs', requiresCookie: true, capabilities: ['search'] }));
  await writeFile(path.join(plugin, 'index.cjs'), `exports.createPlugin = () => ({
    provider: { id: 'netease', searchMusic: async () => [], getRecommendedSongs: async () => [],
      getMusicUrl: async () => null, getLyrics: async () => null, getPlaylistSongs: async () => [],
      getPlaylists: async () => Array.from({ length: 7 }, (_, index) => ({
        id: String(index + 1), name: 'Journey ' + (index + 1), songCount: 10, source: 'netease',
        coverUrl: 'app://localhost/default-cover.jpg',
      })), requiresCookie: () => true },
    invoke: async () => ({ success: false }), validateCookie: async () => ({ valid: true }), streamHeaders: () => ({})
  });`);
  const audio = Buffer.alloc(44 + 8000 * 2 * 120);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  const songs = ['Amber', 'Blue', 'Coral'].map((title, index) => ({
    id: `switcher-glass-${index}`, title, artist: 'Test Artist', album: 'Playlist switcher',
    duration: 120, source: 'local', available: true, filePath: path.join(root, `${index}.wav`),
  }));
  for (const song of songs) await writeFile(song.filePath, audio);
  await writeFile(path.join(userData, 'library-index.json'), JSON.stringify({ songs, settings: {
    activeSlotId: 'local', localSlot: { currentTrackIndex: 0, currentTime: 12, volume: .4,
      playbackMode: 'order', scrollPosition: 0, filterType: 'default', categorySelection: null },
  } }));
  const probePath = path.join(root, 'probe.node');
  const version = require('electron/package.json').version as string;
  await run('clang++', ['-std=c++17', '-fobjc-arc', '-shared', '-undefined', 'dynamic_lookup',
    '-I', path.join(os.homedir(), '.electron-gyp', version, 'include/node'), '-framework', 'AppKit',
    path.join(repo, 'test/native/focusGlassProbe.mm'), '-o', probePath]);
  const env = Object.fromEntries(Object.entries({ ...process.env,
    HOME: home, USERPROFILE: home, APPDATA: path.join(root, 'app-data'), LOCALAPPDATA: path.join(root, 'local-app-data'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'xdg-data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE']; delete env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'];
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ cwd: root, args: [`--user-data-dir=${userData}`, repo], env });
    const page = await app.firstWindow();
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
    const before = await audioState();

    const probe = async (action?: string): Promise<NativeSnapshot> => JSON.parse(await app!.evaluate(({ BrowserWindow }, args) => {
      const { createRequire } = process.getBuiltinModule('module');
      const native = createRequire(args.file)(args.file) as { probe: (handle: Buffer, action?: string) => string };
      const handle = BrowserWindow.getAllWindows()[0]!.getNativeWindowHandle();
      return args.action ? native.probe(handle, args.action) : native.probe(handle);
    }, { file: probePath, action }));
    const find = (snapshot: NativeSnapshot, id: string) => snapshot.items.find(item => item.id === id);
    const cards = (snapshot: NativeSnapshot) => snapshot.items.filter(item => item.id.startsWith('playlist-switcher-item-'));
    const names = async () => cards(await probe()).map(card => card.label.split(',')[0]);
    const selectedName = async () => cards(await probe()).filter(card => card.selected).map(card => card.label.split(',')[0]).join('|');
    const shown = async () => {
      const glass = find(await probe(), 'playlist-switcher-glass');
      return !!glass && !glass.hidden && glass.alpha > .99;
    };
    const backdrop = page.locator('.playlist-switcher-backdrop');
    const modifier = 'Meta';
    const begin = async () => { await page.keyboard.down(modifier); await page.keyboard.press('Backquote'); };
    const controlbar = page.getByTestId('main-controlbar');
    await expect(controlbar).toHaveAttribute('data-native-controlbar', 'true');

    // AppKit draws the panel; the page keeps only the dimming, focus-holding backdrop.
    await begin();
    await expect(backdrop).toHaveAttribute('data-native-switcher', 'true');
    // Not toBeFocused(): that also requires the test window to be frontmost.
    expect(await backdrop.evaluate(node => document.activeElement === node)).toBe(true);
    await expect(page.getByTestId('playlist-switcher')).toHaveCount(0);
    await expect.poll(shown).toBe(true);
    let snapshot = await probe();
    const glass = find(snapshot, 'playlist-switcher-glass')!;
    expect(glass.material).toBe(1); // NSGlassEffectViewStyleClear; the command palette is Regular (0).
    expect(glass.radius).toBe(28);
    expect(glass.label).toBe('Switch playlists');
    expect(cards(snapshot).map(card => card.label)).toEqual(['Local, 3 tracks', 'Online History, 0 tracks']);
    expect(find(snapshot, 'playlist-switcher-hint')!.label).toBe('Release Cmd to confirm · Shift reverses · Esc cancels');
    // The page still owns the keyboard, so the web view stays first responder.
    expect(snapshot.items.some(item => item.id.startsWith('playlist-switcher') && item.focused)).toBe(false);
    await expect.poll(selectedName).toBe('Online History');

    // The floating playback bar stays visible, and the panel never covers it.
    const clearOfControlbar = async () => {
      const current = await probe();
      const bar = find(current, 'player-controlbar-glass'); const panel = find(current, 'playlist-switcher-glass');
      const window = find(current, 'playlist-switcher-host');
      if (!bar || !panel || !window || bar.hidden || bar.alpha < .99) return false;
      const apart = panel.y >= bar.y + bar.height || panel.y + panel.height <= bar.y;
      return apart && panel.x >= 0 && panel.x + panel.width <= window.width && panel.y >= 0 && panel.y + panel.height <= window.height;
    };
    await expect.poll(clearOfControlbar).toBe(true);

    await page.keyboard.press('Backquote'); await expect.poll(selectedName).toBe('Local');
    await page.keyboard.press('Shift+Backquote'); await expect.poll(selectedName).toBe('Online History');
    await page.keyboard.press('Space'); expect(await audioState()).toEqual(before);
    if (process.env['FOCUS_GLASS_SCREENSHOTS'] === '1') {
      const screenshot = testInfo.outputPath('switcher-native-glass.png');
      await run('screencapture', ['-x', '-l', String(snapshot.windowNumber), screenshot]);
      await testInfo.attach('switcher-native-glass', { path: screenshot, contentType: 'image/png' });
    }
    // Releasing the modifier commits once and removes both layers.
    await page.keyboard.up(modifier);
    await expect(backdrop).toHaveCount(0); await expect(tiles).toHaveCount(0);
    await expect.poll(async () => find(await probe(), 'playlist-switcher-glass')?.hidden).toBe(true);
    expect(await audioState()).toEqual(before);

    // Escape and a click on the backdrop cancel without navigating.
    await begin(); await expect.poll(shown).toBe(true); await expect.poll(selectedName).toBe('Local');
    await page.keyboard.press('Escape'); await page.keyboard.up(modifier);
    await expect(backdrop).toHaveCount(0); await expect(tiles).toHaveCount(0);
    await begin(); await expect.poll(shown).toBe(true);
    await backdrop.click({ position: { x: 10, y: 10 } }); await page.keyboard.up(modifier);
    await expect(backdrop).toHaveCount(0); await expect(tiles).toHaveCount(0);
    await expect.poll(async () => find(await probe(), 'playlist-switcher-glass')?.hidden).toBe(true);

    // A real AppKit click on a card opens that list, whatever the keyboard had selected.
    await begin(); await expect.poll(shown).toBe(true);
    await page.keyboard.press('Backquote'); await expect.poll(selectedName).toBe('Online History');
    const localCard = cards(await probe()).find(card => card.label.startsWith('Local'))!;
    await probe(`${localCard.id}:click`);
    await expect(tiles).toHaveCount(3); await expect(backdrop).toHaveCount(0);
    await page.keyboard.up(modifier);
    await expect(tiles).toHaveCount(3); expect(await audioState()).toEqual(before);

    // Pointer movement over a card previews it; releasing the modifier then opens it.
    await begin(); await expect.poll(selectedName).toBe('Online History');
    const hovered = cards(await probe()).find(card => card.label.startsWith('Local'))!;
    await probe(`${hovered.id}:hover`);
    await expect.poll(selectedName).toBe('Local');
    await page.keyboard.up(modifier);
    await expect(backdrop).toHaveCount(0); await expect(tiles).toHaveCount(3);

    // Sign in so nine cards wrap, shrink and scroll with the window.
    await page.evaluate(async () => {
      const api = (window as typeof window & { electron: { settingsSet: (key: string, value: string) => Promise<void> } }).electron;
      await api.settingsSet('netease_cookie', 'MUSIC_U=switcher-glass-fixture;');
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-startup', 'ready');
    await expect(controlbar).toHaveAttribute('data-native-controlbar', 'true');
    await expect.poll(async () => {
      await begin();
      // The reloaded page starts its own native surface before it can open.
      const count = await backdrop.getAttribute('data-native-switcher').catch(() => null) === 'true' ? (await names()).length : 0;
      await page.keyboard.press('Escape'); await page.keyboard.up(modifier);
      return count;
    }).toBe(9);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setMinimumSize(300, 360));
    await begin(); await expect.poll(shown).toBe(true);
    expect(await names()).toEqual(['Local', 'Online History', ...Array.from({ length: 7 }, (_, index) => `Journey ${index + 1}`)]);
    const layout = async () => {
      const current = await probe();
      const list = find(current, 'playlist-switcher-list')!; const panel = find(current, 'playlist-switcher-glass')!;
      const scroller = current.items.filter(item => item.id.startsWith('playlist-switcher-item-'));
      const active = scroller.find(card => card.selected);
      return {
        width: panel.width, card: scroller[0]!.width,
        rows: new Set(scroller.map(card => Math.round(card.y))).size,
        // The grid is the scroll document; the panel frame bounds what is actually visible.
        selectionVisible: !!active && active.y >= panel.y - 1 && active.y + active.height <= panel.y + panel.height + 1,
        contentHeight: list.height,
      };
    };
    const resize = async (width: number, height: number) => {
      await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height), { width, height });
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      await expect.poll(clearOfControlbar).toBe(true);
    };
    await resize(1200, 800);
    const wide = await layout();
    expect(wide.rows).toBe(2);
    if (process.env['FOCUS_GLASS_SCREENSHOTS'] === '1') {
      const screenshot = testInfo.outputPath('switcher-native-glass-grid.png');
      await run('screencapture', ['-x', '-l', String((await probe()).windowNumber), screenshot]);
      await testInfo.attach('switcher-native-glass-grid', { path: screenshot, contentType: 'image/png' });
    }
    await resize(640, 700);
    const medium = await layout();
    expect(medium.width).toBeLessThan(wide.width);
    expect(medium.rows).toBe(2);
    await resize(393, 851);
    const portrait = await layout();
    expect(portrait.width).toBeLessThan(medium.width);
    expect(portrait.rows).toBe(3);
    // Select the last card and keep it in view through shorter and narrower windows.
    for (let index = 0; index < 7; index++) await page.keyboard.press('ArrowRight');
    await expect.poll(selectedName).toBe('Journey 7');
    for (const [width, height] of [[300, 600], [640, 360], [1200, 800]] as const) {
      await resize(width, height);
      await expect.poll(async () => (await layout()).selectionVisible).toBe(true);
    }
    await page.keyboard.press('Escape'); await page.keyboard.up(modifier);
    await expect(backdrop).toHaveCount(0);
    await expect.poll(async () => find(await probe(), 'playlist-switcher-glass')?.hidden).toBe(true);
    await expect.poll(async () => { const bar = find(await probe(), 'player-controlbar-glass'); return !!bar && !bar.hidden && bar.alpha > .99; }).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
