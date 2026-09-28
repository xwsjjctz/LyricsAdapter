import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type Page, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

/** Runs a feature command from the Cmd+K palette. */
async function runPaletteCommand(page: Page, query: string) {
  await expect(page.locator('.poster-wall')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+K');
  await expect(page.locator('.command-palette__input')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.locator('.command-palette__input').fill(query);
  await page.keyboard.press('Enter');
  await expect(page.locator('.command-palette')).toHaveCount(0);
}

const tileTitles = (page: Page) => page.locator('.wall-tile').evaluateAll(nodes => nodes
  .map(node => node as HTMLElement)
  .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
    || a.getBoundingClientRect().left - b.getBoundingClientRect().left)
  .map(node => node.getAttribute('aria-label')!.split(',')[0]));

test('wall song menus, selection, swap and removal preserve original files across restart', async ({}, testInfo) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-library-actions-')));
  const isolatedHome = path.join(root, 'home');
  const userData = path.join(root, 'user-data');
  await mkdir(path.join(isolatedHome, '.la'), { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(isolatedHome, '.la/settings.json'), JSON.stringify({ 'app-language': 'en' }));
  // A tiny PCM fixture lets us verify the original audio bytes remain unchanged.
  const audio = Buffer.alloc(44 + 8000);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(8000, 40);
  const songs = ['Amber', 'Blue', 'Coral'].map((title, index) => ({
    id: `library-actions-${index}`, title, artist: 'Test Artist', album: 'Test Album',
    duration: 0.5, audioUrl: '', source: 'local', available: true,
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
  const launch = () => electron.launch({ cwd: root, args: [
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userData}`, repo,
  ], env });
  try {
    app = await launch();
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800));
    const tiles = page.locator('.wall-tile');
    await expect(tiles).toHaveCount(3);
    const tile = (title: string) => page.locator(`.wall-tile[aria-label="${title}, Test Artist"]`);
    await expect(tiles.first()).toHaveAttribute('draggable', 'true');

    // Right click opens song actions without playing the song.
    await tile('Amber').click({ button: 'right' });
    await expect(page.getByRole('menuitem')).toHaveText(['Edit song information', 'Select multiple songs', 'Remove from library']);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('song-menu.png') });
    await page.getByRole('menuitem', { name: 'Edit song information' }).click();
    await expect(page.getByRole('heading', { name: 'Metadata', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Metadata', exact: true })).toHaveCount(0);
    await tile('Amber').click({ button: 'right' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // Multi-select from the menu: posters become checkboxes and clicks toggle them.
    await tile('Amber').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Select multiple songs' }).click();
    await expect(tile('Amber')).toHaveAttribute('aria-checked', 'true');
    await expect(tile('Amber')).toHaveAttribute('draggable', 'false');
    await tile('Blue').click();
    await expect(tile('Blue')).toHaveAttribute('aria-checked', 'true');
    expect(await page.locator('audio').evaluateAll(nodes => nodes.every(node => (node as HTMLAudioElement).paused))).toBe(true);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('selection.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(820, 650));
    await expect(page.getByRole('button', { name: 'Remove selected', exact: true })).toBeInViewport();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800));
    await page.getByRole('button', { name: 'Select All', exact: true }).click();
    await expect(tile('Coral')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('checkbox')).toHaveCount(0);

    // Dragging a poster onto another swaps the two songs; a cancelled drag changes nothing.
    expect(await tileTitles(page)).toEqual(['Amber', 'Blue', 'Coral']);
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await tile('Amber').dispatchEvent('dragstart', { dataTransfer: transfer });
    await tile('Coral').dispatchEvent('dragover', { dataTransfer: transfer });
    await expect(tile('Coral')).toHaveClass(/wall-tile--drag-target/);
    await tile('Amber').dispatchEvent('dragend', { dataTransfer: transfer });
    await expect(tile('Coral')).not.toHaveClass(/wall-tile--drag-target/);
    expect(await tileTitles(page)).toEqual(['Amber', 'Blue', 'Coral']);
    const boxesBefore = await tiles.evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    }).sort());
    await tile('Amber').dispatchEvent('dragstart', { dataTransfer: transfer });
    await tile('Coral').dispatchEvent('dragover', { dataTransfer: transfer });
    await tile('Coral').dispatchEvent('drop', { dataTransfer: transfer });
    await expect.poll(() => tileTitles(page)).toEqual(['Coral', 'Blue', 'Amber']);
    // The mosaic keeps its tile sizes; only the songs moved.
    expect(await tiles.evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    }).sort())).toEqual(boxesBefore);

    // The palette enters selection too; batch removal keeps the files.
    await runPaletteCommand(page, 'select multiple');
    await tile('Amber').click();
    await tile('Blue').click();
    await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
    await expect(page.getByText('Remove 2 selected songs from your library. The original audio files will be kept.')).toBeVisible();
    await page.getByRole('button', { name: 'Remove from library', exact: true }).click();
    await expect(tiles).toHaveCount(1);
    await expect(tiles.first()).toHaveAttribute('aria-label', 'Coral, Test Artist');
    await expect(page.getByRole('heading', { name: 'Remove from library?' })).toHaveCount(0);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('after-removal.png') });
    await page.reload();
    await expect(tiles).toHaveCount(1);
    await expect(tiles.first()).toHaveAttribute('aria-label', 'Coral, Test Artist');
    await app.close(); app = undefined;
    for (const song of songs) expect(await readFile(song.filePath)).toEqual(audio);

    app = await launch();
    const restored = await app.firstWindow();
    const restoredTiles = restored.locator('.wall-tile');
    await expect(restoredTiles).toHaveCount(1);
    await expect(restoredTiles.first()).toHaveAttribute('aria-label', 'Coral, Test Artist');
    await restoredTiles.first().click({ button: 'right' });
    await restored.getByRole('menuitem', { name: 'Remove from library' }).click();
    await restored.getByRole('button', { name: 'Remove from library', exact: true }).click();
    await expect(restoredTiles).toHaveCount(0);
    await expect(restored.getByRole('button', { name: 'Import Files' })).toBeVisible();
    expect(await readFile(songs[2]!.filePath)).toEqual(audio);
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
