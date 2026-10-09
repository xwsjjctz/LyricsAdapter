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

test('macOS settings use palette Liquid Glass and preserve settings, placement and dismissal', async ({}, testInfo) => {
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 800));
    const choose = (id: string) => app!.evaluate(({ Menu, BrowserWindow }, action) => {
      const parent = BrowserWindow.getAllWindows().find(win => !win.getParentWindow())!;
      Menu.getApplicationMenu()!.getMenuItemById(action)!.click({}, parent);
    }, id);
    const probe = async (settings = false): Promise<{ windowNumber: number; items: { id: string; class: string; appearance: string; material: number | null; radius: number | null }[] }> =>
      JSON.parse(await app!.evaluate(({ BrowserWindow }, args) => {
        const { createRequire } = process.getBuiltinModule('module');
        const native = createRequire(args.file)(args.file) as { probe: (handle: Buffer) => string };
        const win = BrowserWindow.getAllWindows().find(window => Boolean(window.getParentWindow()) === args.settings)!;
        return native.probe(win.getNativeWindowHandle());
      }, { file: probePath, settings }));
    await choose('menu-toggleCommandPalette');
    await expect(page.locator('.command-palette-backdrop')).toBeVisible();
    await expect.poll(async () => (await probe()).items.find(item => item.id === 'native-palette-glass')?.material).toBe(0);
    const palette = (await probe()).items.find(item => item.id === 'native-palette-glass')!;
    await choose('menu-toggleCommandPalette');
    await choose('menu-gotoSettings');
    await expect.poll(() => app!.windows().some(window => window.url().includes('settings-panel='))).toBe(true);
    let settings = app.windows().find(window => window.url().includes('settings-panel='))!;
    settings.on('pageerror', error => errors.push(error.message));
    await expect(settings.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
    await expect(settings.locator('html')).toHaveAttribute('data-settings-panel', 'native');
    expect(await page.locator('.settings-sheet-backdrop').evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
    expect(await page.locator('.settings-sheet-backdrop').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0.18)');
    const glass = (await probe(true)).items.find(item => item.id === 'settings-sheet-glass')!;
    expect(glass.material).toBe(palette.material); expect(glass.radius).toBe(palette.radius);
    expect(glass.appearance).toBe(palette.appearance);
    expect(await settings.locator('.settings-sheet').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const screenshot = testInfo.outputPath('settings-native-glass.png');
    await run('screencapture', ['-x', '-l', String((await probe(true)).windowNumber), screenshot]);
    await testInfo.attach('settings-native-glass', { path: screenshot, contentType: 'image/png' });
    await settings.getByLabel('Language', { exact: true }).selectOption('zh');
    await expect(settings.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
    await expect(page.getByText('还没有导入曲目', { exact: true })).toBeVisible();
    // A preference edited in the child applies to the player immediately.
    await settings.getByRole('tab', { name: '专注模式', exact: true }).click();
    const slider = settings.getByRole('slider', { name: 'Focus Mode 滚动歌词字号' });
    await slider.fill('36');
    await expect.poll(() => page.evaluate(async () => {
      const settings = await (window as unknown as { electron: { settingsGetAll: () => Promise<Record<string, string>> } }).electron.settingsGetAll();
      return settings['la_focus_lyrics_font_size'];
    })).toBe('36');
    const bounds = () => app!.evaluate(({ BrowserWindow }) => {
      const child = BrowserWindow.getAllWindows().find(win => win.getParentWindow())!;
      return { child: child.getBounds(), parent: child.getParentWindow()!.getContentBounds() };
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => !win.getParentWindow())!.setSize(900, 650));
    await expect.poll(async () => { const { child, parent } = await bounds(); return child.x - parent.x; }).toBe(90);
    const resized = await bounds(); expect(resized.child.y - resized.parent.y).toBe(56);
    expect(resized.child.height).toBeLessThanOrEqual(474);
    await settings.keyboard.press('Escape').catch(error => { if (!settings.isClosed()) throw error; });
    await expect.poll(() => app!.windows().length).toBe(1);
    await expect(page.locator('.settings-sheet-backdrop')).toHaveCount(0);
    // Reopening starts at the requested tab and can close from either surface.
    await choose('menu-showShortcuts');
    await expect.poll(() => app!.windows().length).toBe(2);
    settings = app.windows().find(window => window.url().includes('settings-panel='))!;
    await expect(settings.getByRole('tabpanel', { name: '快捷键', exact: true })).toBeVisible();
    await settings.getByRole('button', { name: '关闭', exact: true }).click().catch(error => { if (!settings.isClosed()) throw error; });
    await expect.poll(() => app!.windows().length).toBe(1);
    await choose('menu-gotoSettings');
    await expect.poll(() => app!.windows().length).toBe(2);
    await page.locator('.settings-sheet-backdrop').click({ position: { x: 10, y: 10 } });
    await expect.poll(() => app!.windows().length).toBe(1);
    await choose('menu-gotoSettings');
    await expect.poll(() => app!.windows().length).toBe(2);
    settings = app.windows().find(window => window.url().includes('settings-panel='))!;
    await expect(settings.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
    await choose('menu-showShortcuts');
    await expect(settings.getByRole('tabpanel', { name: '快捷键', exact: true })).toBeVisible();
    expect(app.windows()).toHaveLength(2);
    await settings.keyboard.press('Meta+K').catch(error => { if (!settings.isClosed()) throw error; });
    await expect.poll(() => app!.windows().length).toBe(1);
    await expect(page.locator('.command-palette-backdrop')).toBeVisible();
    await choose('menu-toggleCommandPalette');
    expect(errors).toEqual([]);
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
});
