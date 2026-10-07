import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
interface FooterFadeProbe {
  done: boolean;
  samples: { opacity: number; alpha: number; maskSize: string; clip: string }[];
}

for (const renderer of ['amll', 'legacy'] as const) {
  test(`${renderer} Focus switches proportions in place and routes portrait controls to the player`, async ({}, testInfo) => {
    test.setTimeout(90_000);
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-focus-responsive-')));
    const isolatedHome = path.join(root, 'home');
    const userData = path.join(root, 'user-data');
    const covers = path.join(userData, 'covers');
    await mkdir(path.join(isolatedHome, '.la'), { recursive: true });
    await mkdir(covers, { recursive: true });
    await writeFile(path.join(isolatedHome, '.la/settings.json'), JSON.stringify({
      'app-language': 'en', la_focus_amll_lyrics_enabled: String(renderer === 'amll'),
      la_focus_lyrics_font_size: '32',
    }));
    const pcmBytes = 8000 * 2 * 120;
    const audio = Buffer.alloc(44 + pcmBytes);
    audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
    audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(pcmBytes, 40);
    const songs = ['A song for the long journey beyond the stars', 'Instrumental'].map((title, index) => ({
      id: `responsive-${index}`, title, artist: 'LyricsAdapter / 纵向排版', album: 'Responsive Focus',
      duration: 120, source: 'local', available: true, filePath: path.join(root, `${index}.wav`),
      coverUrl: `cover://responsive-${index}.png`,
      ...(index === 0 ? { syncedLyrics: Array.from({ length: 20 }, (_, line) => ({
        time: line * 6, text: `${line + 1} 陪你走过每一段漫长的旅程直到看见明亮的星光`,
        words: [...'陪你走过每一段漫长的旅程直到看见明亮的星光'].map((text, word) => ({
          time: line * 6 + word * .2, duration: .2, text: word === 0 ? `${line + 1} ${text}` : text,
        })),
      })) } : {}),
    }));
    for (const song of songs) {
      await writeFile(song.filePath, audio);
      await copyFile(path.join(repo, 'app-icon.png'), path.join(covers, `${song.id}.png`));
    }
    await writeFile(path.join(userData, 'library-index.json'), JSON.stringify({ songs, settings: {
      activeSlotId: 'local', localSlot: { currentTrackIndex: 0, currentTime: 12, volume: .5,
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
      app = await electron.launch({ cwd: root, args: [
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userData}`, repo,
      ], env });
      const page = await app.firstWindow();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const audioState = () => page.locator('audio').evaluate((node: HTMLAudioElement) => ({
        paused: node.paused, time: node.currentTime, volume: node.volume, src: node.currentSrc,
      }));
      await expect(page.locator('.wall-tile')).toHaveCount(2);
      await expect.poll(() => page.locator('audio').evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(2);
      await page.keyboard.press('ControlOrMeta+Enter');
      const focus = page.locator('.focus-mode-overlay');
      await expect(focus).toHaveClass(/translate-y-0/);
      await expect.poll(async () => Math.abs((await focus.boundingBox())!.y)).toBeLessThan(.5);
      // Hidden controls remain inert, so hover their geometric bounds rather
      // than relying on the control element being a pointer-event target.
      const hoverPortraitControls = async () => {
        const rect = (await page.getByTestId('focus-portrait-controls').boundingBox())!;
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      };
      const lyricsRoot = page.locator(renderer === 'amll' ? '.amll-lyric-player' : '[data-testid="focus-legacy-lyrics"]');
      await expect(lyricsRoot).toBeVisible();
      await lyricsRoot.evaluate(node => node.setAttribute('data-test-original-renderer', 'true'));
      // Establish a paused checkpoint before checking that resizing cannot seek or play.
      if (!(await audioState()).paused) await page.keyboard.press('Space');
      await expect.poll(async () => (await audioState()).paused).toBe(true);
      const before = await audioState();
      expect(before.paused).toBe(true);
      const lyricPosition = () => lyricsRoot.evaluate(node => {
        const active = node.querySelector('[aria-current="true"], [class*="_lyricLine"][class*="_active"]')!;
        const row = active.closest('[class*="_lyricLineWrapper"]') ?? active;
        const bounds = row.getBoundingClientRect();
        const viewport = node.getBoundingClientRect();
        const list = node.querySelector('.will-change-transform');
        return { top: bounds.top - viewport.top, height: bounds.height, viewportHeight: viewport.height,
          listPadding: list ? Number.parseFloat(getComputedStyle(list).paddingTop) : 0,
          text: row.textContent };
      });
      const expectLyricAnchor = async (portrait: boolean) => {
        await expect.poll(async () => {
          const position = await lyricPosition();
          const anchor = portrait ? position.top : position.top + position.height / 2;
          const expected = position.viewportHeight * (portrait || renderer === 'legacy' ? .1 : .35)
            + (!portrait && renderer === 'legacy' ? position.listPadding : 0);
          return Math.abs(anchor - expected);
        }).toBeLessThan(4);
      };
      for (const [width, height] of [[393, 851], [480, 720], [600, 800], [800, 800], [900, 720], [1200, 800], [600, 800]] as const) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height), { width, height });
        const portrait = width <= height;
        await expect(focus).toHaveAttribute('data-focus-layout', portrait ? 'portrait' : 'landscape');
        await expect(lyricsRoot).toHaveAttribute('data-test-original-renderer', 'true');
        await page.mouse.move(20, 180);
        if (portrait) {
          await hoverPortraitControls();
          await expect(page.getByTestId('focus-portrait-controls')).toHaveCSS('opacity', '1');
        }
        // Measure the layout after the lyric footer finishes fading.
        await expect.poll(() => focus.locator('.focus-lyrics-viewport').evaluate(node =>
          node.getAnimations().filter(animation => animation.playState === 'running').length,
        )).toBe(0);
        const bounds = await focus.evaluate(node => {
          const rect = (selector: string) => {
            const element = node.querySelector(selector)!;
            const r = element.getBoundingClientRect();
            return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
          };
          const lyrics = node.querySelector('.focus-lyrics-viewport')!;
          const style = getComputedStyle(lyrics);
          return { width: innerWidth, height: innerHeight, cover: rect('.focus-cover-stage'), meta: rect('.focus-track-meta'),
            lyrics: rect('.focus-lyrics-viewport'), controls: node.querySelector('.focus-portrait-controls') ? rect('.focus-portrait-controls') : null,
            // The clipped backdrop deliberately overscans by 100px for blur.
            // Only document overflow is a user-visible horizontal scroll bug.
            footerAlpha: Number(style.getPropertyValue('--focus-lyrics-controls-alpha')),
            shieldHeight: Number.parseFloat(getComputedStyle(lyrics, '::after').height),
            footerTarget: document.elementFromPoint(lyrics.getBoundingClientRect().left + 1, lyrics.getBoundingClientRect().bottom - 4)?.className,
            scrollWidth: document.documentElement.scrollWidth };
        });
        expect(bounds.width).toBe(width); expect(bounds.height).toBe(height);
        expect(bounds.scrollWidth).toBeLessThanOrEqual(width);
        expect(bounds.cover.x).toBeGreaterThanOrEqual(0); expect(bounds.meta.right).toBeLessThanOrEqual(width);
        expect(bounds.lyrics.right).toBeLessThanOrEqual(width);
        if (portrait) {
          expect(bounds.cover.width).toBe(88);
          expect(bounds.meta.x).toBeGreaterThanOrEqual(bounds.cover.right);
          expect(bounds.lyrics.y).toBeGreaterThanOrEqual(bounds.meta.bottom);
          expect(bounds.controls!.height).toBe(210);
          expect(bounds.controls!.bottom).toBe(height - 24);
          expect(bounds.controls!.x).toBeGreaterThanOrEqual(20);
          expect(bounds.footerAlpha).toBe(0);
          expect(bounds.lyrics.bottom - bounds.shieldHeight).toBeLessThanOrEqual(bounds.controls!.y + 1);
          // The transparent footer must intercept clicks before they reach a lyric row.
          expect(bounds.footerTarget).toContain('focus-lyrics-viewport');
          if (process.platform === 'darwin') {
            const controls = page.getByTestId('focus-portrait-controls');
            await expect(controls.locator('[data-system-symbol]')).toHaveCount(6);
            expect(await controls.evaluate(node => getComputedStyle(node).fontFamily)).toContain('-apple-system');
          }
        } else {
          expect(bounds.meta.y).toBeGreaterThanOrEqual(bounds.cover.bottom);
          expect(bounds.lyrics.x).toBeGreaterThan(bounds.cover.right);
          expect(bounds.controls).toBeNull();
        }
        // A wrapped current lyric starts near the top in portrait, while both
        // desktop renderers keep their original centre anchors. Resize must
        // reposition a paused line without remounting or changing playback.
        await expectLyricAnchor(portrait);
        expect(await audioState()).toEqual(before);
        if (width === 393 || width === 1200) {
          await page.waitForTimeout(700);
          await page.screenshot({ path: testInfo.outputPath(`${renderer}-${width}x${height}.png`) });
        }
      }
      // A new sung line and the return from manual browsing use the same
      // portrait anchor, including after resizing back from desktop.
      const previousLine = (await lyricPosition()).text;
      await page.keyboard.press('Space');
      await expect.poll(async () => (await lyricPosition()).text).not.toBe(previousLine);
      await expectLyricAnchor(true);
      await page.keyboard.press('Space');
      await expect.poll(async () => (await audioState()).paused).toBe(true);
      await page.mouse.move(100, 250);
      await page.mouse.wheel(0, 180);
      await expect.poll(async () => {
        const position = await lyricPosition();
        return Math.abs(position.top - position.viewportHeight * .1);
      }).toBeGreaterThan(20);
      await expectLyricAnchor(true);
      // Lyric scrolling cannot reveal portrait controls.
      await expect(focus.locator('.focus-mode-content')).toHaveAttribute('data-focus-controls-visible', 'false');
      // Both layouts hide on the same one-second deadline. Moving outside
      // controls must release hover protection; playback cannot restart it.
      const content = focus.locator('.focus-mode-content');
      for (const [width, height] of [[600, 800], [1200, 800]] as const) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height), { width, height });
        await expect(focus).toHaveAttribute('data-focus-layout', width < height ? 'portrait' : 'landscape');
        if (width < height) await hoverPortraitControls();
        await page.mouse.move(20, 180);
        await expect(content).toHaveAttribute('data-focus-controls-visible', 'true');
        await page.waitForTimeout(700);
        await expect(content).toHaveAttribute('data-focus-controls-visible', 'true');
        await expect(content).toHaveAttribute('data-focus-controls-visible', 'false', { timeout: 800 });
      }
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(600, 800));
      await expect(focus).toHaveAttribute('data-focus-layout', 'portrait');
      const portraitControls = page.getByTestId('focus-portrait-controls');
      await expect(content).toHaveAttribute('data-focus-controls-visible', 'false');
      await expect(portraitControls).toHaveCSS('opacity', '0');
      // Sample a real wake-up: the footer and controls cross-fade while its
      // mask boundary stays fixed, rather than sliding up over the lyrics.
      await focus.evaluate(node => {
        const probe: FooterFadeProbe = { done: false, samples: [] };
        (window as typeof window & { footerFadeProbe: FooterFadeProbe }).footerFadeProbe = probe;
        let start: number | null = null;
        const sample = (now: number) => {
          const shown = node.querySelector('.focus-mode-content')?.getAttribute('data-focus-controls-visible') === 'true';
          if (shown) {
            start ??= now;
            const style = getComputedStyle(node.querySelector('.focus-lyrics-viewport')!);
            probe.samples.push({
              alpha: Number(style.getPropertyValue('--focus-lyrics-controls-alpha')),
              opacity: Number(getComputedStyle(node.querySelector('.focus-portrait-controls')!).opacity),
              maskSize: style.maskSize, clip: style.clipPath,
            });
            if (now - start >= 250) { probe.done = true; return; }
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await hoverPortraitControls();
      await expect.poll(() => page.evaluate(() => (window as typeof window & { footerFadeProbe: FooterFadeProbe }).footerFadeProbe.done)).toBe(true);
      const samples = await page.evaluate(() => (window as typeof window & { footerFadeProbe: FooterFadeProbe }).footerFadeProbe.samples);
      expect(samples.some(sample => sample.alpha > .05 && sample.alpha < .95 && sample.opacity > .05 && sample.opacity < .95)).toBe(true);
      expect(samples.every(sample => sample.maskSize === '100% 100%' && sample.clip === 'none')).toBe(true);
      expect(samples.at(-1)!.alpha).toBe(0);
      expect(samples.at(-1)!.opacity).toBe(1);
      await page.mouse.move(20, 180);
      await hoverPortraitControls();
      await expect(page.getByTestId('focus-portrait-controls')).toHaveCSS('opacity', '1');
      // The Apple Music-style capsule expands through a drag, including an
      // out-of-bounds pointer move, then returns to its slim presentation.
      for (const id of ['focus-seek-slider', 'focus-volume-slider']) {
        const slider = page.getByTestId(id);
        const track = slider.locator('..').locator('.player-slider-track');
        const rect = (await slider.boundingBox())!;
        await expect(track).toHaveCSS('height', '5px');
        await page.mouse.move(rect.x + rect.width * .25, rect.y + rect.height / 2);
        await page.mouse.down();
        await expect(track).toHaveCSS('height', '10px');
        expect((await slider.boundingBox())!.height).toBe(44);
        await page.mouse.move(rect.x + rect.width * .6, rect.y - 30, { steps: 4 });
        await expect(track).toHaveCSS('height', '10px');
        await page.mouse.up();
        await expect(track).toHaveCSS('height', '5px');
        expect((await slider.boundingBox())!.height).toBe(44);
        if (id === 'focus-seek-slider') {
          await expect.poll(async () => (await audioState()).time).toBeGreaterThan(60);
          expect((await audioState()).time).toBeLessThan(90);
          expect((await audioState()).paused).toBe(true);
        } else {
          await expect.poll(async () => (await audioState()).volume).toBeGreaterThan(.3);
          expect((await audioState()).volume).toBeLessThan(.5);
        }
      }
      const seek = page.getByTestId('focus-seek-slider');
      await seek.focus(); await seek.press('Home'); await seek.press('ArrowRight');
      await expect.poll(async () => (await audioState()).time).toBeCloseTo(.1, 1);
      expect((await audioState()).paused).toBe(true);
      const volume = page.getByTestId('focus-volume-slider');
      await volume.focus(); await volume.press('Home'); await volume.press('ArrowRight');
      await expect.poll(async () => (await audioState()).volume).toBeCloseTo(.01 ** 2, 5);
      await page.getByTestId('focus-play-button').click();
      await expect.poll(async () => (await audioState()).paused).toBe(false);
      await page.getByTestId('focus-play-button').click();
      await expect.poll(async () => (await audioState()).paused).toBe(true);
      await focus.getByRole('button', { name: 'Next Track' }).click();
      await expect(focus.locator('.focus-track-meta h1')).toHaveText('Instrumental');
      await expect(focus.locator('.focus-lyrics-viewport')).toHaveCount(0);
      await expect(page.getByTestId('focus-portrait-controls')).toBeVisible();
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(focus).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(focus).toHaveAttribute('data-focus-layout', 'portrait');
      await hoverPortraitControls();
      await expect(page.getByTestId('focus-portrait-controls')).toHaveCSS('opacity', '1');
      expect(errors).toEqual([]);
    } finally {
      await app?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
