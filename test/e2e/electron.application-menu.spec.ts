import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('macOS menus import music, perform app actions and follow live language and shortcut settings', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'Native macOS application menu');
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-application-menu-')));
  const home = path.join(root, 'home'); const data = path.join(root, 'data');
  await mkdir(path.join(home, '.la'), { recursive: true }); await mkdir(data);
  await writeFile(path.join(home, '.la/settings.json'), JSON.stringify({
    'app-language': 'zh',
    'app-shortcuts': JSON.stringify({ importMusic: { defaultKey: 'CmdOrCtrl+O', currentKey: 'CmdOrCtrl+O' } }),
  }));
  await writeFile(path.join(data, 'library-index.json'), JSON.stringify({ songs: [], settings: { activeSlotId: 'local' } }));
  const env = Object.fromEntries(Object.entries({ ...process.env,
    HOME: home, USERPROFILE: home, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'local'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'xdg-data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE'];
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ cwd: root, args: [`--user-data-dir=${data}`, repo], env });
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('html')).toHaveAttribute('data-startup', 'ready');
    const menuLabels = () => app!.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.slice(1).map(item => item.label));
    const choose = (id: string) => app!.evaluate(({ Menu, BrowserWindow }, action) => {
      Menu.getApplicationMenu()!.getMenuItemById(action)!.click({}, BrowserWindow.getAllWindows()[0]);
    }, id);
    const label = (id: string) => app!.evaluate(({ Menu }, action) => Menu.getApplicationMenu()!.getMenuItemById(action)!.label, id);
    expect(await menuLabels()).toEqual(['文件', '编辑', '视图', '窗口']);
    expect(await label('menu-importMusic')).toContain('⌘I');
    // Mock only the native picker; the menu still traverses preload and the real import owner.
    await app.evaluate(({ dialog }) => {
      Object.assign(globalThis, { menuPickerCalls: 0 });
      dialog.showOpenDialog = (async () => {
        (globalThis as typeof globalThis & { menuPickerCalls: number }).menuPickerCalls++;
        return { canceled: true, filePaths: [] };
      }) as typeof dialog.showOpenDialog;
    });
    const pickerCalls = () => app!.evaluate(() => (globalThis as typeof globalThis & { menuPickerCalls: number }).menuPickerCalls);
    await choose('menu-importMusic'); await expect.poll(pickerCalls).toBe(1);
    await page.keyboard.press('Meta+I'); await expect.poll(pickerCalls).toBe(2);
    await choose('menu-focusSearch'); await expect(page.locator('.command-palette-backdrop')).toBeVisible();
    await expect(page.locator('.command-palette__input')).toBeVisible();
    await page.keyboard.press('Escape');
    await choose('menu-toggleCommandPalette'); await expect(page.locator('.command-palette-backdrop')).toBeVisible();
    await choose('menu-toggleCommandPalette'); await expect(page.locator('.command-palette-backdrop')).toHaveCount(0);
    await choose('menu-cyclePlaylists'); await expect(page.getByTestId('playlist-switcher')).toBeVisible();
    await expect(page.getByRole('option', { selected: true })).toHaveAccessibleName('在线播放记录');
    await page.keyboard.press('Escape'); await expect(page.getByTestId('playlist-switcher')).toHaveCount(0);
    // Native menu hints must not intercept the held MRU gesture.
    await page.keyboard.down('Control'); await page.keyboard.press('Backquote');
    await expect(page.getByTestId('playlist-switcher')).toBeVisible();
    await page.keyboard.up('Control'); await expect(page.getByTestId('playlist-switcher')).toHaveCount(0);
    await page.keyboard.down('Control'); await page.keyboard.press('Backquote');
    await expect(page.getByRole('option', { selected: true })).toHaveAccessibleName('本地');
    await page.keyboard.up('Control');
    await choose('menu-showShortcuts');
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await expect(settings.getByRole('tabpanel', { name: '快捷键', exact: true })).toBeVisible();
    const row = settings.getByText('进入/退出专注模式', { exact: true }).locator('..');
    await row.getByRole('button', { name: 'Cmd/Ctrl+Enter', exact: true }).click();
    await settings.locator('[data-shortcut-recorder]').press('Meta+Shift+L');
    await expect.poll(() => label('menu-toggleFocusMode')).toContain('⌘⇧L');
    await page.keyboard.press('Escape');
    await choose('menu-gotoSettings');
    await page.getByLabel('语言', { exact: true }).selectOption('en');
    await expect.poll(menuLabels).toEqual(['File', 'Edit', 'View', 'Window']);
    expect(await label('window-preset-portrait')).toBe('Portrait');
    expect(await label('menu-importMusic')).toContain('Import Music');
    await page.getByLabel('Language', { exact: true }).selectOption('ja');
    await expect.poll(menuLabels).toEqual(['ファイル', '編集', '表示', 'ウインドウ']);
    await page.getByLabel('言語', { exact: true }).selectOption('zh');
    await expect.poll(menuLabels).toEqual(['文件', '编辑', '视图', '窗口']);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+Shift+L');
    const focus = page.locator('.focus-mode-overlay'); await expect(focus).toBeVisible();
    await choose('menu-toggleFocusMode'); await expect(focus).toHaveCount(0);
    // Rebuilding menus must preserve standard text editing.
    await choose('menu-focusSearch');
    const input = page.locator('.command-palette__input'); await input.fill('hello');
    await page.keyboard.press('Meta+A'); await page.keyboard.type('replacement');
    await expect(input).toHaveValue('replacement');
    await page.screenshot({ path: testInfo.outputPath('menu-search.png') });
    expect(errors).toEqual([]);
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
});
