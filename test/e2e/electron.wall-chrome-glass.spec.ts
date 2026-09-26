import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const require = createRequire(import.meta.url);
const run = promisify(execFile);
interface NativeItem { id: string; hidden: boolean; alpha: number; x: number; y: number; width: number; height: number; label: string; appearance: string }
interface NativeMenuItem { id: string; title: string; header: boolean; checked: boolean; badge: string; image: boolean }
interface NativeSnapshot { windowNumber: number; items: NativeItem[]; menu: NativeMenuItem[] }

test('poster wall chrome renders as native Liquid Glass with the system source menu', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin' || Number(os.release().split('.')[0]) < 25, 'Requires macOS 26');
  test.setTimeout(90_000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-wall-chrome-')));
  const userData = path.join(root, 'data');
  const isolatedHome = path.join(root, 'home');
  await Promise.all([mkdir(userData, { recursive: true }), mkdir(path.join(isolatedHome, '.la'), { recursive: true })]);
  // Reopen straight into the poster wall.
  await writeFile(path.join(isolatedHome, '.la/settings.json'), JSON.stringify({ 'app-language': 'en', la_library_mode: 'wall' }));
  const probePath = path.join(root, 'probe.node');
  const version = require('electron/package.json').version as string;
  await run('clang++', ['-std=c++17', '-fobjc-arc', '-shared', '-undefined', 'dynamic_lookup',
    '-I', path.join(os.homedir(), '.electron-gyp', version, 'include/node'), '-framework', 'AppKit',
    path.join(repo, 'test/native/focusGlassProbe.mm'), '-o', probePath]);
  const wav = Buffer.alloc(44 + 16000 * 10);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const songs = ['Amber', 'Blue', 'Coral'].map((title, index) => ({
    id: `wall-chrome-${index}`, title, artist: 'Test Artist', album: 'Test Album', duration: 10,
    audioUrl: '', source: 'local', available: true, filePath: path.join(root, `${title}.wav`), fileName: `${title}.wav`,
  }));
  for (const song of songs) await writeFile(song.filePath, wav);
  await writeFile(path.join(userData, 'library-index.json'), JSON.stringify({ songs, settings: {
    activeSlotId: 'local', localSlot: { currentTrackIndex: -1, currentTime: 0, volume: 0.5, playbackMode: 'order', scrollPosition: 0, filterType: 'default', categorySelection: null },
  } }));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE']; delete env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'];
  Object.assign(env, { NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', HOME: isolatedHome, USERPROFILE: isolatedHome,
    APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'local'), XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'xdg-data'), XDG_CACHE_HOME: path.join(root, 'cache') });
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ cwd: root, args: [`--user-data-dir=${userData}`, repo], env });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 800));
    const probe = async (id?: string): Promise<NativeSnapshot> => JSON.parse(await app!.evaluate(async ({ BrowserWindow }, args) => {
      const { createRequire } = process.getBuiltinModule('module');
      const native = createRequire(args.file)(args.file) as { probe: (handle: Buffer, id?: string) => string };
      const handle = BrowserWindow.getAllWindows()[0]!.getNativeWindowHandle();
      return args.id ? native.probe(handle, args.id) : native.probe(handle);
    }, { file: probePath, id })) as NativeSnapshot;
    const item = async (id: string) => (await probe()).items.find(entry => entry.id === id);

    // Native chrome replaces the web pill; only an invisible anchor stays in the DOM.
    await expect(page.locator('.wall-tile')).toHaveCount(3);
    await expect(page.locator('.wall-chrome-anchor')).toBeAttached();
    await expect(page.locator('.wall-chrome')).toHaveCount(0);
    await expect.poll(async () => (await item('wall-chrome-glass'))?.hidden).toBe(false);
    const back = (await item('wall-chrome-back'))!;
    const source = (await item('wall-chrome-source'))!;
    expect(back.label).toBe('Back to library');
    expect(source.label).toBe('Local, switch music source');
    expect(source.x).toBeGreaterThan(back.x + back.width - 1);
    expect(back.x).toBeCloseTo(16, 0);

    // The system menu mirrors the sources: section header, check mark, count badges, icons.
    const menu = (await probe()).menu;
    expect(menu.map(entry => entry.header ? `# ${entry.title}` : entry.title)).toEqual(['# Library', 'Local', 'Online History']);
    expect(menu.find(entry => entry.id === 'slot:local')).toMatchObject({ checked: true, badge: '3', image: true });
    expect(menu.find(entry => entry.id === 'slot:online')).toMatchObject({ checked: false, image: true });

    if (process.env['FOCUS_GLASS_SCREENSHOTS'] === '1') {
      await page.waitForTimeout(800);
      await run('screencapture', ['-x', '-o', '-l', String((await probe()).windowNumber), testInfo.outputPath('wall-chrome.png')]);
    }

    // Choosing a menu item switches the wall's source through React.
    await probe('wall-chrome-menu:slot:online');
    await expect(page.getByText('No online history yet')).toBeVisible();
    await expect.poll(async () => (await item('wall-chrome-source'))?.label).toBe('Online History, switch music source');
    expect((await probe()).menu.find(entry => entry.id === 'slot:online')?.checked).toBe(true);

    // Focus mode covers the anchor, so the native chrome hides and returns afterwards.
    await page.keyboard.press('Meta+Enter');
    await expect.poll(async () => (await item('wall-chrome-glass'))?.hidden).toBe(true);
    await page.keyboard.press('Meta+Enter');
    await expect.poll(async () => (await item('wall-chrome-glass'))?.hidden, { timeout: 5000 }).toBe(false);

    // The native back button leaves the wall and releases the native surface.
    await probe('wall-chrome-back');
    await expect(page.locator('aside')).toHaveCount(1);
    await expect.poll(async () => (await item('wall-chrome-host')) ?? null).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
