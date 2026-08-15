import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);

function pngCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Dependency-free solid RGBA PNG, deliberately larger than the 512px cache ceiling. */
function makeLargeCoverFixture(width = 640, height = 640): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA

  const scanline = Buffer.alloc(1 + width * 4);
  for (let offset = 1; offset < scanline.length; offset += 4) {
    scanline[offset] = 35;
    scanline[offset + 1] = 90;
    scanline[offset + 2] = 155;
    scanline[offset + 3] = 255;
  }
  const pixels = Buffer.alloc(scanline.length * height);
  for (let row = 0; row < height; row++) scanline.copy(pixels, row * scanline.length);

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const electronExecutable = require('electron') as string;
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);

interface SmokeElectronAPI {
  platform?: unknown;
  getAppVersion?: () => Promise<unknown>;
  isMaximized?: () => Promise<unknown>;
  settingsGetAll?: () => Promise<unknown>;
}

interface FocusEntranceProbe {
  initialOffscreen: boolean | null;
  offscreenAfterFirstFrame: boolean | null;
  initialBackdropPixel: number[] | null;
}

async function closeElectronApp(electronApp: ElectronApplication | undefined): Promise<void> {
  if (!electronApp) return;

  const electronProcess = electronApp.process();
  let forceCloseTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    electronApp.close().catch(() => undefined),
    new Promise<void>((resolve) => {
      forceCloseTimer = setTimeout(() => {
        electronProcess.kill('SIGKILL');
        resolve();
      }, 5_000);
    }),
  ]).finally(() => {
    if (forceCloseTimer) clearTimeout(forceCloseTimer);
  });
}

