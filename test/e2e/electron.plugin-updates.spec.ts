import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { PluginElectronAPI } from '../../src/shared/plugin';
import type { MusicPluginElectronAPI } from '../../src/shared/musicPlugin';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
type Bridge = Required<PluginElectronAPI & MusicPluginElectronAPI>;
test('third-party updates bind a GitHub source, retry corrupt downloads, preserve settings and survive restart through real IPC', async ({}, testInfo) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-update-e2e-')));
  const home = path.join(root, 'home'), userData = path.join(root, 'user-data');
  await mkdir(path.join(home, '.la'), { recursive: true }); await mkdir(userData);
  await writeFile(path.join(home, '.la/settings.json'), JSON.stringify({ 'app-language': 'en' }));
  const manifest = { manifestVersion: 1, id: 'update-translator', name: 'Update translator', version: '1.0.0', main: 'index.cjs', coreApi: '^1.0.0', extensionApis: { 'lyrics.translation': '^1.0.0' },
    contributes: { providers: [{ type: 'lyrics.translation', id: 'default', name: 'Update translator' }], configuration: { prefix: { title: 'Prefix', type: 'string', default: 'Default' } } } };
  const pack = (version: string) => {
    const code = `exports.activate=c=>c.extensions.register('lyrics.translation','default',{translate:async r=>({documentId:r.document.id,documentRevision:r.document.revision,targetLanguage:r.targetLanguage,lines:r.document.lines.map(l=>({lineId:l.id,text:c.configuration.get('prefix')+' ${version}'}))})});`;
    return JSON.stringify({ manifest: { ...manifest, version }, code, sha256: createHash('sha256').update(code).digest('hex') });
  };
  const oldFile = path.join(root, 'old.laplugin'); await writeFile(oldFile, pack('1.0.0'));
  const updated = pack('2.0.0'), packageUrl = 'https://github.com/test/translator/releases/download/v2/update-translator.laplugin';
  const feedUrl = 'https://github.com/test/translator/releases/download/v2/plugins.update.json';
  const feed = JSON.stringify({ schemaVersion: 1, plugins: [{ id: manifest.id, releases: [{ version: '2.0.0', manifest: { ...manifest, version: '2.0.0' }, url: packageUrl,
    sha256: createHash('sha256').update(updated).digest('hex'), notes: 'Adds version two translations.' }] }] });
  const env = Object.fromEntries(Object.entries({ ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'), NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: '1' })
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')); delete env['ELECTRON_RUN_AS_NODE'];
  let app: ElectronApplication | undefined;
  const launch = () => electron.launch({ cwd: root, args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userData}`, repo], env });
  try {
    app = await launch(); const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean((window as unknown as { electron?: Bridge }).electron?.pluginUpdate));
    await app.evaluate(({ BrowserWindow, net }, fixture) => {
      BrowserWindow.getAllWindows()[0]?.focus();
      const state = globalThis as unknown as { failPluginDownload: boolean }; state.failPluginDownload = true;
      const original = net.fetch.bind(net);
      net.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('LyricsAdapter-Music-Plugins')) return new Response(JSON.stringify({ apiVersion: 1, plugins: [] }));
        if (url === 'https://api.github.com/repos/test/translator/releases/latest') return new Response(JSON.stringify({ assets: [{ name: 'plugins.update.json', browser_download_url: fixture.feedUrl }] }));
        if (url === fixture.feedUrl) return new Response(fixture.feed);
        if (url === fixture.packageUrl) return new Response(state.failPluginDownload ? fixture.updated+' ' : fixture.updated);
        return original(input, init);
      };
    }, { feed, feedUrl, updated, packageUrl });
    await expect(page.locator('.poster-wall')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+K'); const palette = page.locator('.command-palette__input'); await palette.click(); await page.keyboard.press('Shift+Tab'); await palette.fill('settings'); await page.keyboard.press('Enter');
    await page.getByRole('tab', { name: 'Plugins' }).click();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, oldFile);
    await page.getByRole('button', { name: 'Install local plugin' }).click();
    const row = page.getByTestId('plugin-update-update-translator');
    await expect(row).toContainText('No update source');
    await page.getByRole('textbox', { name: 'Prefix', exact: true }).fill('Saved');
    await page.getByRole('button', { name: 'Save plugin settings' }).click();
    await row.locator('summary').click();
    await row.getByLabel('Source type', { exact: true }).selectOption('github');
    await row.getByLabel('GitHub repository', { exact: true }).fill('test/translator');
    await row.getByRole('button', { name: 'Save source and check' }).click();
    await expect(row).toContainText('1.0.0 → 2.0.0');
    await page.screenshot({ path: testInfo.outputPath('plugin-update-available.png') });
    await row.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(row.getByRole('alert')).toContainText('checksum mismatch');
    expect((await page.evaluate(() => ((window as unknown as { electron: Bridge }).electron).musicPluginList()))[0]?.version).toBe('1.0.0');
    await app.evaluate(() => { (globalThis as unknown as { failPluginDownload: boolean }).failPluginDownload = false; });
    await row.getByRole('button', { name: 'Retry update' }).click();
    await expect(row).toContainText('Latest compatible version');
    expect(await page.evaluate(() => ((window as unknown as { electron: Bridge }).electron).pluginConfiguration('update-translator'))).toEqual({ prefix: 'Saved' });
    const translation = await page.evaluate(() => ((window as unknown as { electron: Bridge }).electron).pluginTranslate({ requestId: 'new-code', providerKey: 'update-translator:default', request: {
      targetLanguage: 'zh', document: { id: 'doc', revision: 'rev', trackId: 'track', lines: [{ id: 'line', text: 'Original' }] } } }));
    expect(translation.lines).toEqual([{ lineId: 'line', text: 'Saved 2.0.0' }]);
    await page.screenshot({ path: testInfo.outputPath('plugin-update-installed.png') });
    await app.close(); app = await launch(); const restarted = await app.firstWindow();
    await restarted.waitForFunction(() => Boolean((window as unknown as { electron?: Bridge }).electron?.pluginUpdateList));
    expect((await restarted.evaluate(() => ((window as unknown as { electron: Bridge }).electron).musicPluginList()))[0]).toMatchObject({ version: '2.0.0', enabled: true });
    expect(await restarted.evaluate(() => ((window as unknown as { electron: Bridge }).electron).pluginUpdateList())).toMatchObject([{ currentVersion: '2.0.0', status: 'up-to-date', source: { kind: 'github', repository: 'test/translator' } }]);
    expect(await restarted.evaluate(() => ((window as unknown as { electron: Bridge }).electron).pluginConfiguration('update-translator'))).toEqual({ prefix: 'Saved' });
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
});
