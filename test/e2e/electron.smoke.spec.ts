import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
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

const repoRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

async function readRepoTopLevelDirectories(): Promise<string[]> {
  const entries = await readdir(repoRoot, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function assertRepoTopLevelDirectoriesUnchanged(before: readonly string[]): Promise<void> {
  const beforeSet = new Set(before);
  const added = (await readRepoTopLevelDirectories()).filter(name => !beforeSet.has(name));
  expect(
    added,
    'Electron E2E must not create top-level directories in the repository. '
      + 'Unexpected directories are reported but never deleted because another process may own them.',
  ).toEqual([]);
}

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
function makeLargeCoverFixture(
  width = 640,
  height = 640,
  rgba: readonly [number, number, number, number] = [35, 90, 155, 255],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA

  const scanline = Buffer.alloc(1 + width * 4);
  for (let offset = 1; offset < scanline.length; offset += 4) {
    scanline[offset] = rgba[0];
    scanline[offset + 1] = rgba[1];
    scanline[offset + 2] = rgba[2];
    scanline[offset + 3] = rgba[3];
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
  pageSettleBackdropPixel: number[] | null;
  pageSettleSampleScheduled: boolean;
  underlyingBlurObserved: boolean;
  underlyingBlurFilter: string | null;
}

interface FocusBreathingSample {
  elapsed: number;
  rgba: number[];
}

interface FocusBreathingProbe {
  initialRgba: number[];
  samples: FocusBreathingSample[];
  transitionStartedAt: number | null;
  underlyingBlurObserved: boolean;
  completed: boolean;
  timedOut: boolean;
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
  const repoTopLevelDirectoriesBefore = await readRepoTopLevelDirectories();
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
  const secondFixtureTrackId = 'e2e-focus-track-next';
  const coversDirectory = path.join(dirs.userData, 'covers');
  // A data URL is same-origin/readable in Canvas, which lets the Focus probe
  // inspect alpha without weakening the assertion for a tainted remote image.
  // The persisted cover:// fixture remains independent and is probed below.
  const firstCoverColor = [35, 90, 155, 255] as const;
  const secondCoverColor = [190, 65, 35, 255] as const;
  const focusCanvasCoverDataUrls = {
    [fixtureTrackId]: `data:image/png;base64,${makeLargeCoverFixture(64, 64, firstCoverColor).toString('base64')}`,
    [secondFixtureTrackId]: `data:image/png;base64,${makeLargeCoverFixture(64, 64, secondCoverColor).toString('base64')}`,
  };
  await mkdir(coversDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(coversDirectory, `${fixtureTrackId}.png`),
      makeLargeCoverFixture(640, 640, firstCoverColor),
    ),
    writeFile(
      path.join(coversDirectory, `${secondFixtureTrackId}.png`),
      makeLargeCoverFixture(640, 640, secondCoverColor),
    ),
    writeFile(path.join(dirs.userData, 'library-index.json'), JSON.stringify({
      songs: [
        {
          id: fixtureTrackId,
          title: 'Focus E2E Fixture',
          artist: 'LyricsAdapter',
          album: 'Smoke Test',
          duration: 120,
          lyrics: 'Focus legacy renderer\nFocus AMLL renderer',
          syncedLyrics: [
            { time: 0, text: 'Focus legacy renderer' },
            { time: 4, text: 'Focus AMLL renderer' },
          ],
          coverUrl: `cover://${fixtureTrackId}.png`,
          source: 'local',
          available: false,
        },
        {
          id: secondFixtureTrackId,
          title: 'Focus E2E Fixture Next',
          artist: 'LyricsAdapter',
          album: 'Smoke Test',
          duration: 120,
          lyrics: 'Second Focus lyric\nRenderer switch fixture',
          syncedLyrics: [
            { time: 0, text: 'Second Focus lyric' },
            { time: 4, text: 'Renderer switch fixture' },
          ],
          coverUrl: `cover://${secondFixtureTrackId}.png`,
          source: 'local',
          available: false,
        },
      ],
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
      cwd: tempRoot,
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

    if (process.platform === 'win32') {
      // Windows taskbar lyrics now live in a separate C# WPF process. Ensure
      // Electron no longer creates the Chromium overlay that previously owned
      // this title; native host behavior is covered by the Windows build job.
      const chromiumTaskbarWindows = await electronApp.evaluate(({ BrowserWindow }) => (
        BrowserWindow.getAllWindows().filter(candidate =>
          candidate.getTitle() === 'LyricsAdapter Taskbar Lyrics').length
      ));
      expect(chromiumTaskbarWindows).toBe(0);
    }

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
    await page.evaluate((dataUrls) => {
      const NativeImage = window.Image;
      class FocusCanvasTestImage extends NativeImage {
        override get src(): string {
          return super.src;
        }

        override set src(value: string) {
          if (value.startsWith('cover://')) {
            const matchedDataUrl = Object.entries(dataUrls)
              .find(([trackId]) => value.startsWith(`cover://${trackId}.png`))?.[1];
            super.src = matchedDataUrl ?? value;
            return;
          }
          super.src = value;
        }
      }
      window.Image = FocusCanvasTestImage;
    }, focusCanvasCoverDataUrls);

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
        pageSettleBackdropPixel: null,
        pageSettleSampleScheduled: false,
        underlyingBlurObserved: false,
        underlyingBlurFilter: null,
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

        if (
          overlay.classList.contains('translate-y-0')
          && !probe.pageSettleSampleScheduled
        ) {
          probe.pageSettleSampleScheduled = true;
          window.setTimeout(() => {
            const sample = () => {
              const canvas = overlay.querySelector<HTMLCanvasElement>('canvas');
              const context = canvas?.getContext('2d');
              if (!canvas || !context || canvas.width === 0 || canvas.height === 0) {
                requestAnimationFrame(sample);
                return;
              }
              probe.pageSettleBackdropPixel = Array.from(context.getImageData(
                Math.floor(canvas.width / 2),
                Math.floor(canvas.height / 2),
                1,
                1,
              ).data);
              observer.disconnect();
            };
            sample();
          }, 600);
        }

        const underlyingBlur = overlay.querySelector<HTMLElement>(
          '[data-focus-library-backdrop-blur]',
        );
        if (underlyingBlur && !probe.underlyingBlurObserved) {
          const style = getComputedStyle(underlyingBlur);
          probe.underlyingBlurObserved = true;
          probe.underlyingBlurFilter = style.getPropertyValue('backdrop-filter')
            || style.getPropertyValue('-webkit-backdrop-filter');
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
          }
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    });

    await focusToggle.click();
    const focusOverlay = page.locator('.focus-mode-overlay');
    await expect(focusOverlay).toBeVisible();
    await expect(focusOverlay.locator('.amll-lyric-player')).toHaveCount(1, { timeout: 10_000 });
    await expect(focusOverlay.getByTestId('focus-legacy-lyrics')).toHaveCount(0);
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
    const entranceProbe = await page.evaluate(() =>
      (window as typeof window & { __focusEntranceProbe?: FocusEntranceProbe })
        .__focusEntranceProbe ?? null);
    expect(entranceProbe?.underlyingBlurObserved).toBe(true);
    expect(entranceProbe?.underlyingBlurFilter).toMatch(/blur\([^)]+\)/);
    await expect.poll(() => page!.evaluate(() =>
      (window as typeof window & { __focusEntranceProbe?: FocusEntranceProbe })
        .__focusEntranceProbe?.pageSettleBackdropPixel ?? null), { timeout: 2_000 })
      .not.toBeNull();
    const pageSettleBackdropPixel = await page.evaluate(() =>
      (window as typeof window & { __focusEntranceProbe?: FocusEntranceProbe })
        .__focusEntranceProbe?.pageSettleBackdropPixel ?? null);
    if (!pageSettleBackdropPixel) throw new Error('Focus page-settle pixel probe did not run');
    // A loaded renderer can shift this timer-to-RAF sample by several frames.
    // Keep a broad intermediate band that still catches skipped or already
    // completed reveals without treating CI scheduling as animation behavior.
    expect(pageSettleBackdropPixel[3]).toBeGreaterThanOrEqual(100);
    expect(pageSettleBackdropPixel[3]).toBeLessThanOrEqual(190);

    // The page itself settles at 600ms while the delayed Canvas reveal continues
    // to 1000ms. Poll the actual backing pixel instead of coupling to wall-clock
    // scheduling margin.
    await expect.poll(() => backdropCanvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) return 0;
      return context.getImageData(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1,
      ).data[3] ?? 0;
    }), { timeout: 2_000 }).toBeGreaterThanOrEqual(250);
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
        pageSettleBackdropPixel,
        finalBackdropPixel: canvasMetrics.centerRgba,
      }, null, 2)),
      contentType: 'application/json',
    });
    const focusBackdropOverlay = page.locator('[data-focus-backdrop-overlay]');
    await expect(focusBackdropOverlay).not.toHaveClass(/backdrop-blur-sm/);
    await expect(page.locator('[data-focus-library-backdrop-blur]')).toHaveCount(0);
    const backdropFilters = await focusBackdropOverlay.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        standard: style.getPropertyValue('backdrop-filter'),
        webkit: style.getPropertyValue('-webkit-backdrop-filter'),
      };
    });
    const hasCompositorBlur = [backdropFilters.standard, backdropFilters.webkit]
      .some(value => /blur\([^)]+\)/.test(value) && value !== 'none');
    expect(hasCompositorBlur).toBe(false);
    await testInfo.attach('focus-backdrop-filter-metrics', {
      body: Buffer.from(JSON.stringify(backdropFilters, null, 2)),
      contentType: 'application/json',
    });

    // Observe the real track-change Canvas frames. The probe anchors its
    // 1000ms timeline to the first changed pixel rather than the button click,
    // because a real Image.onload can begin a few frames later on a cold cache.
    await page.evaluate(() => {
      const probeWindow = window as typeof window & {
        __focusBreathingProbe?: FocusBreathingProbe;
      };
      const canvas = document.querySelector<HTMLCanvasElement>('.focus-mode-overlay canvas');
      const context = canvas?.getContext('2d');
      if (!canvas || !context) throw new Error('Focus backdrop was unavailable for breathing probe');

      const readCenter = () => Array.from(context.getImageData(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1,
      ).data);
      const initialRgba = readCenter();
      const probe: FocusBreathingProbe = {
        initialRgba,
        samples: [],
        transitionStartedAt: null,
        underlyingBlurObserved: false,
        completed: false,
        timedOut: false,
      };
      probeWindow.__focusBreathingProbe = probe;

      const handleNextClick = (event: MouseEvent) => {
        const button = event.target instanceof Element
          ? event.target.closest('button')
          : null;
        if (!button?.textContent?.includes('skip_next')) return;
        document.removeEventListener('click', handleNextClick, true);

        let samplingStartedAt: number | null = null;
        const sampleFrame = (now: number) => {
          if (samplingStartedAt === null) samplingStartedAt = now;
          const elapsed = now - samplingStartedAt;
          const rgba = readCenter();
          probe.samples.push({ elapsed, rgba });
          probe.underlyingBlurObserved ||= document.querySelector(
            '[data-focus-library-backdrop-blur]',
          ) !== null;

          if (probe.transitionStartedAt === null) {
            const alphaDelta = Math.abs((rgba[3] ?? 0) - (initialRgba[3] ?? 0));
            const rgbDelta = Math.max(
              ...rgba.slice(0, 3).map((channel, index) =>
                Math.abs(channel - (initialRgba[index] ?? 0))),
            );
            if (alphaDelta >= 2 || rgbDelta >= 2) {
              probe.transitionStartedAt = elapsed;
            }
          }

          if (
            probe.transitionStartedAt !== null
            && elapsed - probe.transitionStartedAt >= 1_150
          ) {
            probe.completed = true;
            return;
          }
          if (elapsed >= 3_000) {
            probe.completed = true;
            probe.timedOut = true;
            return;
          }
          requestAnimationFrame(sampleFrame);
        };
        requestAnimationFrame(sampleFrame);
      };
      document.addEventListener('click', handleNextClick, true);
    });

    const nextTrackButton = focusOverlay.locator('button', { hasText: 'skip_next' });
    await expect(nextTrackButton).toHaveCount(1);
    await nextTrackButton.click();
    await expect(focusOverlay.getByRole('heading', {
      name: 'Focus E2E Fixture Next',
      exact: true,
    })).toBeVisible();
    await expect.poll(() => page!.evaluate(() =>
      (window as typeof window & { __focusBreathingProbe?: FocusBreathingProbe })
        .__focusBreathingProbe?.completed ?? false), { timeout: 5_000 }).toBe(true);

    const breathingProbe = await page.evaluate(() =>
      (window as typeof window & { __focusBreathingProbe?: FocusBreathingProbe })
        .__focusBreathingProbe ?? null);
    if (!breathingProbe || breathingProbe.transitionStartedAt === null) {
      throw new Error('Focus track-change transition never changed a readable Canvas pixel');
    }
    expect(breathingProbe.timedOut).toBe(false);
    expect(breathingProbe.underlyingBlurObserved).toBe(true);
    await expect(page.locator('[data-focus-library-backdrop-blur]')).toHaveCount(0);

    const rgbDistance = (left: number[], right: number[]) => Math.hypot(
      ...left.slice(0, 3).map((channel, index) => channel - (right[index] ?? 0)),
    );
    const nearestSample = (targetElapsed: number) => breathingProbe.samples.reduce(
      (nearest, sample) => Math.abs(sample.elapsed - targetElapsed)
        < Math.abs(nearest.elapsed - targetElapsed) ? sample : nearest,
    );
    const transitionSamples = breathingProbe.samples.filter(
      sample => sample.elapsed >= breathingProbe.transitionStartedAt!,
    );
    const minimumAlphaSample = transitionSamples.reduce((minimum, sample) =>
      (sample.rgba[3] ?? 255) < (minimum.rgba[3] ?? 255) ? sample : minimum);
    const midpointSample = nearestSample(breathingProbe.transitionStartedAt + 500);
    const endingSample = nearestSample(breathingProbe.transitionStartedAt + 1_100);

    expect(breathingProbe.initialRgba[3]).toBeGreaterThanOrEqual(250);
    expect(midpointSample.rgba[3]).toBeGreaterThanOrEqual(180);
    expect(midpointSample.rgba[3]).toBeLessThanOrEqual(205);
    expect(midpointSample.rgba[3]).toBeLessThan((breathingProbe.initialRgba[3] ?? 0) - 40);
    expect(endingSample.rgba[3]).toBeGreaterThanOrEqual(250);
    expect(Math.abs(
      minimumAlphaSample.elapsed - (breathingProbe.transitionStartedAt + 500),
    )).toBeLessThan(120);

    // The two deliberately different solid covers make the cross-fade readable:
    // blue is dominant before the switch, red after it, and the midpoint is a
    // distinct dimmed blend rather than either endpoint copied unchanged.
    expect(breathingProbe.initialRgba[2]).toBeGreaterThan(breathingProbe.initialRgba[0] ?? 0);
    expect(endingSample.rgba[0]).toBeGreaterThan(endingSample.rgba[2] ?? 0);
    expect(rgbDistance(breathingProbe.initialRgba, endingSample.rgba)).toBeGreaterThan(40);
    expect(rgbDistance(breathingProbe.initialRgba, midpointSample.rgba)).toBeGreaterThan(15);
    expect(rgbDistance(midpointSample.rgba, endingSample.rgba)).toBeGreaterThan(15);

    const finalBreathingCanvasMetrics = await backdropCanvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Focus backdrop did not expose a 2D context');
      const rect = canvas.getBoundingClientRect();
      const alphaAt = (viewportX: number, viewportY: number) => {
        const x = Math.max(0, Math.min(
          canvas.width - 1,
          Math.floor((viewportX - rect.left) * canvas.width / rect.width),
        ));
        const y = Math.max(0, Math.min(
          canvas.height - 1,
          Math.floor((viewportY - rect.top) * canvas.height / rect.height),
        ));
        return context.getImageData(x, y, 1, 1).data[3] ?? 0;
      };
      const edgeInset = 1;
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      return {
        widthRatio: canvas.width / (window.innerWidth + 200),
        heightRatio: canvas.height / (window.innerHeight + 200),
        alpha: {
          center: alphaAt(centerX, centerY),
          top: alphaAt(centerX, edgeInset),
          right: alphaAt(window.innerWidth - edgeInset, centerY),
          bottom: alphaAt(centerX, window.innerHeight - edgeInset),
          left: alphaAt(edgeInset, centerY),
        },
      };
    });
    expect(finalBreathingCanvasMetrics.widthRatio).toBeCloseTo(0.5, 2);
    expect(finalBreathingCanvasMetrics.heightRatio).toBeCloseTo(0.5, 2);
    for (const [sample, alpha] of Object.entries(finalBreathingCanvasMetrics.alpha)) {
      expect(alpha, `Settled Focus backdrop ${sample} alpha`).toBeGreaterThanOrEqual(250);
    }
    await testInfo.attach('focus-track-change-breathing-metrics', {
      body: Buffer.from(JSON.stringify({
        transitionStartedAt: breathingProbe.transitionStartedAt,
        initial: breathingProbe.initialRgba,
        midpoint: midpointSample,
        minimum: minimumAlphaSample,
        ending: endingSample,
        finalCanvas: finalBreathingCanvasMetrics,
        sampleCount: breathingProbe.samples.length,
      }, null, 2)),
      contentType: 'application/json',
    });

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

    // Interrupt a real exit with the same CmdOrCtrl+Enter shortcut used by the
    // app. Exit alpha must fall quickly, then the existing overlay must reverse
    // in place without replaying the full entry timeline.
    const focusShortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await focusOverlay.evaluate((element) => {
      element.setAttribute('data-focus-interruption-probe', 'same-overlay');
    });
    await page.keyboard.press(focusShortcut);
    await page.waitForTimeout(50);
    const readBackdropCenterAlpha = () => backdropCanvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Focus backdrop did not expose a 2D context');
      return context.getImageData(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1,
      ).data[3] ?? 0;
    });
    const immediateExitAlpha = await readBackdropCenterAlpha();

    await page.waitForTimeout(100);
    const interruptedExitAlpha = await readBackdropCenterAlpha();
    expect(interruptedExitAlpha).toBeLessThan(200);

    await page.keyboard.press(focusShortcut);
    await expect(focusOverlay).toHaveAttribute('data-focus-interruption-probe', 'same-overlay');
    await page.waitForTimeout(500);
    const interruptedReturnAlpha = await readBackdropCenterAlpha();
    expect(interruptedReturnAlpha).toBeGreaterThanOrEqual(250);
    await expect(page.locator('[data-focus-library-backdrop-blur]')).toHaveCount(0);
    await testInfo.attach('focus-interruption-metrics', {
      body: Buffer.from(JSON.stringify({
        immediateExitAlpha,
        interruptedExitAlpha,
        interruptedReturnAlpha,
      }, null, 2)),
      contentType: 'application/json',
    });

    await focusToggle.click();
    await expect(focusOverlay).toHaveCount(0, { timeout: 2_000 });

    // The experimental setting is on by default, persists through the main
    // settings store, and swaps the renderer without keeping both trees mounted.
    const settingsButton = page.getByRole('button', {
      name: /Settings|设置|設定|설정|Einstellungen|Paramètres/i,
    }).first();
    await settingsButton.click();
    const amllLyricsSwitch = page.getByRole('switch', { name: /AMLL/i });
    await expect(amllLyricsSwitch).toHaveAttribute('aria-checked', 'true');
    await amllLyricsSwitch.click();
    await expect(amllLyricsSwitch).toHaveAttribute('aria-checked', 'false');
    await expect.poll(() => page!.evaluate(async () => {
      const api = (window as typeof window & { electron?: SmokeElectronAPI }).electron;
      const settings = await api?.settingsGetAll?.();
      return (settings as Record<string, string> | undefined)?.['la_focus_amll_lyrics_enabled'];
    })).toBe('false');
    await page.getByRole('button', { name: 'Close settings panel' }).click();

    await focusToggle.click();
    await expect(focusOverlay).toBeVisible();
    await expect(focusOverlay.getByTestId('focus-legacy-lyrics')).toHaveCount(1);
    await expect(focusOverlay.locator('.amll-lyric-player')).toHaveCount(0);
    await focusToggle.click();
    await expect(focusOverlay).toHaveCount(0, { timeout: 2_000 });

    await settingsButton.click();
    await expect(amllLyricsSwitch).toHaveAttribute('aria-checked', 'false');
    await amllLyricsSwitch.click();
    await expect(amllLyricsSwitch).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => page!.evaluate(async () => {
      const api = (window as typeof window & { electron?: SmokeElectronAPI }).electron;
      const settings = await api?.settingsGetAll?.();
      return (settings as Record<string, string> | undefined)?.['la_focus_amll_lyrics_enabled'];
    })).toBe('true');
    await page.getByRole('button', { name: 'Close settings panel' }).click();

    await focusToggle.click();
    await expect(focusOverlay).toBeVisible();
    await expect(focusOverlay.locator('.amll-lyric-player')).toHaveCount(1, { timeout: 10_000 });
    await expect(focusOverlay.getByTestId('focus-legacy-lyrics')).toHaveCount(0);

    const readFocusLyricsMetrics = () => page!.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('.focus-lyrics-viewport');
      const player = document.querySelector<HTMLElement>('.focus-amll-lyrics');
      if (!viewport || !player) throw new Error('Focus lyrics layout is incomplete');
      const viewportStyle = getComputedStyle(viewport);
      const playerStyle = getComputedStyle(player);
      return {
        viewportHeight: viewport.getBoundingClientRect().height,
        fontSize: playerStyle.fontSize,
        viewportPaddingLeft: viewportStyle.paddingLeft,
        lineSpacingAdjustment: playerStyle.getPropertyValue('--focus-amll-line-spacing-adjustment'),
        maskImage: viewportStyle.maskImage || viewportStyle.webkitMaskImage,
      };
    });

    const defaultLyricsMetrics = await readFocusLyricsMetrics();
    expect(defaultLyricsMetrics.fontSize).toBe('24px');
    expect(defaultLyricsMetrics.lineSpacingAdjustment).toBe('3px');
    await electronApp.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows().find(candidate =>
        candidate.webContents.getURL() === 'app://localhost/index.html');
      if (!mainWindow) throw new Error('LyricsAdapter main window was not found');
      mainWindow.setSize(1500, 1000);
    });
    await expect.poll(() => page!.evaluate(() =>
      Math.abs(window.innerWidth - 1500) <= 1 && window.innerHeight === 1000))
      .toBe(true);
    const enlargedLyricsMetrics = await readFocusLyricsMetrics();
    expect(enlargedLyricsMetrics.viewportHeight).toBeGreaterThan(defaultLyricsMetrics.viewportHeight);
    expect(enlargedLyricsMetrics.fontSize).toBe(defaultLyricsMetrics.fontSize);
    expect(enlargedLyricsMetrics.viewportPaddingLeft).toBe(defaultLyricsMetrics.viewportPaddingLeft);
    expect(enlargedLyricsMetrics.lineSpacingAdjustment).toBe(defaultLyricsMetrics.lineSpacingAdjustment);
    expect(enlargedLyricsMetrics.maskImage).toContain('72px');

    await electronApp.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows().find(candidate =>
        candidate.webContents.getURL() === 'app://localhost/index.html');
      if (!mainWindow) throw new Error('LyricsAdapter main window was not found');
      mainWindow.setSize(1200, 800);
    });
    await expect.poll(() => page!.evaluate(() =>
      Math.abs(window.innerWidth - 1200) <= 1 && window.innerHeight === 800))
      .toBe(true);
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
        try {
          await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
        } finally {
          await assertRepoTopLevelDirectoriesUnchanged(repoTopLevelDirectoriesBefore);
        }
      }
    }
  }
});