test('boots built renderer through Electron preload and IPC', async ({}, testInfo) => {
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lyrics-adapter-e2e-')));
  const isolatedHome = path.join(tempRoot, 'home');
  const dirs = {
    userData: path.join(tempRoot, 'user-data'),
    appData: path.join(tempRoot, 'app-data'),
    localAppData: path.join(tempRoot, 'local-app-data'),
    xdgConfig: path.join(tempRoot, 'xdg-config'),
    xdgData: path.join(tempRoot, 'xdg-data'),
    xdgCache: path.join(tempRoot, 'xdg-cache'),
  };
  await Promise.all([isolatedHome, ...Object.values(dirs)].map((dir) => mkdir(dir, { recursive: true })));

  const fixtureTrackId = 'e2e-focus-track';
  const coversDirectory = path.join(dirs.userData, 'covers');
  // A data URL is same-origin/readable in Canvas, which lets the Focus probe
  // inspect alpha without weakening the assertion for a tainted remote image.
  // The persisted cover:// fixture remains independent and is probed below.
  const focusCanvasCoverDataUrl = `data:image/png;base64,${makeLargeCoverFixture(64, 64).toString('base64')}`;
  await mkdir(coversDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(coversDirectory, `${fixtureTrackId}.png`),
      makeLargeCoverFixture(),
    ),
    writeFile(path.join(dirs.userData, 'library-index.json'), JSON.stringify({
      songs: [{
        id: fixtureTrackId,
        title: 'Focus E2E Fixture',
        artist: 'LyricsAdapter',
        album: 'Smoke Test',
        duration: 120,
        lyrics: '',
        syncedLyrics: [],
        coverUrl: `cover://${fixtureTrackId}.png`,
        source: 'local',
        available: false,
      }],
      settings: {
        activeSlotId: 'local',
        localSlot: {
          currentTrackIndex: 0,
          currentTime: 0,
          volume: 0.5,
          playbackMode: 'order',
          scrollPosition: 0,
          filterType: 'default',
          categorySelection: null,
        },
      },
    })),
  ]);

  const launchEnv: Record<string, string> = {
    ...inheritedEnv,
    NODE_ENV: 'test',
    LYRICS_ADAPTER_E2E_STATIC: '1',
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    APPDATA: dirs.appData,
    LOCALAPPDATA: dirs.localAppData,
    XDG_CONFIG_HOME: dirs.xdgConfig,
    XDG_DATA_HOME: dirs.xdgData,
    XDG_CACHE_HOME: dirs.xdgCache,
  };
  delete launchEnv['ELECTRON_RUN_AS_NODE'];

  let electronApp: ElectronApplication | undefined;
  let page: Page | undefined;
  const pageErrors: string[] = [];

  try {
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      cwd: repoRoot,
      args: [
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
        `--user-data-dir=${dirs.userData}`,
        repoRoot,
      ],
      env: launchEnv,
    });

    page = await electronApp.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

    await expect(page).toHaveURL('app://localhost/index.html');
    await expect(page).toHaveTitle('LyricsAdapter');
    await expect(page.locator('#root > *').first()).toBeVisible();

    await expect.poll(() => page!.evaluate(() => {
      const api = (window as typeof window & { electron?: SmokeElectronAPI }).electron;
      return location.protocol === 'app:'
        && document.documentElement.classList.contains('electron')
        && typeof api?.platform === 'string';
    })).toBe(true);

    await expect.poll(() => page!.evaluate(async () => {
      const api = (window as typeof window & { electron?: SmokeElectronAPI }).electron;
      if (!api?.getAppVersion || !api.isMaximized || !api.settingsGetAll) return false;

      try {
        const [version, maximized, settings] = await Promise.all([
          api.getAppVersion(),
          api.isMaximized(),
          api.settingsGetAll(),
        ]);
        return typeof version === 'string'
          && version.length > 0
          && typeof maximized === 'boolean'
          && settings !== null
          && typeof settings === 'object'
          && !Array.isArray(settings);
      } catch {
        return false;
      }
    })).toBe(true);

    // Custom-protocol resources do not consistently appear in the Performance
    // Resource Timing buffer, so inspect the resolved module script URL.
    const scriptUrls = await page.locator('script[src]').evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).src),
    );
    expect(scriptUrls.some((url) => /^app:\/\/localhost\/assets\/index-[^/]+\.js$/.test(url))).toBe(true);
    expect(scriptUrls.some((url) => url.includes('/@vite/client') || url.includes('/src/index.tsx'))).toBe(false);

    const coverProbe = await page.evaluate(async (url) => {
      const response = await fetch(url);
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const metrics: {
        status: number;
        contentType: string | null;
        byteLength: number;
        prefix: number[];
        canonicalUrl: string;
        responseText?: string;
        width?: number;
        height?: number;
        decodeError?: string;
      } = {
        status: response.status,
        contentType: response.headers.get('content-type'),
        byteLength: bytes.length,
        prefix: Array.from(bytes.slice(0, 8)),
        canonicalUrl: new URL(url).href,
      };
      if (!response.ok) metrics.responseText = new TextDecoder().decode(bytes);
      try {
        const bitmap = await createImageBitmap(blob);
        metrics.width = bitmap.width;
        metrics.height = bitmap.height;
        bitmap.close();
      } catch (error) {
        metrics.decodeError = error instanceof Error ? error.message : String(error);
      }
      return metrics;
    }, `cover://${fixtureTrackId}.png?size=512`);
    expect(coverProbe).toMatchObject({
      status: 200,
      contentType: 'image/jpeg',
      canonicalUrl: `cover://${fixtureTrackId}.png/?size=512`,
      width: 512,
      height: 512,
    });
    expect(coverProbe.byteLength).toBeGreaterThan(0);
    expect(coverProbe.prefix.slice(0, 2)).toEqual([255, 216]);

    // The production library loader deliberately drops persisted data: covers.
    // Substitute only programmatic `new Image()` cover loads so Focus renders
    // the readable solid PNG, while the persisted cover:// protocol/cache probe
    // above and DOM cover images continue to exercise their real paths.
    await page.evaluate((dataUrl) => {
      const NativeImage = window.Image;
      class FocusCanvasTestImage extends NativeImage {
        override get src(): string {
          return super.src;
        }

        override set src(value: string) {
          super.src = value.startsWith('cover://') ? dataUrl : value;
        }
      }
      window.Image = FocusCanvasTestImage;
    }, focusCanvasCoverDataUrl);

    // Exercise the real FocusMode mount/transition/unmount path in the built
    // Electron renderer; cover:// resize/cache was already probed separately.
    const focusToggle = page.getByRole('button', {
      name: /Focus|专注|集中|집중|Fokus|concentré|フォーカス/i,
    }).first();
    await expect(focusToggle).toBeVisible();

    // Observe the mount before clicking. The Focus host deliberately presents
    // on its second RAF so Chromium commits one off-screen frame before the
    // 600ms slide begins; checking only the final class would miss regressions
    // where the overlay mounts directly at its destination.
    await page.evaluate(() => {
      const probeWindow = window as typeof window & {
        __focusEntranceProbe?: FocusEntranceProbe;
      };
      const probe: FocusEntranceProbe = {
        initialOffscreen: null,
        offscreenAfterFirstFrame: null,
        initialBackdropPixel: null,
      };
      probeWindow.__focusEntranceProbe = probe;

      const observer = new MutationObserver(() => {
        const overlay = document.querySelector<HTMLElement>('.focus-mode-overlay');
        if (!overlay) return;

        if (probe.initialOffscreen === null) {
          probe.initialOffscreen = overlay.classList.contains('translate-y-full');
          requestAnimationFrame(() => {
            probe.offscreenAfterFirstFrame = overlay.classList.contains('translate-y-full');
          });
        }

        const canvas = overlay.querySelector<HTMLCanvasElement>('canvas');
        if (canvas && probe.initialBackdropPixel === null) {
          const context = canvas.getContext('2d');
          if (context && canvas.width > 0 && canvas.height > 0) {
            probe.initialBackdropPixel = Array.from(context.getImageData(
              Math.floor(canvas.width / 2),
              Math.floor(canvas.height / 2),
              1,
              1,
            ).data);
            observer.disconnect();
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });

    await focusToggle.click();
    const focusOverlay = page.locator('.focus-mode-overlay');
    await expect(focusOverlay).toBeVisible();
    await expect.poll(() => page!.evaluate(() => {
      const probe = (window as typeof window & {
        __focusEntranceProbe?: FocusEntranceProbe;
      }).__focusEntranceProbe;
      return probe
        ? {
            initialOffscreen: probe.initialOffscreen,
            offscreenAfterFirstFrame: probe.offscreenAfterFirstFrame,
          }
        : null;
    })).toEqual({ initialOffscreen: true, offscreenAfterFirstFrame: true });
    await expect.poll(() => focusOverlay.evaluate((element) =>
      element.classList.contains('translate-y-0'))).toBe(true);

    const entranceStyles = await focusOverlay.evaluate((element) => {
      const overlayStyle = getComputedStyle(element);
      const content = Array.from(element.children).find((child) =>
        child.classList.contains('focus-mode-content'));
      if (!(content instanceof HTMLElement)) {
        throw new Error('Focus content layer was not mounted');
      }
      const contentStyle = getComputedStyle(content);
      return {
        overlayProperty: overlayStyle.transitionProperty,
        overlayDuration: overlayStyle.transitionDuration,
        contentProperty: contentStyle.transitionProperty,
        contentDuration: contentStyle.transitionDuration,
      };
    });
    expect(entranceStyles.overlayProperty.split(',').map(value => value.trim()))
      .toContain('transform');
    expect(entranceStyles.overlayDuration.split(',').map(value => value.trim()))
      .toContain('0.6s');
    expect(entranceStyles.contentProperty.split(',').map(value => value.trim()))
      .toContain('opacity');
    expect(entranceStyles.contentDuration.split(',').map(value => value.trim()))
      .toContain('0.6s');

    const backdropCanvas = focusOverlay.locator('canvas');
    await expect(backdropCanvas).toBeVisible();
    await expect.poll(() => page!.evaluate(() =>
      (window as typeof window & { __focusEntranceProbe?: FocusEntranceProbe })
        .__focusEntranceProbe?.initialBackdropPixel ?? null)).not.toBeNull();
    const initialBackdropPixel = await page.evaluate(() =>
      (window as typeof window & { __focusEntranceProbe?: FocusEntranceProbe })
        .__focusEntranceProbe?.initialBackdropPixel ?? null);
    if (!initialBackdropPixel) throw new Error('Focus entrance pixel probe did not run');
    // The page entrance and backdrop alpha settle within 600ms now that the
    // first cover no longer runs a separate 700ms brightness pass. Keep a little
    // scheduling margin before the final pixel probe.
    await page.waitForTimeout(800);
    const canvasMetrics = await backdropCanvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Focus backdrop did not expose a 2D context');

      const rect = canvas.getBoundingClientRect();
      const toBackingPoint = (viewportX: number, viewportY: number) => ({
        x: Math.max(0, Math.min(
          canvas.width - 1,
          Math.floor((viewportX - rect.left) * canvas.width / rect.width),
        )),
        y: Math.max(0, Math.min(
          canvas.height - 1,
          Math.floor((viewportY - rect.top) * canvas.height / rect.height),
        )),
      });
      const alphaAt = (viewportX: number, viewportY: number) => {
        const point = toBackingPoint(viewportX, viewportY);
        return context.getImageData(point.x, point.y, 1, 1).data[3] ?? 0;
      };
      const rgbaAt = (viewportX: number, viewportY: number) => {
        const point = toBackingPoint(viewportX, viewportY);
        return Array.from(context.getImageData(point.x, point.y, 1, 1).data);
      };
      const edgeInset = 1;
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      return {
        widthRatio: canvas.width / (window.innerWidth + 200),
        heightRatio: canvas.height / (window.innerHeight + 200),
        cssFilter: canvas.style.filter,
        centerRgba: rgbaAt(centerX, centerY),
        alpha: {
          center: alphaAt(centerX, centerY),
          top: alphaAt(centerX, edgeInset),
          right: alphaAt(window.innerWidth - edgeInset, centerY),
          bottom: alphaAt(centerX, window.innerHeight - edgeInset),
          left: alphaAt(edgeInset, centerY),
        },
      };
    });
    expect(canvasMetrics.widthRatio).toBeLessThanOrEqual(0.51);
    expect(canvasMetrics.heightRatio).toBeLessThanOrEqual(0.51);
    expect(canvasMetrics.cssFilter).toBe('');
    for (const [sample, alpha] of Object.entries(canvasMetrics.alpha)) {
      expect(alpha, `Focus backdrop ${sample} alpha`).toBeGreaterThanOrEqual(250);
    }
    // Alpha changes throughout entrance, but RGB must start at the resting
    // brightness and remain there. This catches the removed 0.3 -> 0.55
    // first-cover brightness animation without depending on RAF wall time.
    for (let channel = 0; channel < 3; channel++) {
      expect(Math.abs(
        canvasMetrics.centerRgba[channel]! - initialBackdropPixel[channel]!,
      ), `Focus backdrop RGB channel ${channel} stayed at resting brightness`)
        .toBeLessThanOrEqual(3);
    }
    await testInfo.attach('focus-entrance-metrics', {
      body: Buffer.from(JSON.stringify({
        entranceStyles,
        initialBackdropPixel,
        finalBackdropPixel: canvasMetrics.centerRgba,
      }, null, 2)),
      contentType: 'application/json',
    });
    await expect(page.locator('[data-focus-backdrop-overlay]'))
      .not.toHaveClass(/backdrop-blur-sm/);

    const thumbnailDirectory = path.join(coversDirectory, '.thumbnails');
    await expect.poll(async () => {
      const files = await readdir(thumbnailDirectory).catch(() => [] as string[]);
      return {
        has256: files.some(file => file.endsWith('-256.jpg')),
        has512: files.some(file => file.endsWith('-512.jpg')),
      };
    }, { timeout: 5_000 }).toEqual({ has256: true, has512: true });
    const thumbnailFiles = (await readdir(thumbnailDirectory))
      .filter(file => /-(?:256|512)\.jpg$/.test(file));
    const thumbnailStats = await Promise.all(
      thumbnailFiles.map(file => stat(path.join(thumbnailDirectory, file))),
    );
    expect(thumbnailStats.every(fileStat => fileStat.size > 0)).toBe(true);

    await focusToggle.click();
    await expect(focusOverlay).toHaveCount(0, { timeout: 2_000 });

    const actualUserData = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    expect(actualUserData).toBe(dirs.userData);
    expect(pageErrors).toEqual([]);
  } finally {
    try {
      if (page && !page.isClosed() && testInfo.status !== testInfo.expectedStatus) {
        await page.screenshot()
          .then((body) => testInfo.attach('electron-window', {
            body,
            contentType: 'image/png',
          }))
          .catch(() => undefined);
      }
    } finally {
      try {
        await closeElectronApp(electronApp);
      } finally {
        await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
});
