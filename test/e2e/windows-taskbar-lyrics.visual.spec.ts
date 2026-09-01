import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test';

const repoRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const packagedExecutablePath = process.env['LYRICS_ADAPTER_E2E_EXECUTABLE_PATH']
  ? path.resolve(process.env['LYRICS_ADAPTER_E2E_EXECUTABLE_PATH'])
  : undefined;
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);

interface TaskbarEdgeImage {
  width: number;
  height: number;
  bitmapBase64: string;
  pngBase64: string;
}

interface TaskbarEdgeCapture {
  displayId: string;
  scaleFactor: number;
  top: TaskbarEdgeImage;
  bottom: TaskbarEdgeImage;
}

interface PixelDifference {
  changedPixels: number;
  maximumChannelDelta: number;
  bounds: { left: number; top: number; right: number; bottom: number } | null;
}

interface TaskbarLyricsTestAPI {
  ipc?: {
    systemLyrics?: {
      update?: (state: {
        trackId: string | null;
        coverUrl: string;
        title: string;
        artist: string;
        line: string;
        nextLine: string;
        lineCursor: number | null;
        lineProgress: number | null;
        isPlaying: boolean;
      }) => Promise<{ ok: boolean; error?: string }>;
    };
  };
}

async function closeElectronApp(electronApp: ElectronApplication | undefined): Promise<void> {
  if (!electronApp) return;
  const process = electronApp.process();
  let forceCloseTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    electronApp.close().catch(() => undefined),
    new Promise<void>((resolve) => {
      forceCloseTimer = setTimeout(() => {
        process.kill('SIGKILL');
        resolve();
      }, 5_000);
    }),
  ]).finally(() => {
    if (forceCloseTimer) clearTimeout(forceCloseTimer);
  });
}

async function captureTaskbarEdges(
  electronApp: ElectronApplication,
): Promise<TaskbarEdgeCapture> {
  return electronApp.evaluate(async ({ desktopCapturer, screen }) => {
    const display = screen.getPrimaryDisplay();
    const requestedSize = {
      width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
      height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor)),
    };
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: requestedSize,
      fetchWindowIcons: false,
    });
    const source = sources.find(candidate => candidate.display_id === String(display.id))
      ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error('Primary desktop capture is unavailable');
    }

    const thumbnail = source.thumbnail;
    const size = thumbnail.getSize();
    const edgeHeight = Math.min(
      size.height,
      Math.max(64, Math.round(72 * display.scaleFactor)),
    );
    const serialize = (image: Electron.NativeImage) => ({
      width: image.getSize().width,
      height: image.getSize().height,
      bitmapBase64: image.toBitmap().toString('base64'),
      pngBase64: image.toPNG().toString('base64'),
    });

    return {
      displayId: String(display.id),
      scaleFactor: display.scaleFactor,
      top: serialize(thumbnail.crop({
        x: 0,
        y: 0,
        width: size.width,
        height: edgeHeight,
      })),
      bottom: serialize(thumbnail.crop({
        x: 0,
        y: size.height - edgeHeight,
        width: size.width,
        height: edgeHeight,
      })),
    };
  });
}

function comparePixels(
  before: TaskbarEdgeImage,
  after: TaskbarEdgeImage,
  ignoredBounds: readonly NonNullable<PixelDifference['bounds']>[] = [],
  horizontalBandWidth?: number,
): PixelDifference {
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  const left = Buffer.from(before.bitmapBase64, 'base64');
  const right = Buffer.from(after.bitmapBase64, 'base64');
  expect(right.length).toBe(left.length);
  expect(left.length).toBe(before.width * before.height * 4);

  const changed: Array<{ x: number; y: number; delta: number }> = [];
  for (let offset = 0; offset < left.length; offset += 4) {
    const pixel = offset / 4;
    const x = pixel % before.width;
    const y = Math.floor(pixel / before.width);
    if (ignoredBounds.some(bounds => (
      x >= bounds.left
      && x <= bounds.right
      && y >= bounds.top
      && y <= bounds.bottom
    ))) continue;
    const delta = Math.max(
      Math.abs((left[offset] ?? 0) - (right[offset] ?? 0)),
      Math.abs((left[offset + 1] ?? 0) - (right[offset + 1] ?? 0)),
      Math.abs((left[offset + 2] ?? 0) - (right[offset + 2] ?? 0)),
    );
    if (delta < 24) continue;
    changed.push({ x, y, delta });
  }

  let selected = changed;
  if (horizontalBandWidth && changed.length > 0) {
    const width = Math.max(1, Math.min(before.width, Math.round(horizontalBandWidth)));
    const columns = new Uint32Array(before.width);
    for (const pixel of changed) columns[pixel.x] = (columns[pixel.x] ?? 0) + 1;

    let currentCount = 0;
    for (let x = 0; x < width; x++) currentCount += columns[x] ?? 0;
    let strongestCount = currentCount;
    let strongestStart = 0;
    for (let start = 1; start <= before.width - width; start++) {
      currentCount -= columns[start - 1] ?? 0;
      currentCount += columns[start + width - 1] ?? 0;
      if (currentCount > strongestCount) {
        strongestCount = currentCount;
        strongestStart = start;
      }
    }
    const strongestEnd = strongestStart + width - 1;
    selected = changed.filter(pixel => (
      pixel.x >= strongestStart && pixel.x <= strongestEnd
    ));
  }

  let maximumChannelDelta = 0;
  let minimumX = before.width;
  let minimumY = before.height;
  let maximumX = -1;
  let maximumY = -1;
  for (const pixel of selected) {
    maximumChannelDelta = Math.max(maximumChannelDelta, pixel.delta);
    minimumX = Math.min(minimumX, pixel.x);
    minimumY = Math.min(minimumY, pixel.y);
    maximumX = Math.max(maximumX, pixel.x);
    maximumY = Math.max(maximumY, pixel.y);
  }

  return {
    changedPixels: selected.length,
    maximumChannelDelta,
    bounds: selected.length > 0
      ? { left: minimumX, top: minimumY, right: maximumX, bottom: maximumY }
      : null,
  };
}

