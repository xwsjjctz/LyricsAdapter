import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { MusicPluginInfo } from '../../src/shared/musicPlugin';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
interface PluginAPI {
  musicPluginCatalog(): Promise<{ id: string; version?: string }[]>;
  musicPluginDirectory(): Promise<string>;
  musicPluginList(): Promise<MusicPluginInfo[]>;
  musicPluginCall(id: string, method: string, args: unknown[]): Promise<unknown>;
  musicPluginSetEnabled(id: string, enabled: boolean): Promise<MusicPluginInfo[]>;
  musicPluginInstall(): Promise<MusicPluginInfo[] | null>;
  musicPluginUninstall(id: string): Promise<MusicPluginInfo[]>;
  downloadAndSave(url: string, cookie: string, filePath: string): Promise<{ success: boolean }>;
}

test('music plugins work through real IPC, stream and download; local updates and disablement survive restart', async ({}, testInfo) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-music-plugins-')));
  const isolatedHome = path.join(root, 'home');
  const userData = path.join(root, 'user-data');
  await mkdir(path.join(isolatedHome, '.la'), { recursive: true });
  await mkdir(userData);
  await writeFile(path.join(isolatedHome, '.la/settings.json'), JSON.stringify({ 'app-language': 'en', la_qq_music_enabled: 'true', la_online_source: 'netease' }));
  const env = Object.fromEntries(Object.entries({ ...process.env,
    HOME: isolatedHome, USERPROFILE: isolatedHome, APPDATA: path.join(root, 'app-data'),
    LOCALAPPDATA: path.join(root, 'local-app-data'), XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE'];
  const executable = process.env['LYRICS_ADAPTER_E2E_EXECUTABLE'];
  const launch = () => electron.launch({ cwd: root, ...(executable ? { executablePath: executable } : {}), args: [
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userData}`, ...(executable ? [] : [repo]),
  ], env });
  let app: ElectronApplication | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.waitForFunction(() => Boolean((window as unknown as { electron?: PluginAPI }).electron?.musicPluginList));
    await app.evaluate(() => {
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.startsWith('https://cdn.music.invalid/')) return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: new Headers(init?.headers).has('Range') ? 206 : 200,
          headers: { 'Content-Type': 'audio/flac', 'Content-Length': '4', 'Content-Range': 'bytes 0-3/4' },
        });
        const song = { id: 42, name: 'Plugin song', ar: [{ name: 'Artist' }], al: { id: 1, name: 'Album', picUrl: 'https://cdn.music.invalid/cover' }, dt: 180000 };
        const payload = url.includes('/weapi/search/get') ? { result: { songs: [song] } }
          : url.includes('/weapi/v3/song/detail') ? { songs: [song] }
          : url.includes('/weapi/song/enhance/player/url/v1') ? { data: [{ url: 'https://cdn.music.invalid/audio.flac', type: 'flac', br: 900000 }] }
          : url.includes('/weapi/song/lyric') ? { lrc: { lyric: '[00:01]Plugin lyric' }, yrc: { lyric: '[1000,1000](0,1000,0)Plugin' } }
          : url.includes('/api/login/qrcode/unikey') ? { unikey: 'test-key' } : { code: 801 };
        return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
      };
    });
    expect(await page.evaluate(() => (window as unknown as { electron: PluginAPI }).electron.musicPluginList())).toEqual([]);
    const entry = (id: string) => `exports.createPlugin = () => ({
      provider: { id: '${id}', searchMusic: async () => [{ songmid: '42', songname: 'Plugin song', singer: [{ name: 'Artist' }], interval: 180 }],
        getRecommendedSongs: async () => [], getMusicUrl: async () => ({ url: 'https://cdn.music.invalid/audio.flac', quality: 'flac' }),
        getLyrics: async () => ({ lyrics: '[00:01]Plugin lyric', wordLyricsFormat: 'yrc' }), getPlaylists: async () => [], getPlaylistSongs: async () => [], requiresCookie: () => false },
      invoke: async () => ({ success: false }), validateCookie: async () => ({ valid: true }), streamHeaders: () => ({})
    });`;
    const packageFor = (id: string) => { const code = entry(id); return JSON.stringify({ manifest: { id, name: id === 'qq' ? 'QQ 音乐' : '网易云音乐', version: '0.1.0', apiVersion: 1, main: 'index.cjs', requiresCookie: false, capabilities: ['search', 'stream'] }, code, sha256: createHash('sha256').update(code).digest('hex') }); };
    const neteasePackage = packageFor('netease');
    const digest = createHash('sha256').update(neteasePackage).digest('hex');
    await app.evaluate(({ net }, data) => {
      const directory = 'https://raw.githubusercontent.com/xwsjjctz/LyricsAdapter-Music-Plugins/main/packages/';
      net.fetch = async input => {
        if (String(input) === `${directory}catalog.json`) return new Response(JSON.stringify({ apiVersion: 1, plugins: [{ id: 'netease', version: '0.1.0', file: 'netease.laplugin', sha256: data.digest }] }));
        if (String(input) === `${directory}netease.laplugin`) return new Response(data.package);
        throw new Error(`Unexpected plugin download: ${input}`);
      };
    }, { package: neteasePackage, digest });
    await expect(page.locator('.poster-wall')).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
    await page.keyboard.press('ControlOrMeta+K');
    const palette = page.locator('.command-palette__input');
    await palette.click(); await expect(palette).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await palette.fill('settings'); await page.keyboard.press('Enter');
    await expect(page.locator('.settings-sheet')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Online Music' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Plugins' }).click();
    await expect(page.getByTestId('plugin-directory')).toHaveText(path.join(isolatedHome, '.la/plugin'));
    await page.screenshot({ path: testInfo.outputPath('plugins-empty.png') });
    await page.getByTestId('official-plugin-netease').getByRole('button', { name: 'Download and install' }).click();
    await expect(page.getByRole('tab', { name: 'Online Music' })).toBeVisible();
    const qqFile = path.join(root, 'qq.laplugin'); await writeFile(qqFile, packageFor('qq'));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, qqFile);
    await page.getByRole('button', { name: 'Install local plugin' }).click();
    await expect(page.getByTestId('music-plugin-manager').getByRole('switch', { name: /QQ/ })).toBeVisible();
    const plugins = await page.evaluate(() => (window as unknown as { electron: PluginAPI }).electron.musicPluginList());
    expect(plugins.map(plugin => plugin.id).sort()).toEqual(['netease', 'qq']);
    expect(plugins.every(plugin => plugin.enabled && plugin.origin === 'installed' && !plugin.restartRequired)).toBe(true);
    const songs = await page.evaluate(() => (window as unknown as { electron: PluginAPI }).electron.musicPluginCall('netease', 'searchMusic', ['song', 20]));
    expect(songs).toMatchObject([{ songmid: '42', songname: 'Plugin song', interval: 180 }]);
    const lyrics = await page.evaluate(() => (window as unknown as { electron: PluginAPI }).electron.musicPluginCall('netease', 'getLyrics', ['42']));
    expect(lyrics).toMatchObject({ lyrics: '[00:01]Plugin lyric', wordLyricsFormat: 'yrc' });
    const stream = await page.evaluate(async () => {
      const result = await fetch('stream://netease/42?q=flac', { headers: { Range: 'bytes=0-3' } });
      return { status: result.status, range: result.headers.get('content-range'), data: [...new Uint8Array(await result.arrayBuffer())] };
    });
    expect(stream).toEqual({ status: 206, range: 'bytes 0-3/4', data: [1, 2, 3, 4] });
    const destination = path.join(root, 'download.flac');
    const saved = await page.evaluate(async file => {
      const api = (window as unknown as { electron: PluginAPI }).electron;
      const result = await api.musicPluginCall('netease', 'getMusicUrl', ['42', 'flac']) as { url: string };
      return api.downloadAndSave(result.url, '', file);
    }, destination);
    expect(saved.success).toBe(true);
    expect([...await readFile(destination)]).toEqual([1, 2, 3, 4]);

    const manager = page.getByTestId('music-plugin-manager');
    await expect(manager).toBeVisible();
    const toggle = manager.getByRole('switch', { name: /网易云/ });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'false');
    const disabled = await page.evaluate(async () => {
      try { await (window as unknown as { electron: PluginAPI }).electron.musicPluginCall('netease', 'searchMusic', ['song']); return ''; }
      catch (error) { return String(error); }
    });
    expect(disabled).toContain('disabled');
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: testInfo.outputPath('music-plugins-settings.png') });

    const local = path.join(root, 'local-plugin'); await mkdir(local);
    await writeFile(path.join(local, 'manifest.json'), JSON.stringify({ id: 'netease', name: 'NetEase local', version: '9.0.0', apiVersion: 1, main: 'index.cjs', requiresCookie: false, capabilities: ['search', 'stream'] }));
    await writeFile(path.join(local, 'index.cjs'), `exports.createPlugin = () => ({
      provider: { id: 'netease', searchMusic: async () => [{ songmid: 'local', songname: 'Installed plugin', singer: [] }],
        getRecommendedSongs: async () => [], getMusicUrl: async () => ({ url: 'https://cdn.music.invalid/audio', quality: '320' }),
        getLyrics: async () => null, getPlaylists: async () => [], getPlaylistSongs: async () => [], requiresCookie: () => false },
      invoke: async () => ({ success: false }), validateCookie: async () => ({ valid: true }), streamHeaders: () => ({})
    });`);
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, local);
    const installed = await page.evaluate(() => (window as unknown as { electron: PluginAPI }).electron.musicPluginInstall());
    expect(installed?.find(plugin => plugin.id === 'netease')).toMatchObject({ version: '9.0.0', restartRequired: true });
    await app.close(); app = undefined;
    app = await launch(); page = await app.firstWindow();
    await page.waitForFunction(() => Boolean((window as unknown as { electron?: PluginAPI }).electron?.musicPluginList));
    const overridden = await page.evaluate(() => (window as unknown as { electron: PluginAPI }).electron.musicPluginCall('netease', 'searchMusic', ['song']));
    expect(overridden).toMatchObject([{ songmid: 'local', songname: 'Installed plugin' }]);
    await page.evaluate(() => (window as unknown as { electron: PluginAPI }).electron.musicPluginSetEnabled('qq', false));
    await app.close(); app = undefined;
    app = await launch(); page = await app.firstWindow();
    await page.waitForFunction(() => Boolean((window as unknown as { electron?: PluginAPI }).electron?.musicPluginList));
    const persisted = await page.evaluate(() => (window as unknown as { electron: PluginAPI }).electron.musicPluginList());
    expect(persisted.find(plugin => plugin.id === 'qq')?.enabled).toBe(false);
    expect(persisted.find(plugin => plugin.id === 'netease')).toMatchObject({ origin: 'installed', version: '9.0.0' });
    const uninstalled = await page.evaluate(() => (window as unknown as { electron: PluginAPI }).electron.musicPluginUninstall('netease'));
    expect(uninstalled.find(plugin => plugin.id === 'netease')).toBeUndefined();
    await page.keyboard.press('ControlOrMeta+,');
    await expect(page.getByRole('tab', { name: 'Online Music' })).toHaveCount(0);
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
});
