import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const benchmarkEnabled = process.env['MEMORY_BENCHMARK'] === '1';
const configuredLyricsRenderer = process.env['MEMORY_BENCHMARK_LYRICS_RENDERER'];
if (configuredLyricsRenderer && configuredLyricsRenderer !== 'legacy' && configuredLyricsRenderer !== 'amll') {
  throw new Error('MEMORY_BENCHMARK_LYRICS_RENDERER must be "legacy" or "amll"');
}
const lyricsRenderer: 'legacy' | 'amll' = configuredLyricsRenderer === 'amll' ? 'amll' : 'legacy';
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const electronExecutable = require('electron') as string;
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);

interface RendererMetrics {
  jsHeapUsedBytes: number | null;
  jsHeapTotalBytes: number | null;
  jsHeapLimitBytes: number | null;
  domNodeCount: number;
  imageCount: number;
  canvasCount: number;
  canvasBackingBytesEstimate: number;
  viewport: {
    innerWidth: number;
    innerHeight: number;
    outerWidth: number;
    outerHeight: number;
    devicePixelRatio: number;
  };
}

interface ProcessMemoryMetric {
  pid: number;
  type: string;
  name: string | null;
  serviceName: string | null;
  workingSetKb: number;
  peakWorkingSetKb: number;
  privateBytesKb: number | null;
  cpuPercent: number;
}

interface SystemMemoryMetrics {
  total: number;
  free: number;
  swapTotal?: number;
  swapFree?: number;
  fileBacked?: number;
  purgeable?: number;
}

interface BrowserProcessMemoryMetrics {
  private: number;
  residentSet?: number;
  shared: number;
}

interface MemorySample {
  capturedAt: string;
  elapsedMs: number;
  systemMemoryKb: SystemMemoryMetrics;
  browserProcessMemoryKb: BrowserProcessMemoryMetrics;
  processes: ProcessMemoryMetric[];
  totals: {
    processCount: number;
    workingSetKb: number;
    peakWorkingSetKb: number;
    privateBytesKb: number | null;
    privateBytesProcessCount: number;
  };
  renderer: RendererMetrics;
}

interface PhaseResult {
  phase: string;
  samples: MemorySample[];
  median: {
    workingSetMb: number;
    privateBytesMb: number | null;
    browserPrivateMb: number | null;
    rendererJsHeapMb: number | null;
    canvasBackingMbEstimate: number;
    processCount: number;
    processGroups: Array<{
      group: string;
      workingSetMb: number;
      privateBytesMb: number | null;
    }>;
  };
}

function readPositiveInteger(name: string, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

function kbToMb(value: number): number {
  return Math.round((value / 1024) * 100) / 100;
}

function bytesToMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 100) / 100;
}

function nullableMedian(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? median(present) : null;
}

