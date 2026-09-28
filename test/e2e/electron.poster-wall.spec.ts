import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('poster wall is the home page, plays in place and switches sources from the command palette', async ({}, testInfo) => {
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

    // The wall is the home page: no sidebar, toolbar or floating chrome buttons.
    const tiles = page.locator('.wall-tile');
    await expect(tiles).toHaveCount(3);
    // Songs without artwork show the bundled app-icon cover, and it really decodes.
    const covers = tiles.locator('img');
    await expect(covers).toHaveCount(3);
    for (const cover of await covers.all()) {
      await expect(cover).toHaveAttribute('src', /default-cover\.jpg$/);
      await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(512);
    }
    await expect(page.locator('aside')).toHaveCount(0);
    await expect(page.locator('.library-toolbar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Back to library' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /switch music source/ })).toHaveCount(0);
    await expect(tiles.first()).toHaveAttribute('aria-label', 'Amber, Test Artist');

    // Let the view transition and tile pop-in settle before measuring.
    const settled = () => expect.poll(() => tiles.evaluateAll(nodes => nodes.every(node =>
      getComputedStyle(node.querySelector('[data-wall-tile-inner]')!).opacity === '1'))).toBe(true);
    await settled();
    await page.waitForTimeout(400);

    // Tiles run flush to both window edges, with no side padding.
    const edges = await tiles.evaluateAll(nodes => {
      const rects = nodes.map(node => node.getBoundingClientRect());
      return { left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)), width: window.innerWidth };
    });
    expect(edges.left).toBeCloseTo(0, 0);
    expect(edges.right).toBeLessThanOrEqual(edges.width);

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

    // The wall owns every song action, multi-select included.
    await tiles.first().click({ button: 'right' });
    await expect(page.getByRole('menuitem')).toHaveText(['Edit song information', 'Select multiple songs', 'Remove from library']);
    await page.keyboard.press('Escape');

    // Features mode switches the source: tiles sink out, the empty history takes over.
    const paletteInput = page.locator('.command-palette__input');
    await page.keyboard.press('ControlOrMeta+K');
    await expect(paletteInput).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Library', selected: true })).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('tab', { name: 'Features', selected: true })).toBeVisible();
    await paletteInput.fill('Online History');
    await expect(page.getByRole('option').first()).toContainText('Switch to Online History');
    await page.keyboard.press('Enter');
    await expect(page.locator('.command-palette')).toHaveCount(0);
    await expect(page.getByText('No online history yet')).toBeVisible();
    await expect(tiles).toHaveCount(0);

    // Library mode lists the sources first, so Cmd+K, Enter returns to Local.
    await page.keyboard.press('ControlOrMeta+K');
    await expect(page.getByRole('option').first()).toContainText('Switch to Local');
    await page.keyboard.press('Enter');
    await expect(tiles).toHaveCount(3);
    await settled();

    // Esc closes the palette without side effects.
    await page.keyboard.press('ControlOrMeta+K');
    await page.keyboard.press('Escape');
    await expect(page.locator('.command-palette')).toHaveCount(0);

    // Full search results are a poster wall too; Esc returns to the library.
    await page.keyboard.press('ControlOrMeta+K');
    await paletteInput.fill('Coral');
    await page.getByRole('option', { name: /All results for "Coral"/ }).click();
    await expect(page.locator('.search-wall-view')).toBeVisible();
    await expect(page.locator('.search-wall-view .wall-tile')).toHaveCount(1);
    await expect(page.locator('.search-wall-view .wall-tile')).toHaveAttribute('aria-label', 'Coral, Test Artist');
    await expect(page.locator('aside')).toHaveCount(0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath('search-wall.png') });
    await page.keyboard.press('Escape');
    await expect(page.locator('.search-wall-view')).toHaveCount(0);
    await expect(tiles).toHaveCount(3);

    // Settings float over the wall as a sheet and close back to it.
    await page.keyboard.press('ControlOrMeta+K');
    await page.keyboard.press('Shift+Tab');
    await paletteInput.fill('settings');
    await page.keyboard.press('Enter');
    await expect(page.locator('.settings-sheet')).toBeVisible();
    await expect(tiles).toHaveCount(3);
    // The sheet is frosted glass over the wall (a minifier once dropped the unprefixed blur).
    expect(await page.locator('.settings-sheet').evaluate(node => getComputedStyle(node).backdropFilter)).toContain('blur');
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath('settings-sheet.png') });
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-sheet')).toHaveCount(0);

    // The wall stays the home page after a restart.
    await app!.close(); app = undefined;
    page = await launch();
    await expect(page.locator('.wall-tile')).toHaveCount(3);
    await expect(page.locator('aside')).toHaveCount(0);

    // The classic list stays one palette command away, and the choice is remembered.
    const listRows = page.locator('.library-view .library-track-row');
    const runFeature = async (query: string, title: string) => {
      await page.keyboard.press('ControlOrMeta+K');
      await page.keyboard.press('Shift+Tab');
      await page.locator('.command-palette__input').fill(query);
      await expect(page.getByRole('option').first()).toContainText(title);
      await page.keyboard.press('Enter');
      await expect(page.locator('.command-palette')).toHaveCount(0);
    };
    await runFeature('classic list', 'Switch to classic list view');
    await expect(listRows).toHaveCount(3);
    await expect(page.locator('.wall-tile')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('classic-list.png') });
    await app!.close(); app = undefined;
    page = await launch();
    await expect(page.locator('.library-view .library-track-row')).toHaveCount(3);
    await runFeature('poster wall view', 'Switch to poster wall view');
    await expect(page.locator('.wall-tile')).toHaveCount(3);
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
