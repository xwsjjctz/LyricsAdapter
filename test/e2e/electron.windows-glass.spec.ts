import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('Windows glass samples the live page, keeps native proportions and routes both bars to the player', async ({}, testInfo) => {
  test.skip(process.platform !== 'win32', 'Windows SVG glass renderer');
  test.setTimeout(90_000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-windows-glass-')));
  const isolatedHome = path.join(root, 'home'), userData = path.join(root, 'data');
  await mkdir(path.join(isolatedHome, '.la'), { recursive: true });
  await mkdir(path.join(userData, 'covers'), { recursive: true });
  await writeFile(path.join(isolatedHome, '.la/settings.json'), JSON.stringify({ 'app-language': 'en' }));
  const audio = Buffer.alloc(44 + 8000 * 2 * 120);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  const songs = ['Midnight Glass', 'Daylight Glass'].map((title, index) => ({
    id: `glass-${index}`, title, artist: 'LyricsAdapter', album: 'Windows glass', duration: 120,
    source: 'local', available: true, filePath: path.join(root, `${index}.wav`), coverUrl: `cover://glass-${index}.png`,
    syncedLyrics: [{ time: 0, text: '让音乐留在此刻' }, { time: 30, text: '陪你走过漫长的旅程' }],
  }));
  for (const song of songs) {
    await writeFile(song.filePath, audio);
    await copyFile(path.join(repo, 'app-icon.png'), path.join(userData, 'covers', `${song.id}.png`));
  }
  // An opaque white cover exercises the real main-process contrast analysis.
  await writeFile(path.join(userData, 'covers', 'glass-1.png'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAATSURBVChTY/hPADCgC6CD4aEAAIS1/wHUqyB5AAAAAElFTkSuQmCC', 'base64'));
  await writeFile(path.join(userData, 'library-index.json'), JSON.stringify({ songs, settings: {
    activeSlotId: 'local', localSlot: { currentTrackIndex: 0, currentTime: 12, volume: .4,
      playbackMode: 'order', scrollPosition: 0, filterType: 'default', categorySelection: null },
  } }));
  const env = Object.fromEntries(Object.entries({ ...process.env,
    HOME: isolatedHome, USERPROFILE: isolatedHome, APPDATA: path.join(root, 'app-data'), LOCALAPPDATA: path.join(root, 'local'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'xdg'), XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE'];
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ cwd: root, args: [`--user-data-dir=${userData}`, repo], env });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 800));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('html')).toHaveAttribute('data-startup', 'ready');
    const audioState = () => page.locator('audio').evaluate((node: HTMLAudioElement) => ({ paused: node.paused, time: node.currentTime, volume: node.volume }));
    const main = page.getByTestId('main-controlbar');
    await expect(main).toHaveAttribute('data-glass-material', 'regular');
    await expect(main).toHaveCSS('border-radius', '22px');
    await expect.poll(() => main.evaluate(node => getComputedStyle(node, '::before').backdropFilter)).toContain('url(');
    const bounds = (await main.boundingBox())!;
    expect(bounds.width).toBe(720); expect(bounds.height).toBe(72);
    // [x, y, width, height] from the bar's top-left, in the bar's own unscaled points.
    const frames = (node: HTMLElement | SVGElement, selectors: Record<string, string>) => {
      const origin = node.getBoundingClientRect(), scale = origin.width / (node as HTMLElement).offsetWidth;
      return Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
        const rect = node.querySelector(selector)!.getBoundingClientRect();
        return [name, [rect.left - origin.left, rect.top - origin.top, rect.width, rect.height].map(value => Math.round(value / scale * 10) / 10)];
      }));
    };
    // LAPlayerControlbarHost -layout for a 720x72 bar, around its centre line.
    expect(await main.evaluate(frames, {
      cover: '.player-track-cover', title: '.player-track-title', artist: '.player-track-artist',
      previous: '.player-transport button:first-child', play: '[data-testid="main-play-button"]', next: '.player-transport button:last-child',
      elapsed: '.player-progress-controls > span:first-child', seek: '[data-testid="main-seek-anchor"]', total: '.player-progress-controls > span:last-child',
      volume: '[data-testid="main-volume-button"]', mode: '.macos-volume-mode button',
    })).toEqual({
      cover: [14, 14, 44, 44], title: [70, 15, 116, 18], artist: [70, 37, 116, 16],
      previous: [192, 20, 30, 32], play: [224, 17, 38, 38], next: [264, 20, 32, 32],
      elapsed: [300, 29, 36, 14], seek: [338, 24, 260, 24], total: [602, 29, 38, 14],
      volume: [644, 20, 32, 32], mode: [676, 20, 32, 32],
    });
    await expect(main.locator('.player-progress-controls > span').first()).toHaveCSS('text-align', 'center');
    await expect(main.locator('.player-transport .material-symbols-rounded').first()).toHaveCSS('font-variation-settings', '"FILL" 1');
    await expect(main.getByTestId('main-play-button')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    // The bar and its popup keep the night tint in the light default theme.
    expect(await main.evaluate(node => getComputedStyle(node).getPropertyValue('--glass-tint').trim())).toBe('rgba(0, 0, 0, .3)');
    // The rim starts from LAGlassHighlightView's top stop.
    expect(await main.evaluate(node => getComputedStyle(node, '::after').backgroundImage)).toContain('rgba(255, 255, 255, 0.24)');
    await page.screenshot({ path: testInfo.outputPath('windows-regular.png') });

    const filterId = await main.evaluate(node => getComputedStyle(node, '::before').backdropFilter.match(/#([^"\)]+)/)![1]!);
    const originalMap = await page.locator(`[id="${filterId}"] feImage`).getAttribute('href');
    await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="main-controlbar"]')!;
      const background = document.createElement('div'); background.id = 'glass-test-background';
      Object.assign(background.style, { position: 'absolute', inset: '0', zIndex: '30', background: 'rgb(240, 32, 48)', pointerEvents: 'none' });
      bar.parentElement!.insertBefore(background, bar);
    });
    const sample = async (x = bounds.x + 360, y = bounds.y + 12) => {
      await page.waitForTimeout(100);
      const screenshot = await page.screenshot({ scale: 'css' });
      return app!.evaluate(({ nativeImage }, args) => {
        const image = nativeImage.createFromBuffer(Buffer.from(args.png, 'base64'));
        const offset = (args.y * image.getSize().width + args.x) * 4;
        const bitmap = image.toBitmap();
        return [bitmap[offset + 2]!, bitmap[offset + 1]!, bitmap[offset]!];
      }, { png: screenshot.toString('base64'), x: Math.round(x), y: Math.round(y) });
    };
    // The dark material dims the backdrop, so the colour differences are smaller than the raw page's.
    const red = await sample();
    expect(red[0]! - red[2]!).toBeGreaterThan(50);
    // A reversible diagnostic matrix proves that the SVG receives the backdrop,
    // rather than merely checking whether the CSS URL parses.
    const backdropMatrix = page.locator(`[id="${filterId}"] feColorMatrix`).first();
    const saturation = (await backdropMatrix.getAttribute('values'))!;
    await backdropMatrix.evaluate(node => {
      node.setAttribute('type', 'matrix'); node.setAttribute('values', '-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0');
    });
    const inverted = await sample();
    expect(red[0]! - inverted[0]!).toBeGreaterThan(50);
    await backdropMatrix.evaluate((node, values) => { node.setAttribute('type', 'saturate'); node.setAttribute('values', values); }, saturation);
    await page.locator('#glass-test-background').evaluate(node => { (node as HTMLElement).style.background = 'rgb(32, 80, 224)'; });
    const blue = await sample();
    expect(blue[2]! - blue[0]!).toBeGreaterThan(50);
    await page.locator('#glass-test-background').evaluate(node => node.remove());
    await testInfo.attach('live-backdrop-pixels', { body: JSON.stringify({ red, inverted, blue }), contentType: 'application/json' });
    await main.getByTestId('main-volume-button').hover();
    const popup = page.locator('.macos-volume-slider-shell');
    await expect(popup).toBeVisible(); await expect(popup).toHaveCSS('opacity', '1');
    await expect(popup).toHaveCSS('backdrop-filter', /url\(/);
    const popupBounds = (await popup.boundingBox())!;
    expect(popupBounds.width).toBe(44); expect(popupBounds.height).toBe(149);
    // Centred over the speaker, floating 8px above the bar.
    expect(popupBounds.x - bounds.x).toBe(638); expect(bounds.y - popupBounds.y - popupBounds.height).toBe(8);
    await page.screenshot({ path: testInfo.outputPath('windows-volume.png') });
    await page.keyboard.press('Escape');
    await main.getByTestId('main-play-button').click();
    await expect.poll(async () => (await audioState()).paused).toBe(false);
    await page.waitForTimeout(400);
    await expect(page.locator(`[id="${filterId}"] feImage`)).toHaveAttribute('href', originalMap!);
    await main.getByTestId('main-play-button').click();
    await expect.poll(async () => (await audioState()).paused).toBe(true);

    await page.keyboard.press('ControlOrMeta+Enter');
    const focus = page.getByTestId('focus-web-controls');
    await expect(focus).toHaveAttribute('data-glass-material', 'clear');
    await focus.hover(); await expect(focus).toHaveCSS('opacity', '1');
    await expect(focus).toHaveCSS('backdrop-filter', /url\(/);
    await expect(focus).toHaveCSS('border-radius', '24px');
    const focusBounds = (await focus.boundingBox())!;
    expect(focusBounds.width).toBe(350); expect(focusBounds.height).toBe(96);
    const focusSelectors = {
      elapsed: '.focus-glass-elapsed', seek: '.focus-glass-seek', total: '.focus-glass-total', mode: '.focus-glass-mode',
      previous: '.focus-glass-previous', play: '.focus-glass-play', next: '.focus-glass-next', mute: '.focus-glass-mute', volume: '.focus-glass-volume',
    };
    // LAFocusGlassHost -layout in its 350x96 content space.
    const focusFrames = {
      elapsed: [12, 15, 40, 14], seek: [56, 13, 238, 18], total: [298, 15, 40, 14], mode: [16, 46, 32, 36],
      previous: [72, 46, 36, 36], play: [116, 42, 44, 44], next: [168, 46, 36, 36], mute: [224, 46, 32, 36], volume: [266, 54, 68, 20],
    };
    expect(await focus.evaluate(frames, focusSelectors)).toEqual(focusFrames);
    expect(await focus.evaluate(node => node.closest('.focus-mode-content') === null)).toBe(true);
    // Keyboard focus keeps controls awake during the longer pixel/frame probes.
    const seek = focus.getByRole('slider', { name: 'Playback position' });
    await seek.focus();
    const focusFilterId = await focus.evaluate(node => getComputedStyle(node).backdropFilter.match(/#([^"\)]+)/)![1]!);
    const focusMap = await page.locator(`[id="${focusFilterId}"] feImage`).getAttribute('href');
    await page.locator('.focus-mode-overlay').evaluate(node => {
      const background = document.createElement('div'); background.id = 'focus-test-background';
      Object.assign(background.style, { position: 'absolute', inset: '0', zIndex: '15', pointerEvents: 'none',
        background: 'repeating-linear-gradient(90deg, #000 0 16px, #fff 16px 32px)' });
      node.appendChild(background);
    });
    const refracted = await sample(focusBounds.x + 5, focusBounds.y + 36);
    // Both the frosted body and the clear rim pass through the same lens.
    const lenses = page.locator(`[id="${focusFilterId}"] feDisplacementMap`);
    const lensScale = (await lenses.first().getAttribute('scale'))!;
    await lenses.evaluateAll(nodes => nodes.forEach(node => node.setAttribute('scale', '0')));
    const unrefracted = await sample(focusBounds.x + 5, focusBounds.y + 36);
    expect(Math.max(...refracted.map((value, index) => Math.abs(value - unrefracted[index]!)))).toBeGreaterThan(8);
    await lenses.evaluateAll((nodes, scale) => nodes.forEach(node => node.setAttribute('scale', scale)), lensScale);
    // Compare frame cadence while the backdrop really changes, with the same
    // blur as the CSS fallback. Record timings instead of imposing a CI GPU limit.
    const timings = await focus.evaluate(async node => {
      const panel = node as HTMLElement;
      const background = document.getElementById('focus-test-background')!;
      const original = panel.style.getPropertyValue('--liquid-glass-filter');
      const measure = async (filter: string) => {
        panel.style.setProperty('--liquid-glass-filter', filter);
        const intervals: number[] = [];
        await new Promise<void>(resolve => {
          let previous = 0, frame = 0;
          const tick = (now: number) => {
            if (previous && frame > 3) intervals.push(now - previous);
            previous = now; background.style.backgroundPosition = `${frame * 3}px 0`;
            if (++frame < 45) requestAnimationFrame(tick); else resolve();
          };
          requestAnimationFrame(tick);
        });
        intervals.sort((a, b) => a - b);
        return { median: intervals[Math.floor(intervals.length / 2)], p95: intervals[Math.floor(intervals.length * .95)] };
      };
      try { return { svg: await measure(original), css: await measure('blur(3px) saturate(140%)') }; }
      finally { panel.style.setProperty('--liquid-glass-filter', original); }
    });
    await testInfo.attach('backdrop-frame-intervals-ms', { body: JSON.stringify(timings), contentType: 'application/json' });
    console.log('Windows glass backdrop frame intervals (ms):', timings);
    await page.locator('#focus-test-background').evaluate(node => node.remove());
    await testInfo.attach('rim-refraction-pixels', { body: JSON.stringify({ refracted, unrefracted }), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath('windows-clear.png') });
    await seek.press('Home'); await seek.press('ArrowRight');
    await expect.poll(async () => (await audioState()).time).toBeCloseTo(.1, 1);
    const volume = focus.getByRole('slider', { name: 'Volume', exact: true });
    await volume.press('End'); await expect.poll(async () => (await audioState()).volume).toBe(1);
    await focus.getByRole('button', { name: 'Mute', exact: true }).click();
    await expect.poll(async () => (await audioState()).volume).toBe(0);
    await focus.getByRole('button', { name: 'Unmute', exact: true }).click();
    await expect.poll(async () => (await audioState()).volume).toBe(1);
    await focus.getByTestId('focus-play-button').click(); await expect.poll(async () => (await audioState()).paused).toBe(false);
    await focus.getByTestId('focus-play-button').click(); await expect.poll(async () => (await audioState()).paused).toBe(true);
    await focus.getByRole('button', { name: 'Next Track' }).click();
    await expect(main).toContainText(songs[1]!.title);
    await expect(focus).toHaveCSS('color', 'rgba(15, 23, 42, 0.92)');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: testInfo.outputPath('windows-clear-light-cover.png') });
    await focus.getByRole('button', { name: 'Previous Track' }).click();
    await expect(main).toContainText(songs[0]!.title);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1700, 1150));
    await expect.poll(async () => (await focus.boundingBox())!.width).toBeCloseTo(472.5, 0);
    await expect.poll(async () => (await focus.boundingBox())!.height).toBeCloseTo(129.6, 0);
    // Like AppKit's content bounds, the whole layout scales with the bar.
    expect(await focus.evaluate(frames, focusSelectors)).toEqual(focusFrames);
    await expect(page.locator(`[id="${focusFilterId}"] feImage`)).toHaveAttribute('href', focusMap!);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 800));
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(main).toHaveClass(/translate-y-0/);
    await expect(page.locator('.liquid-glass-definitions')).toHaveCount(2);
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(page.locator('.liquid-glass-definitions')).toHaveCount(3);
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(page.locator('.liquid-glass-definitions')).toHaveCount(2);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await main.getByTestId('main-volume-button').hover();
    await expect(popup).toHaveCSS('transition-duration', '0s');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    expect(await main.evaluate(node => getComputedStyle(node, '::before').backdropFilter)).toBe('none');
    await expect(popup).toHaveCSS('backdrop-filter', 'none');
    await cdp.detach();
    expect(errors).toEqual([]);
  } finally {
    await app?.close(); await rm(root, { recursive: true, force: true });
  }
});
