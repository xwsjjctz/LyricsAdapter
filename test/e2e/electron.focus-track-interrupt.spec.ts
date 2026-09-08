import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

/**
 * Focus Mode track-change interruption probe.
 *
 * Entering/exiting Focus Mode already supports interrupting an in-flight
 * animation. Track changes used to snap: when the next cover finished loading
 * mid cross-fade, the partially faded cover was promoted to "current" and the
 * on-screen pixels jumped. The backdrop now bakes the visible blend into a new
 * base, so the pixel must move continuously across an interrupted switch.
 *
 * The assertion is timing-robust on purpose: it records the centre pixel every
 * animation frame and checks that no consecutive pair jumps. A snap produces a
 * one-frame delta far larger than a 1000ms cross-fade can.
 */

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

/** Solid-colour PNG so the canvas centre pixel is a stable, readable signal. */
function solidCoverPng(size: number, color: readonly [number, number, number, number]): Buffer {
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buffer: Buffer): number => {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xFF]! ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) {
    row[1 + x * 4] = color[0];
    row[1 + x * 4 + 1] = color[1];
    row[1 + x * 4 + 2] = color[2];
    row[1 + x * 4 + 3] = color[3];
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const FIRST_COLOR = [35, 90, 155, 255] as const;
const SECOND_COLOR = [190, 65, 35, 255] as const;
const THIRD_COLOR = [40, 165, 80, 255] as const;

test('interrupting a Focus Mode track change keeps the backdrop pixels continuous', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lyrics-track-interrupt-')));
  const isolatedHome = path.join(tempRoot, 'home');
  const userData = path.join(tempRoot, 'user-data');
  const covers = path.join(userData, 'covers');
  await Promise.all([isolatedHome, covers].map(dir => mkdir(dir, { recursive: true })));

  const tracks = [
    { id: 'interrupt-a', title: 'Interrupt A', color: FIRST_COLOR },
    { id: 'interrupt-b', title: 'Interrupt B', color: SECOND_COLOR },
    { id: 'interrupt-c', title: 'Interrupt C', color: THIRD_COLOR },
  ];
  const audioPath = path.join(tempRoot, 'fixture.wav');
  await writeFile(audioPath, silentWav(120));
  await Promise.all(tracks.map(track => writeFile(
    path.join(covers, `${track.id}.png`),
    solidCoverPng(64, track.color),
  )));
  await writeFile(path.join(userData, 'library-index.json'), JSON.stringify({
    songs: tracks.map(track => ({
      id: track.id,
      filePath: audioPath,
      title: track.title,
      artist: 'LyricsAdapter',
      album: 'Interrupt probe',
      duration: 120,
      source: 'local',
      available: false,
      coverUrl: `cover://${track.id}.png`,
      lyrics: `${track.title} line one\n${track.title} line two`,
      syncedLyrics: [
        { time: 0, text: `${track.title} line one` },
        { time: 4, text: `${track.title} line two` },
      ],
    })),
    settings: {
      activeSlotId: 'local',
      localSlot: {
        currentTrackIndex: 0, currentTime: 0, volume: 0, playbackMode: 'order',
        scrollPosition: 0, filterType: 'default', categorySelection: null,
      },
    },
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
    app = await electron.launch({
      cwd: tempRoot,
      args: [
        // Utility processes cannot initialize Chromium's own sandbox when the
        // test run is nested inside an outer OS sandbox; this probe loads no
        // remote content.
        '--no-sandbox',
        `--user-data-dir=${userData}`, repoRoot,
      ],
      env,
    });
    const page: Page = await app.firstWindow();
    await expect(page).toHaveURL('app://localhost/index.html');
    await expect(page.getByText('Interrupt A').first()).toBeVisible();

    const focusToggle = page.getByRole('button', {
      name: /Focus|专注|集中|집중|Fokus|concentré|フォーカス/i,
    }).first();
    const focusOverlay = page.locator('.focus-mode-overlay');
    await expect(focusToggle).toBeVisible();

    // cover:// is not readable from Canvas.getImageData, so map the fixture
    // covers to same-origin data URLs for the programmatic `new Image()` path
    // (the protocol/cache path is covered by electron.smoke.spec.ts). This must
    // be installed before Focus Mode loads its first cover, otherwise the
    // backdrop canvas is tainted for the rest of the session.
    await page.evaluate((colors) => {
      const NativeImage = window.Image;
      const dataUrls = Object.fromEntries(Object.entries(colors).map(([id, color]) => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext('2d')!;
        context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 1)`;
        context.fillRect(0, 0, 64, 64);
        return [id, canvas.toDataURL('image/png')];
      }));
      class ProbeImage extends NativeImage {
        override set src(value: string) {
          const match = /^cover:\/\/([^./?]+)\.png/.exec(value);
          super.src = match ? (dataUrls[match[1]!] ?? value) : value;
        }
        override get src(): string {
          return super.src;
        }
      }
      window.Image = ProbeImage;
    }, {
      'interrupt-a': FIRST_COLOR,
      'interrupt-b': SECOND_COLOR,
      'interrupt-c': THIRD_COLOR,
    });

    await focusToggle.click();
    await expect(focusOverlay).toBeVisible();

    const backdropCanvas = focusOverlay.locator('canvas');
    await expect(backdropCanvas).toBeVisible();

    const readCenter = () => backdropCanvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Focus backdrop did not expose a 2D context');
      return Array.from(context.getImageData(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1,
      ).data);
    });

    // Wait for the first cover to settle, then confirm the two fixtures really
    // are distinguishable at the centre pixel.
    await page.waitForTimeout(1_500);
    const firstSettled = await readCenter();
    expect(firstSettled[2]).toBeGreaterThan(firstSettled[0]!); // blue dominant

    const nextButton = focusOverlay.locator('button', { hasText: 'skip_next' });
    await expect(nextButton).toHaveCount(1);

    // First switch runs to completion so the probe starts from a settled cover.
    await nextButton.click();
    await page.waitForTimeout(1_400);
    const secondSettled = await readCenter();
    expect(secondSettled[0]).toBeGreaterThan(secondSettled[2]!); // red dominant
    const settledDistance = Math.hypot(
      ...firstSettled.slice(0, 3).map((channel, index) => channel - (secondSettled[index] ?? 0)),
    );
    expect(settledDistance).toBeGreaterThan(40);

    const sampleCenterPixels = () => backdropCanvas.evaluate(async (element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d')!;
      const samples: { t: number; rgba: number[] }[] = [];
      const startedAt = performance.now();
      while (performance.now() - startedAt < 1_800) {
        samples.push({
          t: performance.now() - startedAt,
          rgba: Array.from(context.getImageData(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            1,
            1,
          ).data),
        });
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      return samples;
    });

    /**
     * A real snap moves a large colour distance within a normal frame. A
     * time-based fade that could not paint during a main-thread stall (the
     * click/track load itself blocks for >100ms) catches up on the next painted
     * frame, so a large delta there is expected. Flag only jumps that are NOT
     * preceded by a stall.
     */
    const findUnexplainedJump = (
      samples: { t: number; rgba: number[] }[],
    ): { delta: number; index: number; gapMs: number; previousGapMs: number } | null => {
      for (let index = 1; index < samples.length; index++) {
        const previous = samples[index - 1]!;
        const current = samples[index]!;
        const delta = Math.hypot(
          ...previous.rgba.slice(0, 3).map((channel, channelIndex) =>
            channel - (current.rgba[channelIndex] ?? 0)),
        );
        if (delta <= 25) continue;
        const gapMs = current.t - previous.t;
        const previousGapMs = index >= 2 ? previous.t - samples[index - 2]!.t : 0;
        if (Math.max(gapMs, previousGapMs) <= 50) {
          return { delta, index, gapMs, previousGapMs };
        }
      }
      return null;
    };

    // Case 1 (bake): B settled -> C fading in -> jump to A. The target is
    // neither the base (B) nor the incoming (C), so the on-screen blend must be
    // baked before A fades in.
    const bakeSamplesPromise = sampleCenterPixels();
    await nextButton.click();
    await page.waitForTimeout(400);
    await nextButton.click();
    const bakeSamples = await bakeSamplesPromise;
    expect(bakeSamples.length).toBeGreaterThan(30);
    const bakeJump = findUnexplainedJump(bakeSamples);
    expect(
      bakeJump,
      `Interrupted switch to a third track snapped instead of cross-fading: ${JSON.stringify(bakeJump)}`,
    ).toBeNull();

    // It must still settle on the track it switched to (A / blue).
    await page.waitForTimeout(1_400);
    const settledAfterBake = await readCenter();
    expect(settledAfterBake[2]).toBeGreaterThan(settledAfterBake[0]!); // blue dominant

    // Case 2 (reverse): A settled -> B fading in -> jump back to A (the fade
    // base) with the previous button. The in-flight fade must reverse instead
    // of snapping.
    const previousButton = focusOverlay.locator('button', { hasText: 'skip_previous' });
    await expect(previousButton).toHaveCount(1);
    const reverseSamplesPromise = sampleCenterPixels();
    await nextButton.click();
    await page.waitForTimeout(400);
    await previousButton.click();
    const reverseSamples = await reverseSamplesPromise;
    expect(reverseSamples.length).toBeGreaterThan(30);
    const reverseJump = findUnexplainedJump(reverseSamples);
    expect(
      reverseJump,
      `Returning to the fade base snapped instead of reversing: ${JSON.stringify(reverseJump)}`,
    ).toBeNull();

    await page.waitForTimeout(1_400);
    const settledAfterReverse = await readCenter();
    expect(settledAfterReverse[2]).toBeGreaterThan(settledAfterReverse[0]!); // blue dominant

    await testInfo.attach('focus-track-interrupt-metrics', {
      body: Buffer.from(JSON.stringify({
        firstSettled,
        secondSettled,
        settledDistance,
        bakeSamples: bakeSamples.length,
        bakeJump,
        settledAfterBake,
        reverseSamples: reverseSamples.length,
        reverseJump,
        settledAfterReverse,
      }, null, 2)),
      contentType: 'application/json',
    });
  } finally {
    await app?.close().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});
