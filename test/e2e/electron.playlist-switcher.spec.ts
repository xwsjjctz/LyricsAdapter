import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

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
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const begin = async () => { await page.keyboard.down(modifier); await page.keyboard.press('Backquote'); };
    const dialog = page.getByTestId('playlist-switcher');
    const selected = dialog.getByRole('option', { selected: true });

    await begin();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('option')).toHaveCount(2);
    await expect(selected).toHaveAccessibleName('Online History');
    await expect(tiles).toHaveCount(3);
    await page.keyboard.press('Backquote'); await expect(selected).toHaveAccessibleName('Local');
    await page.keyboard.press('Shift+Backquote'); await expect(selected).toHaveAccessibleName('Online History');
    await page.keyboard.press('Space'); expect(await audioState()).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath('switcher-wide.png') });
    await page.keyboard.up(modifier);
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
    await page.screenshot({ path: testInfo.outputPath('switcher-portrait.png') });
    await dialog.getByRole('option', { name: 'Local', exact: true }).click();
    await page.keyboard.up(modifier);
    await expect(tiles).toHaveCount(3); expect(await audioState()).toEqual(before);

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
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
