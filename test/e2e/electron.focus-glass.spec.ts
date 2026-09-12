import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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
interface NativeItem { id: string; class: string; hidden: boolean; alpha: number; x: number; y: number; width: number; height: number; label: string }
interface NativeSnapshot { windowNumber: number; items: NativeItem[] }

test('macOS Liquid Glass controls route intents, resize and release their native views', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin' || Number(os.release().split('.')[0]) < 25, 'Requires macOS 26');
  test.setTimeout(100_000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-focus-glass-')));
  const userData = path.join(root, 'data');
  const isolatedHome = path.join(root, 'home');
  await Promise.all([mkdir(path.join(userData, 'covers'), { recursive: true }), mkdir(isolatedHome)]);
  const probePath = path.join(root, 'probe.node');
  const version = require('electron/package.json').version as string;
  await run('clang++', ['-std=c++17', '-fobjc-arc', '-shared', '-undefined', 'dynamic_lookup',
    '-I', path.join(os.homedir(), '.electron-gyp', version, 'include/node'), '-framework', 'AppKit',
    path.join(repo, 'test/native/focusGlassProbe.mm'), '-o', probePath]);
  const wav = Buffer.alloc(44 + 8000 * 2 * 30);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const songs = Array.from({ length: 60 }, (_, index) => ({
    id: `glass-${index}`, filePath: path.join(root, `glass-${index}.wav`),
    title: `Glass Fixture ${index}`, artist: 'LyricsAdapter', album: 'Native controls', duration: 30,
    source: 'local', available: true, coverUrl: `cover://glass-${index}.png`,
    syncedLyrics: [{ time: 0, text: '给你的爱一直很安静' }, { time: 10, text: '沿着夜色听见远方的声音' }, { time: 20, text: '让音乐留在此刻' }],
  }));
  for (const song of songs) {
    await writeFile(song.filePath, wav);
    await copyFile(path.join(repo, 'app-icon.png'), path.join(userData, 'covers', `${song.id}.png`));
  }
  await writeFile(path.join(userData, 'library-index.json'), JSON.stringify({ songs, settings: {
    activeSlotId: 'local', localSlot: { currentTrackIndex: 0, currentTime: 0, volume: 0, playbackMode: 'order', scrollPosition: 0, filterType: 'default', categorySelection: null },
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
    await expect(page.getByText('Glass Fixture 0').first()).toBeVisible();
    await expect.poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.readyState)).toBeGreaterThanOrEqual(2);
    const toggle = page.getByRole('button', { name: /Focus|专注|集中|집중|Fokus|concentré|フォーカス/i }).first();
    const probe = async (id?: string, value?: number): Promise<NativeSnapshot> => JSON.parse(await app!.evaluate(async ({ BrowserWindow }, args) => {
      const { createRequire } = process.getBuiltinModule('module');
      const native = createRequire(args.file)(args.file) as { probe: (handle: Buffer, id?: string, value?: number) => string };
      const handle = BrowserWindow.getAllWindows()[0]!.getNativeWindowHandle();
      return args.id ? (args.value === undefined ? native.probe(handle, args.id) : native.probe(handle, args.id, args.value)) : native.probe(handle);
    }, { file: probePath, id, value })) as NativeSnapshot;
    const bar = async () => (await probe()).items.find(item => item.id === 'focus-glass-bar');
    const mainSlider = async (id: string) => (await probe()).items.find(item => item.id === id);
    const screenshot = async (name: string) => {
      if (process.env['FOCUS_GLASS_SCREENSHOTS'] !== '1') return;
      const file = testInfo.outputPath(name);
      await mkdir(path.dirname(file), { recursive: true });
      await run('screencapture', ['-x', '-l', String((await probe()).windowNumber), file]);
      await testInfo.attach(name, { path: file, contentType: 'image/png' });
    };
    // Register before opening: native module startup can outlast the transition
    // on busy machines, so pause the page when its transitions actually start.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      let count = 0;
      const pause = (event: TransitionEvent) => {
        const element = event.target;
        if (!(element instanceof Element) || !element.matches('.focus-mode-overlay, .focus-mode-content')) return;
        for (const animation of element.getAnimations()) {
          if (animation instanceof CSSTransition && animation.transitionProperty === event.propertyName
            && ['transform', 'translate', 'opacity'].includes(event.propertyName)) {
            animation.pause(); animation.currentTime = 300; count++;
          }
        }
        document.documentElement.dataset['pausedFocusTransitions'] = String(count);
        if (count >= 2) document.removeEventListener('transitionrun', pause);
      };
      document.addEventListener('transitionrun', pause);
    });
    await expect(page.locator('[data-system-symbol]')).toHaveCount(6);
    const masks = await page.locator('[data-system-symbol]').evaluateAll(elements => elements.map(el => getComputedStyle(el).maskImage));
    expect(masks.every(mask => mask.includes('data:image/png;base64,'))).toBe(true);
    await expect(page.getByTestId('main-seek-anchor')).toHaveAttribute('data-native-slider', 'true');
    await expect.poll(async () => (await mainSlider('player-native-seek'))?.hidden).toBe(false);
    await expect(page.getByTestId('main-play-button')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.getByTestId('main-play-button')).toHaveCSS('box-shadow', 'none');
    await probe('player-native-seek', 8);
    await expect.poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime)).toBeCloseTo(8, 0);
    await probe('player-native-volume', 0.4);
    await expect.poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.volume)).toBeCloseTo(0.4 ** 2, 5);
    await probe('player-native-volume', 0);
    await probe('player-native-seek', 0);
    // A web modal must not have an AppKit slider drawn/clickable above it.
    await page.evaluate(() => {
      const overlay = document.createElement('div'); overlay.id = 'test-slider-occluder';
      Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '99999', background: 'black' });
      document.body.append(overlay);
    });
    await expect.poll(async () => (await mainSlider('player-native-seek'))?.hidden).toBe(true);
    await page.evaluate(() => document.getElementById('test-slider-occluder')?.remove());
    await expect.poll(async () => (await mainSlider('player-native-seek'))?.hidden).toBe(false);
    await screenshot('main-native-sliders.png');
    const panel = page.getByTestId('main-controlbar');
    await expect(panel).toHaveCSS('position', 'absolute');
    const panelRect = (await panel.boundingBox())!;
    expect(panelRect.width).toBeLessThanOrEqual(760);
    expect((await page.getByTestId('main-volume-anchor').boundingBox())!.width).toBeLessThanOrEqual(44);
    expect((await page.getByTestId('main-seek-anchor').boundingBox())!.width).toBeLessThan(240);
    const scroll = page.locator('.library-track-scroll').first();
    const scrollRect = (await scroll.boundingBox())!;
    expect(scrollRect.y + scrollRect.height).toBeGreaterThan(panelRect.y + panelRect.height);
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const lastRow = scroll.getByText('Glass Fixture 59', { exact: true });
    await expect(lastRow).toBeVisible();
    const lastRowRect = (await scroll.locator('[data-track-index="59"]').boundingBox())!;
    expect(lastRowRect.y + lastRowRect.height).toBeLessThan(panelRect.y - 8);
    await lastRow.click();
    await expect(panel.getByText('Glass Fixture 59', { exact: true })).toBeVisible();
    await screenshot('floating-player-list-tail.png');
    await scroll.evaluate(el => { el.scrollTop = 0; });
    await scroll.getByText('Glass Fixture 0', { exact: true }).click();
    await expect(panel.getByText('Glass Fixture 0', { exact: true })).toBeVisible();
    await expect.poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.readyState)).toBeGreaterThanOrEqual(2);
    if (!(await page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused))) await page.getByTestId('main-play-button').click();
    await probe('player-native-seek', 0);
    await toggle.click();
    await expect(page.getByTestId('focus-native-controls')).toBeAttached();
    // The page is deliberately frozen halfway in; keep the independent auto-hide
    // timer from expiring while native geometry is being inspected offscreen.
    await page.getByTestId('focus-native-controls').dispatchEvent('mouseover');
    await expect.poll(async () => (await mainSlider('player-native-seek'))?.hidden).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-paused-focus-transitions', '2');
    const pageOpacity = await page.locator('.focus-mode-content').evaluate(el => Number(getComputedStyle(el).opacity));
    expect(pageOpacity).toBeGreaterThan(0);
    expect(pageOpacity).toBeLessThan(1);
    // Verify the presentation invariant, not a particular easing curve. Theme
    // transitions may change easing without changing native/DOM synchronization.
    await expect.poll(async () => (await bar())?.alpha).toBeCloseTo(pageOpacity, 2);
    await expect.poll(async () => {
      const native = await bar();
      const rect = await page.getByTestId('focus-native-controls').boundingBox();
      const height = await page.evaluate(() => innerHeight);
      return native && rect ? Math.abs(native.y - (height - rect.y - rect.height)) : Infinity;
    }).toBeLessThan(2);
    await page.locator('.focus-mode-overlay').evaluate(element => {
      for (const animation of element.getAnimations({ subtree: true })) animation.play();
    });
    await page.getByTestId('focus-native-controls').hover();
    await expect.poll(async () => (await bar())?.alpha).toBe(1);
    expect((await bar())?.class).toBe('NSGlassEffectView');
    expect((await probe()).items.some(item => item.id === 'focus-glass-frost')).toBe(false);
    await page.getByTestId('focus-native-controls').hover();
    await expect.poll(async () => (await bar())?.alpha).toBe(1);
    await screenshot('native-glass-player.png');

    await probe('focus-glass-play');
    await expect.poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused)).toBe(false);
    await probe('focus-glass-play');
    await expect.poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused)).toBe(true);
    await probe('focus-glass-seek', 12);
    await expect.poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime)).toBeCloseTo(12, 0);
    expect((await probe()).items.some(item => item.id === 'focus-glass-volume')).toBe(false);
    const slider = (await probe()).items.find(item => item.id === 'focus-glass-volume-slider')!;
    const surface = (await bar())!;
    expect(slider.y).toBeGreaterThan(surface.y);
    expect(slider.y + slider.height).toBeLessThan(surface.y + surface.height);
    expect(surface.width).toBeLessThanOrEqual(350);
    expect(slider.width).toBeLessThanOrEqual(68);
    await probe('focus-glass-volume-slider', 0.37);
    // The player deliberately maps the UI's linear volume to perceptual gain.
    await expect.poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.volume)).toBeCloseTo(0.37 ** 2, 5);
    await screenshot('native-glass-volume.png');
    await probe('focus-glass-mute');
    await expect.poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.volume)).toBe(0);
    await probe('focus-glass-next');
    await expect(page.locator('.focus-mode-overlay').getByText('Glass Fixture 1', { exact: true })).toBeVisible();
    await probe('focus-glass-previous');
    await expect(page.locator('.focus-mode-overlay').getByText('Glass Fixture 0', { exact: true })).toBeVisible();
    for (const width of [1080, 1440]) {
      await app.evaluate(({ BrowserWindow }, w) => { BrowserWindow.getAllWindows()[0]!.setSize(w, 800); }, width);
      await expect.poll(async () => { const item = await bar(); return item ? Math.abs(item.x + item.width / 2 - width / 2) : Infinity; }).toBeLessThan(1);
    }
    // Move Chromium's pointer off the reveal target too; a synthetic AppKit exit
    // with the DOM pointer still inside would legitimately reveal the bar again.
    await page.mouse.move(10, 70);
    await probe('focus-glass-host'); // Native pointer exit schedules the existing auto-hide.
    await expect.poll(async () => (await bar())?.hidden).toBe(true);
    await page.getByTestId('focus-native-controls').hover();
    await expect.poll(async () => (await bar())?.hidden).toBe(false);
    await toggle.click();
    // Exit must move/fade the native surface with the page, rather than hiding
    // it immediately while the rest of FocusMode is still on screen.
    await page.locator('.focus-mode-overlay').evaluate(element => {
      for (const animation of element.getAnimations({ subtree: true })) {
        if (animation instanceof CSSTransition && ['transform', 'translate', 'opacity'].includes(animation.transitionProperty)) {
          animation.pause(); animation.currentTime = 250;
        }
      }
    });
    await expect.poll(async () => (await bar())?.alpha ?? 0).toBeGreaterThan(0.1);
    await expect.poll(async () => (await bar())?.y ?? 0).toBeLessThan(0);
    await page.locator('.focus-mode-overlay').evaluate(element => {
      for (const animation of element.getAnimations({ subtree: true })) animation.play();
    });
    await expect.poll(async () => (await probe()).items.filter(item => item.id.startsWith('focus-glass')).length).toBe(0);
    await expect.poll(async () => (await mainSlider('player-native-volume'))?.hidden).toBe(false);
    await toggle.click();
    await expect(page.getByTestId('focus-native-controls')).toBeAttached();
    expect((await probe()).items.filter(item => item.id === 'focus-glass-host')).toHaveLength(1);
    if (process.env['FOCUS_GLASS_SCREENSHOTS'] === '1') {
      // Focus only after pointer/lifecycle assertions: activating a window can
      // legitimately send new native enter events for the real desktop pointer.
      await app.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0]!.focus(); });
      await page.getByTestId('focus-native-controls').hover();
      await expect.poll(async () => (await bar())?.alpha).toBe(1);
      await page.waitForTimeout(250);
      await screenshot('native-glass-active.png');
    }
    const statusHover = await app.evaluate(({}, file) => {
      const { createRequire } = process.getBuiltinModule('module');
      return JSON.parse(createRequire(file)(file).statusHover());
    }, probePath);
    expect(statusHover).toEqual({ stayedInside: true, trackingStable: true, controlsVisible: true, exited: true });
    await page.reload();
    await expect(page.getByText('Glass Fixture 0').first()).toBeVisible();
    await expect.poll(async () => (await probe()).items.filter(item => item.id.startsWith('focus-glass')).length).toBe(0);
    await expect.poll(async () => (await probe()).items.filter(item => item.id === 'player-sliders-host').length).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    if (app) { const child = app.process(); const timeout = setTimeout(() => child.kill('SIGKILL'), 5000); try { await app.close(); } finally { clearTimeout(timeout); } }
    await rm(root, { recursive: true, force: true });
  }
});
