import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('the poster wall reopens where it was left instead of locating the playing track', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-wall-scroll-')));
  const isolatedHome = path.join(root, 'home');
  const userData = path.join(root, 'user-data');
  await mkdir(path.join(isolatedHome, '.la'), { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(isolatedHome, '.la/settings.json'), JSON.stringify({ 'app-language': 'en' }));
  const pcmBytes = 16000;
  const audio = Buffer.alloc(44 + pcmBytes);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(pcmBytes, 40);
  const songs = Array.from({ length: 60 }, (_, index) => ({
    id: `scroll-${index}`, title: `Song ${index}`, artist: 'Test Artist', album: 'Test Album',
    duration: 1, audioUrl: '', source: 'local', available: true,
    filePath: path.join(root, `song-${index}.wav`), fileName: `song-${index}.wav`,
  }));
  for (const song of songs) await writeFile(song.filePath, audio);
  // The last song is "playing": a startup locate would scroll to the very end.
  await writeFile(path.join(userData, 'library-index.json'), JSON.stringify({ songs, settings: {
    activeSlotId: 'local', localSlot: { currentTrackIndex: 59, currentTime: 0, volume: 0.5,
      playbackMode: 'order', scrollPosition: 600, filterType: 'default', categorySelection: null },
  } }));
  const env = Object.fromEntries(Object.entries({ ...process.env,
    HOME: isolatedHome, USERPROFILE: isolatedHome, APPDATA: path.join(root, 'app-data'),
    LOCALAPPDATA: path.join(root, 'local-app-data'), XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE'];
  let app: ElectronApplication | undefined;
  const launch = async (): Promise<Page> => {
    app = await electron.launch({ cwd: root, args: [
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userData}`, repo,
    ], env });
    const window = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800));
    await expect(window.locator('.wall-tile').first()).toBeVisible();
    return window;
  };
  const wallScroll = (page: Page) => page.locator('.poster-wall').evaluate(node => node.scrollTop);
  try {
    let page = await launch();
    // Opens at the saved offset, and stays there rather than chasing the playing tile.
    await expect.poll(() => wallScroll(page)).toBe(600);
    await page.waitForTimeout(800);
    expect(await wallScroll(page)).toBe(600);

    // Scroll somewhere else; after a restart the wall opens there directly.
    await page.locator('.poster-wall').evaluate(node => { node.scrollTop = 1000; });
    await expect.poll(() => wallScroll(page)).toBe(1000);
    await page.waitForTimeout(600); // Let the offset commit before quitting.
    await app!.close(); app = undefined;

    page = await launch();
    await expect.poll(() => wallScroll(page)).toBe(1000);
    await page.waitForTimeout(800);
    expect(await wallScroll(page)).toBe(1000);
  } finally {
    if (app) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
