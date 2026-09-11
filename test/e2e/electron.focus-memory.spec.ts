import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function silentWav(seconds: number): Buffer {
  const sampleRate = 8_000;
  const dataBytes = seconds * sampleRate * 2;
  const result = Buffer.alloc(44 + dataBytes);
  result.write('RIFF', 0);
  result.writeUInt32LE(36 + dataBytes, 4);
  result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(1, 22);
  result.writeUInt32LE(sampleRate, 24);
  result.writeUInt32LE(sampleRate * 2, 28);
  result.writeUInt16LE(2, 32);
  result.writeUInt16LE(16, 34);
  result.write('data', 36);
  result.writeUInt32LE(dataBytes, 40);
  return result;
}

test('AMLL uses the animation budget by default and ignores the retired setting', async ({}, testInfo) => {
  test.setTimeout(100_000);
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lyrics-amll-memory-')));
  const isolatedHome = path.join(tempRoot, 'home');
  const userData = path.join(tempRoot, 'user-data');
  const covers = path.join(userData, 'covers');
  await Promise.all([isolatedHome, covers].map(dir => mkdir(dir, { recursive: true })));
  const audioPath = path.join(tempRoot, 'fixture.wav');
  const secondAudioPath = path.join(tempRoot, 'fixture-next.wav');
  const lineTimedAudioPath = path.join(tempRoot, 'fixture-line-timed.wav');
  await Promise.all([audioPath, secondAudioPath, lineTimedAudioPath].map(file => writeFile(file, silentWav(120))));
  const songs = [audioPath, secondAudioPath, lineTimedAudioPath].map((filePath, trackIndex) => ({
    id: `focus-memory-${trackIndex}`,
    filePath,
    title: `AMLL Memory Fixture ${trackIndex}`,
    artist: 'LyricsAdapter', album: 'Memory optimization', duration: 120,
    source: 'local', available: true,
    coverUrl: `cover://focus-memory-${trackIndex}.png`,
    syncedLyrics: Array.from({ length: 40 }, (_, index) => ({
      time: index * 3,
      text: `Line ${index + 1} 沿着夜色听见远方的声音`,
      ...(trackIndex === 2 ? {} : { words: [`Line ${index + 1} `, '沿', '着', '夜', '色', '听', '见', '远', '方', '的', '声', '音'].map((text, word) => ({
        time: index * 3 + word * 0.25, duration: 0.25, text,
      })) }),
    })),
  }));
  await Promise.all(songs.map(song => copyFile(path.join(repoRoot, 'app-icon.png'), path.join(covers, `${song.id}.png`))));
  await writeFile(path.join(userData, 'library-index.json'), JSON.stringify({
    songs,
    settings: { activeSlotId: 'local', localSlot: {
      currentTrackIndex: 0, currentTime: 0, volume: 0, playbackMode: 'order',
      scrollPosition: 0, filterType: 'default', categorySelection: null,
    } },
  }));
  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({
    la_focus_lyrics_font_size: '36',
    la_focus_lyric_line_spacing: '30',
    la_focus_inactive_lyric_blur: '2',
  }));
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE'];
  Object.assign(env, {
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1',
    HOME: isolatedHome, USERPROFILE: isolatedHome,
    APPDATA: path.join(tempRoot, 'app-data'), LOCALAPPDATA: path.join(tempRoot, 'local-app-data'),
    XDG_CONFIG_HOME: path.join(tempRoot, 'config'), XDG_DATA_HOME: path.join(tempRoot, 'data'),
    XDG_CACHE_HOME: path.join(tempRoot, 'cache'),
  });
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ cwd: tempRoot, args: [
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      `--user-data-dir=${userData}`, repoRoot,
    ], env });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page).toHaveURL('app://localhost/index.html');
    await expect(page.getByText(songs[0]!.title).first()).toBeVisible();
    await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(2);
    const focusToggle = page.getByRole('button', { name: /Focus|专注|集中|집중|Fokus|concentré|フォーカス/i }).first();
    const focus = page.locator('.focus-mode-overlay');
    const lyrics = focus.locator('.amll-lyric-player');
    const staticLines = lyrics.locator('[data-focus-amll-static]');
    const activeLines = lyrics.locator('[class*="_lyricLine"][class*="_active"]');
    const settingsButton = page.getByRole('button', { name: /Settings|设置|設定|설정|Einstellungen|Paramètres/i }).first();
    const memorySwitch = page.locator('[role="switch"][aria-describedby="focus-amll-memory-description"]');
    const cdp = await page.context().newCDPSession(page);
    let layerCount = 0;
    cdp.on('LayerTree.layerTreeDidChange', event => { layerCount = event.layers?.length ?? 0; });
    await cdp.send('LayerTree.enable');
    const samples: Array<{ phase: string; animations: number; staticLines: number; activeLines: number; layers: number }> = [];
    const sample = async (phase: string) => {
      const metrics = await lyrics.evaluate(el => ({
        animations: el.getAnimations({ subtree: true }).length,
        staticLines: el.querySelectorAll('[data-focus-amll-static]').length,
        activeLines: el.querySelectorAll('[class*="_lyricLine"][class*="_active"]').length,
        lineGeometry: Array.from(el.querySelectorAll('[class*="_lyricMainLine"]')).slice(0, 6).map(line => {
          const rect = line.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }),
        activeAnimations: Array.from(el.querySelectorAll('[class*="_lyricLine"][class*="_active"]')).flatMap(line =>
          line.getAnimations({ subtree: true }).map(a => ({ id: a.id, time: a.currentTime, state: a.playState }))),
      }));
      samples.push({ phase, ...metrics, layers: layerCount });
      return metrics;
    };
    await settingsButton.click();
    await expect(page.getByRole('button', { name: 'Close settings panel' })).toBeVisible();
    await expect(memorySwitch).toHaveCount(0);
    await page.getByRole('button', { name: 'Close settings panel' }).click();

    // No animation-budget opt-in is needed on a fresh installation.
    await focusToggle.click();
    await expect(lyrics).toHaveCount(1);
    await expect.poll(() => staticLines.count()).toBeGreaterThan(0);
    await expect.poll(() => activeLines.count()).toBeGreaterThan(0);
    await page.waitForTimeout(2_000);
    await sample('default-paused');
    await focus.screenshot({ path: testInfo.outputPath('word-timed-lyrics.png') });
    expect(await staticLines.first().evaluate(el => el.getAnimations({ subtree: true })
      .filter(a => a.id === 'float-word' || a.id.startsWith('fade-word-')).length)).toBe(0);

    // Use the actual player intent, audio protocol and media clock, not a mocked RAF.
    await focus.locator('button').filter({ has: page.getByText('play_arrow', { exact: true }) }).click({ force: true });
    await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(3.3);
    await expect.poll(() => activeLines.count()).toBeGreaterThan(0);
    await sample('optimized-playing');
    expect(await activeLines.evaluateAll(lines => lines.every(line => !line.hasAttribute('data-focus-amll-static')))).toBe(true);
    expect(await activeLines.first().evaluate(el => el.getAnimations({ subtree: true })
      .some(a => a.id.startsWith('fade-word-') && a.playState === 'running'))).toBe(true);

    // Click a previously static upcoming line, then seek backward to one already sung.
    const thirdLine = lyrics.locator('[class*="_lyricLine"]').filter({ hasText: /^Line 3 / }).last();
    await thirdLine.click();
    await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(6);
    await expect(thirdLine).not.toHaveAttribute('data-focus-amll-static');
    await lyrics.evaluate(el => {
      // Dispatch the same delegated lyric click even if the first line is clipped.
      const first = Array.from(el.querySelectorAll('[class*="_lyricLine"]')).find(node => /^Line 1 /.test(node.textContent ?? '') && !node.className.includes('Wrapper'));
      first?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeLessThan(3);
    expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
    await sample('optimized-after-seeks');

    await focus.locator('button').filter({ has: page.getByText('pause', { exact: true }) }).click({ force: true });
    await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
    await lyrics.hover();
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(3_600);
    await expect.poll(() => staticLines.count()).toBeGreaterThan(0);
    await sample('optimized-after-scroll');
    await focus.locator('button').filter({ has: page.getByText('skip_next', { exact: true }) }).click({ force: true });
    await expect(focus.getByText(songs[1]!.title, { exact: true })).toBeVisible();
    await expect.poll(() => staticLines.count()).toBeGreaterThan(0);
    await sample('optimized-next-track');
    await focusToggle.click();
    await expect(focus).toHaveCount(0);
    await focusToggle.click();
    await expect.poll(() => staticLines.count()).toBeGreaterThan(0);
    await expect.poll(() => activeLines.count()).toBeGreaterThan(0);
    await sample('optimized-remounted');

    // Ordinary LRC balancing inserts <br>s. Resize during playback and sample
    // many frames: those breaks must never acquire the extra word-mask fade.
    await focus.locator('button').filter({ has: page.getByText('skip_next', { exact: true }) }).click({ force: true });
    await expect(focus.getByText(songs[2]!.title, { exact: true })).toBeVisible();
    for (const width of [1080, 1200]) {
      await app.evaluate(({ BrowserWindow }, nextWidth) => {
        BrowserWindow.getAllWindows()[0]!.setSize(nextWidth, 800);
      }, width);
      await expect.poll(() => lyrics.locator('[class*="_lyricMainLine"] br').count()).toBeGreaterThan(0);
      const staysUnfiltered = await lyrics.evaluate(async el => {
        for (let frame = 0; frame < 40; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          if (el.querySelector('[data-focus-amll-static]')) return false;
          for (const main of el.querySelectorAll<HTMLElement>('[class*="_lyricMainLine"]')) {
            if (getComputedStyle(main).filter !== 'none') return false;
          }
        }
        return true;
      });
      expect(staysUnfiltered).toBe(true);
    }
    await focus.screenshot({ path: testInfo.outputPath('line-timed-lyrics.png') });
    await focus.locator('button').filter({ has: page.getByText('skip_previous', { exact: true }) }).click({ force: true });
    await expect(focus.getByText(songs[1]!.title, { exact: true })).toBeVisible();
    await expect.poll(() => staticLines.count()).toBeGreaterThan(0);

    // Simulate an existing installation whose old experiment was disabled.
    // Persist through the real bridge so this covers the SQLite reload path.
    await focusToggle.click();
    await expect(focus).toHaveCount(0);
    expect(await page.evaluate(async () => {
      const api = (window as typeof window & {
        electron?: {
          settingsSet: (key: string, value: string) => Promise<void>;
          settingsGetAll: () => Promise<Record<string, string>>;
        };
      }).electron;
      await api?.settingsSet('la_focus_amll_memory_enabled', 'false');
      return (await api?.settingsGetAll())?.['la_focus_amll_memory_enabled'];
    })).toBe('false');
    await page.reload();
    await expect(page.getByText(songs[0]!.title).first()).toBeVisible();
    await focusToggle.click();
    await expect(lyrics).toHaveCount(1);
    await expect.poll(() => staticLines.count()).toBeGreaterThan(0);
    await expect.poll(() => activeLines.count()).toBeGreaterThan(0);
    await sample('retired-setting-ignored');
    expect(errors).toEqual([]);
    const samplePath = testInfo.outputPath('animation-budget-samples.json');
    await writeFile(samplePath, JSON.stringify({ samples }, null, 2));
    await testInfo.attach('animation-budget-samples', { path: samplePath, contentType: 'application/json' });
  } finally {
    if (app) {
      const child = app.process();
      const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 5_000);
      try { await app.close(); } finally { clearTimeout(timeout); }
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
