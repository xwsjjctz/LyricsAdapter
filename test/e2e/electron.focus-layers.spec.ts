import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

/**
 * Compositor-layer probe for Focus Mode.
 *
 * The memory benchmark in electron.memory.spec.ts measures process totals but
 * cannot attribute them to DOM/compositor causes. This probe records the
 * LayerTree snapshot (layer count, per-layer size and compositing reason) plus
 * per-process memory for the same fixture, so an optimization can be judged by
 * layer area and private bytes instead of guesswork.
 *
 * Run explicitly (build first):
 *   FOCUS_LAYER_PROBE=1 npx playwright test --config=test/playwright.electron.config.ts electron.focus-layers.spec.ts
 *
 * Optional env:
 *   FOCUS_LAYER_PROBE_LINES   lyric line count (default 40, max 300)
 *   FOCUS_LAYER_PROBE_LABEL   report file label (default "focus")
 */

const probeEnabled = process.env['FOCUS_LAYER_PROBE'] === '1';
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function readPositiveInteger(name: string, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

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

interface ProbeLayer {
  layerId: string;
  parentLayerId?: string | undefined;
  width: number;
  height: number;
  paintCount: number;
  drawsContent: boolean;
  compositingReasonIds: string[];
  nodeName: string | null;
  className: string | null;
  backendNodeId?: number | undefined;
}

/** Subset of the CDP LayerTree.Layer fields this probe reads. */
interface RawLayer {
  layerId?: string;
  parentLayerId?: string;
  backendNodeId?: number;
  width?: number;
  height?: number;
  paintCount?: number;
  drawsContent?: boolean;
  compositingReasonIds?: string[];
  compositingReasons?: string[];
}

function summarizeLayers(layers: ProbeLayer[]) {
  const totalPixels = layers.reduce((total, layer) => total + layer.width * layer.height, 0);
  const byReason = new Map<string, number>();
  for (const layer of layers) {
    for (const reason of layer.compositingReasonIds) {
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
  }
  const fullWindowThreshold = 1_000_000;
  return {
    layerCount: layers.length,
    totalMegapixels: Math.round((totalPixels / 1_000_000) * 100) / 100,
    layerBackingMbEstimate: Math.round((totalPixels * 4 / 1024 / 1024) * 100) / 100,
    largeLayerCount: layers.filter(layer => layer.width * layer.height >= fullWindowThreshold).length,
    largeLayerPixels: layers
      .filter(layer => layer.width * layer.height >= fullWindowThreshold)
      .reduce((total, layer) => total + layer.width * layer.height, 0),
    reasonCounts: Object.fromEntries([...byReason.entries()].sort((a, b) => b[1] - a[1])),
    topLayers: [...layers]
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .slice(0, 20),
  };
}

async function collectMemory(app: ElectronApplication): Promise<{
  processes: Array<{ pid: number; type: string; serviceName: string | null; workingSetKb: number; privateBytesKb: number | null }>;
  browserPrivateKb: number;
}> {
  return app.evaluate(async ({ app: electronApp }) => ({
    processes: electronApp.getAppMetrics().map(metric => ({
      pid: metric.pid,
      type: metric.type,
      serviceName: metric.serviceName ?? null,
      workingSetKb: metric.memory.workingSetSize,
      privateBytesKb: metric.memory.privateBytes ?? null,
    })),
    browserPrivateKb: (await process.getProcessMemoryInfo()).private,
  })) as Promise<{
    processes: Array<{ pid: number; type: string; serviceName: string | null; workingSetKb: number; privateBytesKb: number | null }>;
    browserPrivateKb: number;
  }>;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}

/** Working set is noisy; force GC and take the median of three samples. */
async function collectStableMemory(
  app: ElectronApplication,
  collectGarbage: () => Promise<void>,
): Promise<{ processes: Array<{ type: string; serviceName: string | null; workingSetMb: number }>; totals: Record<string, number> }> {
  const samples: Awaited<ReturnType<typeof collectMemory>>[] = [];
  for (let index = 0; index < 3; index++) {
    await collectGarbage();
    samples.push(await collectMemory(app));
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const processKeys = new Set(samples.flatMap(sample =>
    sample.processes.map(metric => `${metric.type}:${metric.serviceName ?? ''}`)));
  const processes = [...processKeys].map(key => {
    const [type, serviceName] = key.split(':');
    const workingSets = samples
      .map(sample => sample.processes.find(metric =>
        metric.type === type && (metric.serviceName ?? '') === serviceName))
      .filter((metric): metric is NonNullable<typeof metric> => metric !== undefined)
      .map(metric => metric.workingSetKb);
    return {
      type: type!,
      serviceName: serviceName ? serviceName : null,
      workingSetMb: Math.round(median(workingSets) / 1024),
    };
  });
  return {
    processes,
    totals: {
      workingSetMb: Math.round(processes.reduce((total, metric) => total + metric.workingSetMb, 0)),
      tabMb: processes.find(metric => metric.type === 'Tab')?.workingSetMb ?? 0,
      gpuMb: processes.find(metric => metric.type === 'GPU')?.workingSetMb ?? 0,
    },
  };
}

test.describe('focus mode compositor layer probe', () => {
  test.skip(!probeEnabled, 'Run explicitly with FOCUS_LAYER_PROBE=1');

  test('records LayerTree + process memory for the AMLL focus path', async ({}, testInfo) => {
    test.setTimeout(240_000);
    const lineCount = readPositiveInteger('FOCUS_LAYER_PROBE_LINES', 40, 300);
    const label = (process.env['FOCUS_LAYER_PROBE_LABEL'] ?? 'focus').replace(/[^a-zA-Z0-9_-]/g, '-');
    const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lyrics-focus-layers-')));
    const isolatedHome = path.join(tempRoot, 'home');
    const userData = path.join(tempRoot, 'user-data');
    const covers = path.join(userData, 'covers');
    await Promise.all([isolatedHome, covers].map(dir => mkdir(dir, { recursive: true })));
    const audioPath = path.join(tempRoot, 'fixture.wav');
    await writeFile(audioPath, silentWav(120));
    const trackId = 'focus-layer-probe';
    await copyFile(path.join(repoRoot, 'app-icon.png'), path.join(covers, `${trackId}.png`));
    await writeFile(path.join(userData, 'library-index.json'), JSON.stringify({
      songs: [{
        id: trackId,
        filePath: audioPath,
        title: 'Focus Layer Probe',
        artist: 'LyricsAdapter',
        album: 'Compositor probe',
        duration: 120,
        source: 'local',
        available: true,
        coverUrl: `cover://${trackId}.png`,
        syncedLyrics: Array.from({ length: lineCount }, (_, index) => ({
          time: index * 3,
          text: `Line ${index + 1} 沿着夜色听见远方的声音`,
          words: [`Line ${index + 1} `, '沿', '着', '夜', '色', '听', '见', '远', '方', '的', '声', '音'].map((text, wordIndex) => ({
            time: index * 3 + wordIndex * 0.25,
            duration: 0.25,
            text,
          })),
        })),
      }],
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
          // Utility processes fail to initialize Chromium's own sandbox when the
          // whole test run is nested inside an outer OS sandbox (observed as
          // "sandbox initialization failed: Operation not permitted" followed by
          // ERR_FAILED on app://). This probe never loads remote content.
          '--no-sandbox',
          `--user-data-dir=${userData}`, repoRoot,
        ],
        env,
      });
      app.process().stdout?.on('data', chunk => console.log('[electron stdout]', String(chunk).trim()));
      app.process().stderr?.on('data', chunk => console.log('[electron stderr]', String(chunk).trim()));
      const page: Page = await app.firstWindow();
      await expect(page).toHaveURL('app://localhost/index.html');
      await expect(page.getByText('Focus Layer Probe').first()).toBeVisible();

      const cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('LayerTree.enable');
      let latestLayers: RawLayer[] = [];
      cdp.on('LayerTree.layerTreeDidChange', event => {
        latestLayers = (event.layers ?? []) as unknown as RawLayer[];
      });

      const waitForStableLayerCount = async (): Promise<void> => {
        let previous = -1;
        for (let attempt = 0; attempt < 14; attempt++) {
          await page.waitForTimeout(500);
          const count = latestLayers.length;
          if (count > 0 && count === previous) return;
          previous = count;
        }
      };

      const snapshot = async (phase: string) => {
        await waitForStableLayerCount();
        const rawLayers = [...latestLayers];
        const layers: ProbeLayer[] = [];
        // DOM.describeNode is a serial CDP round trip; only resolve the nodes
        // that can actually dominate layer memory (>= 20k px), capped.
        const describeBudget = 80;
        let describesUsed = 0;
        let reasonsUsed = 0;
        for (const raw of rawLayers) {
          const backendNodeId = typeof raw.backendNodeId === 'number' ? raw.backendNodeId : undefined;
          const area = Number(raw.width ?? 0) * Number(raw.height ?? 0);
          let nodeName: string | null = null;
          let className: string | null = null;
          if (backendNodeId && area >= 20_000 && describesUsed < describeBudget) {
            describesUsed += 1;
            try {
              const described = await cdp.send('DOM.describeNode', { backendNodeId });
              nodeName = described.node?.nodeName ?? null;
              const attributes = described.node?.attributes ?? [];
              for (let index = 0; index < attributes.length; index += 2) {
                if (attributes[index] === 'class') className = attributes[index + 1] ?? null;
              }
            } catch {
              // Node may already be gone; keep the layer without node info.
            }
          }
          // The layerTreeDidChange payload no longer carries compositing
          // reasons; query them for the layers that can dominate memory.
          let compositingReasonIds: string[] = [];
          if (area >= 400_000 && reasonsUsed < 40 && raw.layerId !== undefined) {
            reasonsUsed += 1;
            try {
              const reasons = await cdp.send('LayerTree.compositingReasons', {
                layerId: String(raw.layerId),
              });
              compositingReasonIds = reasons.compositingReasonIds ?? [];
            } catch {
              // Layer may already be gone.
            }
          }
          layers.push({
            layerId: String(raw.layerId ?? ''),
            ...(typeof raw.parentLayerId === 'string' ? { parentLayerId: raw.parentLayerId } : {}),
            width: Number(raw.width ?? 0),
            height: Number(raw.height ?? 0),
            paintCount: Number(raw.paintCount ?? 0),
            drawsContent: Boolean(raw.drawsContent),
            compositingReasonIds,
            nodeName,
            className,
            ...(backendNodeId !== undefined ? { backendNodeId } : {}),
          });
        }
        const memory = await collectStableMemory(app!, async () => {
          await cdp.send('HeapProfiler.enable').catch(() => undefined);
          await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined);
        });
        const amll = await page.locator('.amll-lyric-player').count();
        const mountedLines = amll > 0
          ? await page.locator('[class*="_lyricLineWrapper"]').count()
          : 0;
        const wordSpans = amll > 0
          ? await page.locator('[class*="_lyricMainLine"] span').count()
          : 0;
        return {
          phase,
          memory,
          amllMountedLines: mountedLines,
          amllWordSpans: wordSpans,
          layers: summarizeLayers(layers),
        };
      };

      const focusToggle = page.getByRole('button', {
        name: /Focus|专注|集中|집중|Fokus|concentré|フォーカス/i,
      }).first();
      const focusOverlay = page.locator('.focus-mode-overlay');
      await expect(focusToggle).toBeVisible();

      // Keep reports outside testInfo.outputPath: Playwright cleans the run's
      // output directory, which would delete the previous A/B baseline.
      const reportDirectory = path.join(repoRoot, 'test-results', 'memory', 'layer-probes');
      await mkdir(reportDirectory, { recursive: true });

      const phases = [await snapshot('idle')];
      console.log('[focus-layers] idle snapshot captured');
      await focusToggle.click();
      await expect(focusOverlay).toBeVisible();
      await expect(focusOverlay.locator('.amll-lyric-player')).toHaveCount(1, { timeout: 15_000 });
      phases.push(await snapshot('focus'));
      console.log('[focus-layers] focus snapshot captured');
      // The lyric player runs a continuous rAF; force-disable animations so the
      // screenshot does not wait for a stable frame forever.
      await focusOverlay.screenshot({
        path: path.join(reportDirectory, `focus-${label}.png`),
        animations: 'disabled',
        timeout: 15_000,
      });
      await focusToggle.click();
      await expect(focusOverlay).toHaveCount(0, { timeout: 5_000 });
      phases.push(await snapshot('post-focus'));
      console.log('[focus-layers] post-focus snapshot captured');

      const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        platform: { os: process.platform, arch: process.arch, release: os.release() },
        configuration: { label, lineCount },
        phases,
      };
      // Keep reports outside testInfo.outputPath: Playwright cleans the run's
      // output directory, which would delete the previous A/B baseline.
      const reportPath = path.join(
        reportDirectory,
        `focus-layers-${label}-${process.platform}-${process.arch}.json`,
      );
      const reportBody = `${JSON.stringify(report, null, 2)}\n`;
      await writeFile(reportPath, reportBody);
      await testInfo.attach('focus-layer-report', { body: Buffer.from(reportBody), contentType: 'application/json' });

      console.table(phases.map(phase => ({
        phase: phase.phase,
        layers: phase.layers.layerCount,
        megapixels: phase.layers.totalMegapixels,
        largeLayers: phase.layers.largeLayerCount,
        mountedLines: phase.amllMountedLines,
        wordSpans: phase.amllWordSpans,
        tabMb: phase.memory.totals['tabMb'],
        gpuMb: phase.memory.totals['gpuMb'],
      })));
      console.log(`Focus layer probe report: ${reportPath}`);
    } finally {
      await app?.close().catch(() => undefined);
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