async function attachCapture(
  testInfo: TestInfo,
  name: string,
  capture: TaskbarEdgeCapture,
): Promise<void> {
  await Promise.all((['top', 'bottom'] as const).map(edge => testInfo.attach(
    `${name}-${edge}`,
    {
      body: Buffer.from(capture[edge].pngBase64, 'base64'),
      contentType: 'image/png',
    },
  )));
}

async function writeCaptureArtifacts(
  testInfo: TestInfo,
  baseline: TaskbarEdgeCapture,
  rendered: TaskbarEdgeCapture,
  metrics: unknown,
): Promise<void> {
  await Promise.all([
    ...(['top', 'bottom'] as const).flatMap(edge => [
      writeFile(
        testInfo.outputPath(`taskbar-before-${edge}.png`),
        Buffer.from(baseline[edge].pngBase64, 'base64'),
      ),
      writeFile(
        testInfo.outputPath(`taskbar-after-${edge}.png`),
        Buffer.from(rendered[edge].pngBase64, 'base64'),
      ),
    ]),
    writeFile(
      testInfo.outputPath('taskbar-pixel-difference.json'),
      `${JSON.stringify(metrics, null, 2)}\n`,
      'utf8',
    ),
  ]);
}

test.describe('Windows taskbar lyrics visual surface', () => {
  test.skip(process.platform !== 'win32', 'The taskbar host only exists on Windows.');

  test('produces visible pixels in the composed taskbar', async ({}, testInfo) => {
    test.setTimeout(45_000);
    const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lyrics-adapter-taskbar-e2e-')));
    const isolatedHome = path.join(tempRoot, 'home');
    const userData = path.join(tempRoot, 'user-data');
    const appData = path.join(tempRoot, 'app-data');
    const localAppData = path.join(tempRoot, 'local-app-data');
    const coverDirectory = path.join(userData, 'covers');
    await Promise.all([isolatedHome, userData, appData, localAppData, coverDirectory].map(directory => (
      mkdir(directory, { recursive: true })
    )));
    await copyFile(
      path.join(repoRoot, 'app-icon.png'),
      path.join(coverDirectory, 'windows-taskbar-visual-e2e.png'),
    );

    const launchEnv: Record<string, string> = {
      ...inheritedEnv,
      NODE_ENV: 'test',
      LYRICS_ADAPTER_E2E_STATIC: '1',
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
    };
    delete launchEnv['ELECTRON_RUN_AS_NODE'];

    let electronApp: ElectronApplication | undefined;
    let page: Page | undefined;
    try {
      electronApp = await electron.launch({
        ...(packagedExecutablePath ? { executablePath: packagedExecutablePath } : {}),
        cwd: tempRoot,
        args: packagedExecutablePath
          ? [`--user-data-dir=${userData}`]
          : [`--user-data-dir=${userData}`, repoRoot],
        env: launchEnv,
      });
      page = await electronApp.firstWindow();
      await expect(page).toHaveURL('app://localhost/index.html');

      if (packagedExecutablePath) {
        const runtimeIdentity = await electronApp.evaluate(({ app, nativeImage }) => {
          const iconPath = `${process.resourcesPath}\\app-icon-win.ico`;
          const icon = nativeImage.createFromPath(iconPath);
          return {
            isPackaged: app.isPackaged,
            name: app.getName(),
            iconPath,
            iconIsEmpty: icon.isEmpty(),
            iconSize: icon.getSize(),
          };
        });
        expect(runtimeIdentity).toMatchObject({
          isPackaged: true,
          name: 'lyrics-adapter',
          iconIsEmpty: false,
        });
        expect(runtimeIdentity.name).not.toBe('Electron');
        expect(runtimeIdentity.iconSize.width).toBeGreaterThanOrEqual(32);
        expect(runtimeIdentity.iconSize.height).toBeGreaterThanOrEqual(32);
      }

      const baseline = await captureTaskbarEdges(electronApp);
      await page.waitForTimeout(250);
      const settledBaseline = await captureTaskbarEdges(electronApp);
      const baselineNoise = {
        top: comparePixels(baseline.top, settledBaseline.top),
        bottom: comparePixels(baseline.bottom, settledBaseline.bottom),
      };

      const updateResult = await page.evaluate(async (state) => {
        const api = (window as typeof window & { electron?: TaskbarLyricsTestAPI }).electron;
        if (!api?.ipc?.systemLyrics?.update) {
          throw new Error('System lyrics preload API is unavailable');
        }
        return api.ipc.systemLyrics.update(state);
      }, {
        trackId: 'windows-taskbar-visual-e2e',
        coverUrl: 'cover://windows-taskbar-visual-e2e.png',
        title: 'LyricsAdapter visual E2E',
        artist: 'Native WPF host',
        line: 'VISIBLE TASKBAR LYRICS 任务栏像素验证',
        nextLine: 'This text must reach the composed desktop',
        lineCursor: 0,
        lineProgress: 12,
        isPlaying: true,
      });
      expect(updateResult).toMatchObject({ ok: true });

      const minimumChangedPixels = Math.max(
        500,
        Math.round(625 * baseline.scaleFactor * baseline.scaleFactor),
      );
      let strongestCapture = settledBaseline;
      let strongestDifference = {
        edge: 'bottom' as 'top' | 'bottom',
        metrics: { changedPixels: 0, maximumChannelDelta: 0, bounds: null } as PixelDifference,
      };
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await page.waitForTimeout(250);
        const capture = await captureTaskbarEdges(electronApp);
        const differences = (['top', 'bottom'] as const).map(edge => {
          const noiseBounds = baselineNoise[edge].bounds;
          const noiseWidth = noiseBounds ? noiseBounds.right - noiseBounds.left + 1 : 0;
          const noiseHeight = noiseBounds ? noiseBounds.bottom - noiseBounds.top + 1 : 0;
          const maskBaselineNoise = noiseBounds
            && noiseWidth <= 160 * baseline.scaleFactor
            && noiseHeight <= 80 * baseline.scaleFactor;
          const padding = Math.round(12 * baseline.scaleFactor);
          const ignoredBounds = maskBaselineNoise ? [{
            left: Math.max(0, noiseBounds.left - padding),
            top: Math.max(0, noiseBounds.top - padding),
            right: Math.min(capture[edge].width - 1, noiseBounds.right + padding),
            bottom: Math.min(capture[edge].height - 1, noiseBounds.bottom + padding),
          }] : [];
          return {
            edge,
            metrics: comparePixels(
              settledBaseline[edge],
              capture[edge],
              ignoredBounds,
              210 * baseline.scaleFactor,
            ),
          };
        });
        const strongest = differences.reduce((current, candidate) => (
          candidate.metrics.changedPixels > current.metrics.changedPixels ? candidate : current
        ));
        if (strongest.metrics.changedPixels > strongestDifference.metrics.changedPixels) {
          strongestCapture = capture;
          strongestDifference = strongest;
        }
        if (strongest.metrics.changedPixels >= minimumChangedPixels) break;
      }

      await attachCapture(testInfo, 'taskbar-before', settledBaseline);
      await attachCapture(testInfo, 'taskbar-after', strongestCapture);
      const visualMetrics = {
        displayId: baseline.displayId,
        scaleFactor: baseline.scaleFactor,
        baselineNoise,
        minimumChangedPixels,
        strongestDifference,
      };
      await testInfo.attach('taskbar-pixel-difference', {
        body: Buffer.from(JSON.stringify(visualMetrics, null, 2)),
        contentType: 'application/json',
      });
      await writeCaptureArtifacts(testInfo, settledBaseline, strongestCapture, visualMetrics);

      expect(
        strongestDifference.metrics.changedPixels,
        `No visible native lyrics were found in either taskbar edge; strongest edge was ${strongestDifference.edge}`,
      ).toBeGreaterThanOrEqual(minimumChangedPixels);
      expect(strongestDifference.metrics.maximumChannelDelta).toBeGreaterThanOrEqual(80);
      expect(strongestDifference.metrics.bounds).not.toBeNull();
      const changedBounds = strongestDifference.metrics.bounds!;
      const changedWidth = changedBounds.right - changedBounds.left + 1;
      const changedHeight = changedBounds.bottom - changedBounds.top + 1;
      expect(changedWidth).toBeGreaterThanOrEqual(Math.round(145 * baseline.scaleFactor));
      expect(changedWidth).toBeLessThanOrEqual(Math.round(215 * baseline.scaleFactor));
      expect(changedHeight).toBeGreaterThanOrEqual(Math.round(16 * baseline.scaleFactor));
      expect(changedHeight).toBeLessThanOrEqual(Math.round(56 * baseline.scaleFactor));
    } finally {
      await closeElectronApp(electronApp);
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
