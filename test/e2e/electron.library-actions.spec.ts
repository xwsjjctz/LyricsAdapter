import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type Page, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

/** The wall is the home page; the legacy list opens from the command palette. */
async function openLegacyList(page: Page) {
  await expect(page.locator('.poster-wall')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+K');
  await expect(page.locator('.command-palette__input')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.locator('.command-palette__input').fill('legacy');
  await page.keyboard.press('Enter');
  await expect(page.locator('.command-palette')).toHaveCount(0);
}

test('song menus, selection, reorder and removal preserve original files across restart', async ({}, testInfo) => {
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
    await expect(page.locator('.wall-tile')).toHaveCount(3);
    await openLegacyList(page);
    const rows = page.locator('.library-track-row');
    await expect(rows).toHaveCount(3);
    await expect(page.locator('.library-toolbar-actions button')).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('draggable', 'true');
    await expect(rows.first().locator('> div')).toHaveCount(3);

    // Right click opens song actions without a trailing more button or playback.
    await expect(rows.getByRole('button')).toHaveCount(0);
    await expect(rows.first()).toHaveCSS('cursor', 'default');
    await rows.first().click({ button: 'right' });
    await expect(page.getByRole('menuitem')).toHaveText(['Edit song information', 'Select multiple songs', 'Remove from library']);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('song-menu.png') });
    await page.getByRole('menuitem', { name: 'Edit song information' }).click();
    await expect(page.getByRole('heading', { name: 'Metadata', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Metadata', exact: true })).toHaveCount(0);
    await rows.first().click({ button: 'right' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await rows.first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Select multiple songs' }).click();
    await expect(page.getByRole('checkbox', { name: 'Select Amber' })).toBeChecked();
    await expect(rows.first()).toHaveAttribute('draggable', 'false');
    await expect(rows.getByRole('button')).toHaveCount(0);
    await rows.nth(1).click();
    await expect(page.getByRole('checkbox', { name: 'Select Blue' })).toBeChecked();
    expect(await page.locator('audio').evaluateAll(nodes => nodes.every(node => (node as HTMLAudioElement).paused))).toBe(true);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('selection.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(820, 650));
    await expect(page.getByRole('button', { name: 'Remove selected', exact: true })).toBeInViewport();
    await expect(rows.first().getByRole('checkbox')).toBeInViewport();
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('selection-narrow.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800));
    await page.getByRole('button', { name: 'Select All', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Select Coral' })).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('checkbox')).toHaveCount(0);

    // Cancelling a drag does not commit the last hovered insertion position.
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    const target = (await rows.last().boundingBox())!;
    await rows.first().dispatchEvent('dragstart', { dataTransfer: transfer });
    await expect(rows.first()).toHaveCSS('cursor', 'grabbing');
    await rows.last().dispatchEvent('dragover', { dataTransfer: transfer, clientY: target.y + target.height - 2 });
    await rows.first().dispatchEvent('dragend', { dataTransfer: transfer });
    await expect(rows.first()).toHaveCSS('cursor', 'default');
    await expect(rows.first()).toContainText('Amber');
    // A real drop commits; this also tests the normal-state sorting entry point.
    await rows.first().dispatchEvent('dragstart', { dataTransfer: transfer });
    await expect(rows.first()).toHaveCSS('cursor', 'grabbing');
    await rows.last().dispatchEvent('dragover', { dataTransfer: transfer, clientY: target.y + target.height - 2 });
    await rows.last().dispatchEvent('drop', { dataTransfer: transfer, clientY: target.y + target.height - 2 });
    await expect(rows.last()).toContainText('Amber');
    await expect(rows.last()).toHaveCSS('cursor', 'default');

    await rows.last().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Select multiple songs' }).click();
    await rows.first().click();
    await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
    await expect(page.getByText('Remove 2 selected songs from your library. The original audio files will be kept.')).toBeVisible();
    await page.getByRole('button', { name: 'Remove from library', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Coral');
    await expect(page.getByRole('heading', { name: 'Remove from library?' })).toHaveCount(0);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('after-removal.png') });
    await page.reload();
    await openLegacyList(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Coral');
    await app.close(); app = undefined;
    for (const song of songs) expect(await readFile(song.filePath)).toEqual(audio);

    app = await launch();
    const restored = await app.firstWindow();
    await expect(restored.locator('.wall-tile')).toHaveCount(1);
    await openLegacyList(restored);
    await expect(restored.locator('.library-track-row')).toHaveCount(1);
    await expect(restored.locator('.library-track-row')).toContainText('Coral');
    await restored.locator('.library-track-row').click({ button: 'right' });
    await restored.getByRole('menuitem', { name: 'Remove from library' }).click();
    await restored.getByRole('button', { name: 'Remove from library', exact: true }).click();
    await expect(restored.locator('.library-track-row')).toHaveCount(0);
    expect(await readFile(songs[2]!.filePath)).toEqual(audio);
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