function summarizePhase(phase: string, samples: MemorySample[]): PhaseResult {
  const privateBytesKb = nullableMedian(samples.map(sample => sample.totals.privateBytesKb));
  const browserPrivateKb = nullableMedian(samples.map(sample => (
    typeof sample.browserProcessMemoryKb.private === 'number'
      ? sample.browserProcessMemoryKb.private
      : null
  )));
  const rendererJsHeapBytes = nullableMedian(samples.map(sample => sample.renderer.jsHeapUsedBytes));
  const processGroupNames = Array.from(new Set(samples.flatMap(sample =>
    sample.processes.map(metric => [
      metric.type,
      metric.serviceName ?? metric.name,
    ].filter(Boolean).join(':')),
  ))).sort();
  const processGroups = processGroupNames.map(group => {
    const groupSamples = samples.map(sample => {
      const metrics = sample.processes.filter(metric => [
        metric.type,
        metric.serviceName ?? metric.name,
      ].filter(Boolean).join(':') === group);
      const privateValues = metrics
        .map(metric => metric.privateBytesKb)
        .filter((value): value is number => value !== null);
      return {
        workingSetKb: metrics.reduce((total, metric) => total + metric.workingSetKb, 0),
        privateBytesKb: privateValues.length > 0
          ? privateValues.reduce((total, value) => total + value, 0)
          : null,
      };
    });
    const privateMedianKb = nullableMedian(groupSamples.map(sample => sample.privateBytesKb));
    return {
      group,
      workingSetMb: kbToMb(median(groupSamples.map(sample => sample.workingSetKb))),
      privateBytesMb: privateMedianKb === null ? null : kbToMb(privateMedianKb),
    };
  });

  return {
    phase,
    samples,
    median: {
      workingSetMb: kbToMb(median(samples.map(sample => sample.totals.workingSetKb))),
      privateBytesMb: privateBytesKb === null ? null : kbToMb(privateBytesKb),
      browserPrivateMb: browserPrivateKb === null ? null : kbToMb(browserPrivateKb),
      rendererJsHeapMb: rendererJsHeapBytes === null ? null : bytesToMb(rendererJsHeapBytes),
      canvasBackingMbEstimate: bytesToMb(median(
        samples.map(sample => sample.renderer.canvasBackingBytesEstimate),
      )),
      processCount: median(samples.map(sample => sample.totals.processCount)),
      processGroups,
    },
  };
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

async function collectMemorySample(
  electronApp: ElectronApplication,
  page: Page,
  startedAt: number,
): Promise<MemorySample> {
  const [mainMetrics, renderer] = await Promise.all([
    electronApp.evaluate(async ({ app }) => {
      const browserProcessMemory = await process.getProcessMemoryInfo();
      return {
        systemMemory: process.getSystemMemoryInfo(),
        browserProcessMemory,
        processes: app.getAppMetrics().map(metric => ({
          pid: metric.pid,
          type: metric.type,
          name: metric.name ?? null,
          serviceName: metric.serviceName ?? null,
          workingSetKb: metric.memory.workingSetSize,
          peakWorkingSetKb: metric.memory.peakWorkingSetSize,
          privateBytesKb: metric.memory.privateBytes ?? null,
          cpuPercent: metric.cpu.percentCPUUsage,
        })),
      };
    }),
    page.evaluate((): RendererMetrics => {
      const chromiumPerformance = performance as Performance & {
        memory?: {
          usedJSHeapSize: number;
          totalJSHeapSize: number;
          jsHeapSizeLimit: number;
        };
      };
      const memory = chromiumPerformance.memory;
      const canvases = Array.from(document.querySelectorAll('canvas'));
      return {
        jsHeapUsedBytes: memory?.usedJSHeapSize ?? null,
        jsHeapTotalBytes: memory?.totalJSHeapSize ?? null,
        jsHeapLimitBytes: memory?.jsHeapSizeLimit ?? null,
        domNodeCount: document.getElementsByTagName('*').length,
        imageCount: document.images.length,
        canvasCount: canvases.length,
        // Canvas RGBA backing storage is at least four bytes per pixel. GPU
        // textures and compositor copies are intentionally not guessed here.
        canvasBackingBytesEstimate: canvases.reduce(
          (total, canvas) => total + canvas.width * canvas.height * 4,
          0,
        ),
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
      };
    }),
  ]);

  const privateValues = mainMetrics.processes
    .map(metric => metric.privateBytesKb)
    .filter((value): value is number => value !== null);

  return {
    capturedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    systemMemoryKb: mainMetrics.systemMemory,
    browserProcessMemoryKb: mainMetrics.browserProcessMemory,
    processes: mainMetrics.processes,
    totals: {
      processCount: mainMetrics.processes.length,
      workingSetKb: mainMetrics.processes.reduce(
        (total, metric) => total + metric.workingSetKb,
        0,
      ),
      peakWorkingSetKb: mainMetrics.processes.reduce(
        (total, metric) => total + metric.peakWorkingSetKb,
        0,
      ),
      privateBytesKb: privateValues.length > 0
        ? privateValues.reduce((total, value) => total + value, 0)
        : null,
      privateBytesProcessCount: privateValues.length,
    },
    renderer,
  };
}

test.describe('cross-platform Electron memory benchmark', () => {
  test.skip(!benchmarkEnabled, 'Run explicitly with npm run test:memory');

  test('profiles idle and repeated FocusMode mount/unmount', async ({}, testInfo) => {
    test.setTimeout(180_000);

    const cycles = readPositiveInteger('MEMORY_BENCHMARK_CYCLES', 3, 20);
    const settleMs = readPositiveInteger('MEMORY_BENCHMARK_SETTLE_MS', 2_000, 30_000);
    const samplesPerPhase = readPositiveInteger('MEMORY_BENCHMARK_SAMPLES', 3, 20);
    const sampleIntervalMs = readPositiveInteger('MEMORY_BENCHMARK_SAMPLE_INTERVAL_MS', 350, 5_000);
    const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lyrics-adapter-memory-')));
    const isolatedHome = path.join(tempRoot, 'home');
    const dirs = {
      userData: path.join(tempRoot, 'user-data'),
      appData: path.join(tempRoot, 'app-data'),
      localAppData: path.join(tempRoot, 'local-app-data'),
      xdgConfig: path.join(tempRoot, 'xdg-config'),
      xdgData: path.join(tempRoot, 'xdg-data'),
      xdgCache: path.join(tempRoot, 'xdg-cache'),
    };
    await Promise.all([isolatedHome, ...Object.values(dirs)]
      .map(directory => mkdir(directory, { recursive: true })));
    const legacySettingsDirectory = path.join(isolatedHome, '.la');
    await mkdir(legacySettingsDirectory, { recursive: true });
    await writeFile(
      path.join(legacySettingsDirectory, 'settings.json'),
      JSON.stringify({
        la_focus_amll_lyrics_enabled: lyricsRenderer === 'amll' ? 'true' : 'false',
      }),
    );

    const trackId = 'memory-benchmark-track';
    const coversDirectory = path.join(dirs.userData, 'covers');
    await mkdir(coversDirectory, { recursive: true });
    await Promise.all([
      copyFile(path.join(repoRoot, 'app-icon.png'), path.join(coversDirectory, `${trackId}.png`)),
      writeFile(path.join(dirs.userData, 'library-index.json'), JSON.stringify({
        songs: [{
          id: trackId,
          title: 'Memory Benchmark Track',
          artist: 'LyricsAdapter',
          album: 'Cross-platform benchmark',
          duration: 180,
          lyrics: 'Memory benchmark lyric\nExercises AMLL mount and cleanup\nAcross repeated focus cycles',
          syncedLyrics: [
            {
              time: 0,
              text: 'Memory benchmark lyric',
              words: [
                { time: 0, duration: 1.5, text: 'Memory benchmark ' },
                { time: 1.5, duration: 1.5, text: 'lyric' },
              ],
            },
            { time: 3, text: 'Exercises AMLL mount and cleanup' },
            { time: 6, text: 'Across repeated focus cycles' },
          ],
          coverUrl: `cover://${trackId}.png`,
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

    const startedAt = Date.now();
    const phases: PhaseResult[] = [];
    let electronApp: ElectronApplication | undefined;
    let page: Page | undefined;

    const capturePhase = async (phase: string): Promise<void> => {
      if (!electronApp || !page) throw new Error('Electron benchmark is not running');
      await page.waitForTimeout(settleMs);
      const samples: MemorySample[] = [];
      for (let sampleIndex = 0; sampleIndex < samplesPerPhase; sampleIndex++) {
        samples.push(await collectMemorySample(electronApp, page, startedAt));
        if (sampleIndex < samplesPerPhase - 1) await page.waitForTimeout(sampleIntervalMs);
      }
      phases.push(summarizePhase(phase, samples));
    };

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
      await expect(page).toHaveURL('app://localhost/index.html');
      await expect(page.getByText('Memory Benchmark Track').first()).toBeVisible();

      const focusToggle = page.getByRole('button', {
        name: /Focus|专注|集中|집중|Fokus|concentré|フォーカス/i,
      }).first();
      const focusOverlay = page.locator('.focus-mode-overlay');
      await expect(focusToggle).toBeVisible();

      await capturePhase('idle-baseline');
      for (let cycle = 1; cycle <= cycles; cycle++) {
        await focusToggle.click();
        await expect(focusOverlay).toBeVisible();
        await expect(focusOverlay.locator('canvas')).toHaveCount(1, { timeout: 10_000 });
        const activeLyrics = lyricsRenderer === 'amll'
          ? focusOverlay.locator('.amll-lyric-player')
          : focusOverlay.getByTestId('focus-legacy-lyrics');
        const inactiveLyrics = lyricsRenderer === 'amll'
          ? focusOverlay.getByTestId('focus-legacy-lyrics')
          : focusOverlay.locator('.amll-lyric-player');
        await expect(activeLyrics).toHaveCount(1, { timeout: 10_000 });
        await expect(inactiveLyrics).toHaveCount(0);
        await capturePhase(`focus-${cycle}`);

        await focusToggle.click();
        await expect(focusOverlay).toHaveCount(0, { timeout: 5_000 });
        await capturePhase(`post-focus-${cycle}`);
      }

      const runtime = await electronApp.evaluate(({ app }) => ({
        appVersion: app.getVersion(),
        electron: process.versions.electron ?? 'unknown',
        chrome: process.versions.chrome ?? 'unknown',
        node: process.versions.node,
      }));
      const platform = {
        os: process.platform,
        release: os.release(),
        version: os.version(),
        arch: process.arch,
        cpuModel: os.cpus()[0]?.model ?? 'unknown',
        logicalCpuCount: os.cpus().length,
        totalSystemMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      };
      const primaryMetric = platform.os === 'win32' ? 'privateBytesMb' : 'workingSetMb';
      const baseline = phases[0]!.median;
      const focusPhases = phases.filter(phase => phase.phase.startsWith('focus-'));
      const postFocusPhases = phases.filter(phase => phase.phase.startsWith('post-focus-'));
      const readPrimary = (phase: PhaseResult): number => (
        primaryMetric === 'privateBytesMb'
          ? phase.median.privateBytesMb ?? phase.median.workingSetMb
          : phase.median.workingSetMb
      );
      const baselinePrimary = primaryMetric === 'privateBytesMb'
        ? baseline.privateBytesMb ?? baseline.workingSetMb
        : baseline.workingSetMb;
      const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        platform,
        runtime,
        configuration: {
          cycles,
          settleMs,
          samplesPerPhase,
          sampleIntervalMs,
          lyricsRenderer,
        },
        measurementNotes: [
          'Electron app.getAppMetrics() values and process.getProcessMemoryInfo() values are reported in KiB.',
          'privateBytes is available for every process only on Windows; workingSet is retained for cross-platform inspection.',
          'macOS memory compression and platform-specific process accounting make raw Task Manager and Activity Monitor totals non-equivalent.',
          'Canvas backing bytes estimate excludes GPU textures, compositor surfaces, image decode buffers, and driver allocations.',
          'This benchmark detects trends and regressions; it intentionally has no universal pass/fail MB threshold.',
        ],
        analysis: {
          primaryMetric,
          baselineMb: baselinePrimary,
          focusDeltaMbByCycle: focusPhases.map(phase =>
            Math.round((readPrimary(phase) - baselinePrimary) * 100) / 100),
          postFocusRetentionMbByCycle: postFocusPhases.map(phase =>
            Math.round((readPrimary(phase) - baselinePrimary) * 100) / 100),
        },
        phases,
      };

      const reportDirectory = path.join(repoRoot, 'test-results', 'memory');
      await mkdir(reportDirectory, { recursive: true });
      const safeTimestamp = report.generatedAt.replace(/[:.]/g, '-');
      const reportPath = path.join(
        reportDirectory,
        `memory-${lyricsRenderer}-${platform.os}-${platform.arch}-${safeTimestamp}.json`,
      );
      const reportBody = `${JSON.stringify(report, null, 2)}\n`;
      await writeFile(reportPath, reportBody);
      await testInfo.attach('cross-platform-memory-report', {
        body: Buffer.from(reportBody),
        contentType: 'application/json',
      });

      console.table(phases.map(phase => ({
        phase: phase.phase,
        workingSetMb: phase.median.workingSetMb,
        privateBytesMb: phase.median.privateBytesMb ?? 'n/a',
        rendererJsHeapMb: phase.median.rendererJsHeapMb ?? 'n/a',
        canvasEstimateMb: phase.median.canvasBackingMbEstimate,
        processCount: phase.median.processCount,
      })));
      console.log(`Memory benchmark report: ${reportPath}`);
    } finally {
      try {
        await closeElectronApp(electronApp);
      } finally {
        await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });
});
