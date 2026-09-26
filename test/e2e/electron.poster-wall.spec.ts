import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('poster wall opens from the sidebar, plays in place, switches sources and returns', async ({}, testInfo) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-poster-wall-')));
  const isolatedHome = path.join(root, 'home');
  const userData = path.join(root, 'user-data');
  await mkdir(path.join(isolatedHome, '.la'), { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(isolatedHome, '.la/settings.json'), JSON.stringify({ 'app-language': 'en' }));
  // 10 s of silence: long enough to pause before the track ends and auto-advances.
  const pcmBytes = 16000 * 10;
  const audio = Buffer.alloc(44 + pcmBytes);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(pcmBytes, 40);
  const songs = ['Amber', 'Blue', 'Coral'].map((title, index) => ({
    id: `poster-wall-${index}`, title, artist: 'Test Artist', album: 'Test Album',
    duration: 10, audioUrl: '', source: 'local', available: true,
    filePath: path.join(root, `${title}.wav`), fileName: `${title}.wav`,
  }));
  for (const song of songs) await writeFile(song.filePath, audio);
  await writeFile(path.join(userData, 'library-index.json'), JSON.stringify({ songs, settings: {
    activeSlotId: 'local', localSlot: { currentTrackIndex: -1, currentTime: 0, volume: 0.5,
      playbackMode: 'order', scrollPosition: 0, filterType: 'default', categorySelection: null },
  } }));
  const env = Object.fromEntries(Object.entries({ ...process.env,
    HOME: isolatedHome, USERPROFILE: isolatedHome, APPDATA: path.join(root, 'app-data'),
    LOCALAPPDATA: path.join(root, 'local-app-data'), XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE'];
  let app: ElectronApplication | undefined;
  try {
    const errors: string[] = [];
    const launch = async () => {
      app = await electron.launch({ cwd: root, args: [
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userData}`, repo,
      ], env });
      const window = await app.firstWindow();
      window.on('pageerror', error => errors.push(error.message));
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800));
      return window;
    };
    let page = await launch();

    // The classic library stays the default; the sidebar button enters the wall.
    await expect(page.locator('.library-track-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'Poster wall' }).click();
    const tiles = page.locator('.wall-tile');
    await expect(tiles).toHaveCount(3);
    await expect(page.locator('aside')).toHaveCount(0);
    await expect(page.locator('.library-toolbar')).toHaveCount(0);
    await expect(tiles.first()).toHaveAttribute('aria-label', 'Amber, Test Artist');

    // Let the view transition and tile pop-in settle before measuring.
    const settled = () => expect.poll(() => tiles.evaluateAll(nodes => nodes.every(node =>
      getComputedStyle(node.querySelector('[data-wall-tile-inner]')!).opacity === '1'))).toBe(true);
    await settled();
    await page.waitForTimeout(400);

    // The wall is a song list: playing a tile marks it where it is.
    const coral = page.getByRole('button', { name: 'Coral, Test Artist' });
    const before = await coral.boundingBox();
    await coral.click();
    await expect(page.locator('.wall-tile[aria-current="true"]')).toHaveAttribute('aria-label', 'Coral, Test Artist');
    expect(await coral.boundingBox()).toEqual(before);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: testInfo.outputPath('wall.png') });

    // Regression: the clicked tile keeps focus. Pausing with Space and toggling
    // focus mode with Cmd/Ctrl+Enter must not replay that tile.
    const audioPaused = () => page.locator('audio').evaluate(node => (node as HTMLAudioElement).paused);
    await expect(coral).toBeFocused();
    await expect.poll(audioPaused).toBe(false);
    await page.keyboard.press('Space');
    await expect.poll(audioPaused).toBe(true);
    const focusOverlay = page.locator('.focus-mode-overlay');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(focusOverlay).toHaveClass(/translate-y-0/);
    await page.waitForTimeout(500);
    expect(await audioPaused()).toBe(true);
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(focusOverlay).toHaveClass(/translate-y-full/);
    await page.waitForTimeout(500);
    expect(await audioPaused()).toBe(true);

    // Wall menus leave multi-select to the list.
    await tiles.first().click({ button: 'right' });
    await expect(page.getByRole('menuitem')).toHaveText(['Edit song information', 'Remove from library']);
    await page.keyboard.press('Escape');

    // The floating chrome's source switcher: tiles sink out, the empty history takes over.
    const trigger = page.getByRole('button', { name: /switch music source/ });
    await trigger.click();
    await expect(page.getByRole('menuitemradio', { name: /Local/ })).toHaveAttribute('aria-checked', 'true');
    // A click focuses the menu itself, so no item or ring lights up.
    await expect(page.locator('.library-source-menu')).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('data-input-modality', 'pointer');
    await page.getByRole('menuitemradio', { name: /Online History/ }).click();
    await expect(trigger).not.toBeFocused();
    await expect(page.getByText('No online history yet')).toBeVisible();
    await expect(tiles).toHaveCount(0);

    // The keyboard path still moves focus into the menu and back to the trigger.
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitemradio', { name: /Online History/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole('menuitemradio', { name: /Local/ }).click();
    await expect(tiles).toHaveCount(3);
    await settled();

    // The wall is remembered across restarts.
    await app!.close(); app = undefined;
    page = await launch();
    await expect(page.locator('.wall-tile')).toHaveCount(3);
    await expect(page.locator('aside')).toHaveCount(0);

    // Back returns to the classic library with its sidebar, and that is remembered too.
    await page.getByRole('button', { name: 'Back to library' }).click();
    await expect(page.locator('.library-track-row')).toHaveCount(3);
    await expect(page.locator('aside')).toHaveCount(1);
    await app!.close(); app = undefined;
    page = await launch();
    await expect(page.locator('.library-track-row')).toHaveCount(3);
    await expect(page.locator('.wall-tile')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
