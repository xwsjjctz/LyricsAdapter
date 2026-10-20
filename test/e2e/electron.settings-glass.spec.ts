import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const run = promisify(execFile);
const require = createRequire(import.meta.url);

interface NativeItem {
  id: string; class: string; hidden: boolean; x: number; y: number; width: number; height: number;
  label: string; appearance: string; material: number | null; radius: number | null; selected: boolean;
}

test('macOS settings are an AppKit sheet on the palette Liquid Glass that edits settings, follows the window and dismisses', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin' || Number(os.release().split('.')[0]) < 25, 'Requires macOS 26');
  test.setTimeout(90000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-settings-glass-')));
  const home = path.join(root, 'home'); const data = path.join(root, 'data');
  await mkdir(path.join(home, '.la'), { recursive: true }); await mkdir(data);
  await writeFile(path.join(home, '.la/settings.json'), JSON.stringify({ 'app-language': 'en' }));
  await writeFile(path.join(data, 'library-index.json'), JSON.stringify({ songs: [], settings: { activeSlotId: 'local' } }));
  const probePath = path.join(root, 'probe.node');
  const version = require('electron/package.json').version as string;
  await run('clang++', ['-std=c++17', '-fobjc-arc', '-shared', '-undefined', 'dynamic_lookup',
    '-I', path.join(os.homedir(), '.electron-gyp', version, 'include/node'), '-framework', 'AppKit',
    path.join(repo, 'test/native/focusGlassProbe.mm'), '-o', probePath]);
  const env = Object.fromEntries(Object.entries({ ...process.env,
    HOME: home, USERPROFILE: home, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'local'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'xdg-data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE']; delete env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'];
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ cwd: root, args: [`--user-data-dir=${data}`, repo], env });
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('html')).toHaveAttribute('data-startup', 'ready');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.getParentWindow())!.setSize(1200, 800));
    const choose = (id: string) => app!.evaluate(({ Menu, BrowserWindow }, action) => {
      const parent = BrowserWindow.getAllWindows().find(win => !win.getParentWindow())!;
      Menu.getApplicationMenu()!.getMenuItemById(action)!.click({}, parent);
    }, id);
    // Without an id it reports the views; with one it activates that control (a value sets a slider or picks a menu item).
    const probe = async (id?: string, value?: number): Promise<{ windowNumber: number; items: NativeItem[] }> =>
      JSON.parse(await app!.evaluate(({ BrowserWindow }, args) => {
        const { createRequire } = process.getBuiltinModule('module');
        const native = createRequire(args.file)(args.file) as { probe: (handle: Buffer, id?: string, value?: number) => string };
        const handle = BrowserWindow.getAllWindows().find(w => !w.getParentWindow())!.getNativeWindowHandle();
        return args.id ? (args.value === undefined ? native.probe(handle, args.id) : native.probe(handle, args.id, args.value)) : native.probe(handle);
      }, { file: probePath, id, value }));
    const item = async (id: string) => (await probe()).items.find(entry => entry.id === id);
    const sheetVisible = async () => (await item('native-settings-glass'))?.hidden === false;
    const selected = async (section: string) => (await item(`native-settings-nav-${section}`))?.selected;
    const windowCount = () => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const setting = (key: string) => page.evaluate(async name => {
      const result = await (window as unknown as { electron: { ipc: { settings: { getAll: () => Promise<{ ok: boolean; data?: Record<string, string> }> } } } }).electron.ipc.settings.getAll();
      return result.data?.[name];
    }, key);

    // The sheet is built hidden once startup settles, inside the player window: no second renderer.
    await expect.poll(async () => (await item('native-settings-glass'))?.hidden, { timeout: 15000 }).toBe(true);
    expect(await windowCount()).toBe(1);

    await choose('menu-toggleCommandPalette');
    await expect(page.locator('.command-palette-backdrop')).toBeVisible();
    await expect.poll(async () => (await item('native-palette-glass'))?.material).toBe(0);
    const palette = (await item('native-palette-glass'))!;
    await choose('menu-toggleCommandPalette');
    await choose('menu-gotoSettings');
    await expect.poll(sheetVisible).toBe(true);
    // AppKit draws the sheet; the page only dims the wall behind it.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.locator('.settings-sheet-backdrop').evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
    expect(await page.locator('.settings-sheet-backdrop').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0.18)');
    const glass = (await item('native-settings-glass'))!;
    expect(glass.class).toBe('NSGlassEffectView');
    expect(glass.material).toBe(palette.material); expect(glass.radius).toBe(palette.radius);
    expect(glass.appearance).toBe(palette.appearance);
    await expect.poll(() => selected('general')).toBe(true);
    const screenshot = testInfo.outputPath('settings-native-glass.png');
    await run('screencapture', ['-x', '-l', String((await probe()).windowNumber), screenshot]);
    await testInfo.attach('settings-native-glass', { path: screenshot, contentType: 'image/png' });

    // The first language in the menu is 中文; the sheet and the welcome page follow it.
    await probe('native-settings-general:language', 0);
    await expect.poll(async () => (await item('native-settings-nav-general'))?.label).toBe('通用');
    await expect.poll(async () => (await item('native-settings-close'))?.label).toBe('关闭');
    await expect(page.getByText('从你的音乐开始', { exact: true })).toBeVisible();
    // A preference edited in the sheet applies to the player immediately.
    await probe('native-settings-nav-focus');
    await expect.poll(() => selected('focus')).toBe(true);
    await probe('native-settings-focus:font-size', 36);
    await expect.poll(() => setting('la_focus_lyrics_font_size')).toBe('36');

    // Placed like the palette: 640 wide, 14% from the top, at most 560 tall or 72% of the window.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.getParentWindow())!.setSize(900, 650));
    const frame = async () => {
      const { items } = await probe();
      const host = items.find(entry => entry.id === 'native-settings-host')!;
      const panel = items.find(entry => entry.id === 'native-settings-glass')!;
      return { host, panel, left: panel.x - host.x, top: host.y + host.height - panel.y - panel.height };
    };
    await expect.poll(async () => (await frame()).host.width).toBe(900);
    const resized = await frame();
    expect(resized.panel.width).toBe(640); expect(resized.left).toBe(130);
    expect(resized.top).toBe(Math.floor(resized.host.height * 0.14));
    expect(resized.panel.height).toBe(Math.min(560, Math.floor(resized.host.height * 0.72)));

    await probe('@key:53');
    await expect.poll(sheetVisible).toBe(false);
    await expect(page.locator('.settings-sheet-backdrop')).toHaveCount(0);
    // Reopening starts at the requested section and can close from either surface.
    await choose('menu-showShortcuts');
    await expect.poll(sheetVisible).toBe(true);
    await expect.poll(() => selected('shortcuts')).toBe(true);
    await probe('native-settings-close');
    await expect.poll(sheetVisible).toBe(false);
    await choose('menu-gotoSettings');
    await expect.poll(sheetVisible).toBe(true);
    await expect.poll(() => selected('general')).toBe(true);
    await page.locator('.settings-sheet-backdrop').click({ position: { x: 10, y: 10 } });
    await expect.poll(sheetVisible).toBe(false);
    // A section requested while the sheet is open scrolls to it.
    await choose('menu-gotoSettings');
    await expect.poll(sheetVisible).toBe(true);
    await choose('menu-showShortcuts');
    await expect.poll(() => selected('shortcuts')).toBe(true);
    expect(await sheetVisible()).toBe(true);
    // Cmd+K reaches the player from the sheet, which gives way to the palette.
    await probe('@key:40:1');
    await expect.poll(sheetVisible).toBe(false);
    await expect(page.locator('.command-palette-backdrop')).toBeVisible();
    await choose('menu-toggleCommandPalette');
    expect(await windowCount()).toBe(1);
    expect(errors).toEqual([]);
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
});
