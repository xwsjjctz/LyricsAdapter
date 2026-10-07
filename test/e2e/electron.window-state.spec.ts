import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('restores custom window sizes across exits and applies macOS menu presets without interrupting playback', async ({}, testInfo) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-window-state-')));
  const home = path.join(root, 'home'); const data = path.join(root, 'data');
  await mkdir(path.join(home, '.la'), { recursive: true }); await mkdir(data);
  await writeFile(path.join(home, '.la/settings.json'), JSON.stringify({ 'app-language': 'zh' }));
  const audio = Buffer.alloc(44 + 8000 * 2 * 120);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  const songPath = path.join(root, 'window.wav'); await writeFile(songPath, audio);
  await writeFile(path.join(data, 'library-index.json'), JSON.stringify({ songs: [{
    id: 'window-song', title: 'Window state', artist: 'Test Artist', album: '', duration: 120,
    source: 'local', available: true, filePath: songPath,
    syncedLyrics: [{ time: 0, text: 'A quiet moment' }, { time: 60, text: 'Another journey' }],
  }], settings: { activeSlotId: 'local', localSlot: { currentTrackIndex: 0, currentTime: 12,
    volume: .4, playbackMode: 'order', scrollPosition: 0, filterType: 'default', categorySelection: null } } }));
  const env = Object.fromEntries(Object.entries({ ...process.env,
    HOME: home, USERPROFILE: home, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'local'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'xdg-data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE'];
  let app: ElectronApplication | undefined;
  const launch = async () => {
    app = await electron.launch({ cwd: root, args: [
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${data}`, repo,
    ], env });
    const page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-startup', 'ready');
    return page;
  };
  const size = () => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getSize());
  const fitted = (width: number, height: number) => app!.evaluate(({ screen }, requested) => {
    const area = screen.getPrimaryDisplay().workAreaSize;
    return [Math.min(requested.width, area.width), Math.min(requested.height, area.height)];
  }, { width, height });
  try {
    let page = await launch();
    expect(await size()).toEqual(await fitted(1200, 800));
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(734, 812));
    await expect.poll(size).toEqual([734, 812]);
    // Exit within the debounce interval: the native close handler must flush.
    await app!.close(); app = undefined;
    page = await launch(); expect(await size()).toEqual(await fitted(734, 812));
    await expect.poll(() => page.locator('audio').evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(2);
    if (!(await page.locator('audio').evaluate((node: HTMLAudioElement) => node.paused))) await page.keyboard.press('Space');
    const audioState = () => page.locator('audio').evaluate((node: HTMLAudioElement) => ({
      time: node.currentTime, volume: node.volume, paused: node.paused, src: node.currentSrc,
    }));
    const before = await audioState();
    if (process.platform === 'darwin') {
      const menu = await app!.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(item => ({
        label: item.label, role: item.role, children: item.submenu?.items.map(child => ({ id: child.id, label: child.label, role: child.role })),
      })));
      expect(menu.filter(item => item.label === '窗口')).toHaveLength(1);
      const options = menu.find(item => item.label === '窗口')!.children!;
      expect(options.slice(0, 2).map(item => item.label)).toEqual(['横屏', '竖屏']);
      expect(options.some(item => item.role === 'minimize')).toBe(true);
      expect(menu.some(item => item.role?.toLowerCase() === 'editmenu')).toBe(true);
      const choose = (preset: string) => app!.evaluate(({ Menu, BrowserWindow }, mode) => {
        Menu.getApplicationMenu()!.getMenuItemById(`window-preset-${mode}`)!.click({}, BrowserWindow.getAllWindows()[0]);
      }, preset);
      await page.keyboard.press('ControlOrMeta+Enter');
      const focus = page.locator('.focus-mode-overlay');
      await expect.poll(async () => Math.abs((await focus.boundingBox())!.y)).toBeLessThan(.5);
      await expect(focus.locator('.focus-mode-content')).toHaveCSS('opacity', '1');
      await choose('landscape'); await expect.poll(size).toEqual(await fitted(1200, 800));
      await expect(focus).toHaveAttribute('data-focus-layout', 'landscape');
      await page.getByTestId('focus-web-controls').hover();
      await expect(page.getByTestId('focus-web-controls')).toHaveCSS('opacity', '1');
      expect(await audioState()).toEqual(before);
      await page.screenshot({ path: testInfo.outputPath('window-landscape.png') });
      await choose('portrait'); await expect.poll(size).toEqual(await fitted(385, 800));
      await expect(focus).toHaveAttribute('data-focus-layout', 'portrait');
      await page.getByTestId('focus-portrait-controls').hover();
      expect(await audioState()).toEqual(before);
      await page.screenshot({ path: testInfo.outputPath('window-portrait.png') });
      // Native zoom and fullscreen finish asynchronously on macOS.
      await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.maximize());
      await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized())).toBe(true);
      await choose('portrait'); await expect.poll(size).toEqual(await fitted(385, 800));
      await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setFullScreen(true));
      await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(true);
      await choose('landscape'); await choose('portrait');
      await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(false);
      await expect.poll(size).toEqual(await fitted(385, 800));
      expect(await audioState()).toEqual(before);
    } else {
      await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(385, 800));
    }
    await app!.close(); app = undefined;
    page = await launch(); expect(await size()).toEqual(await fitted(385, 800));
    // Corrupted imported state cannot prevent launch or create an invisible window.
    await page.evaluate(async () => {
      await (window as typeof window & { electron: { settingsSet: (key: string, value: string) => Promise<void> } }).electron.settingsSet('la_window_state', 'broken');
    });
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.destroy());
    await app!.close().catch(() => {}); app = undefined;
    page = await launch(); expect(await size()).toEqual(await fitted(1200, 800));
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
});
