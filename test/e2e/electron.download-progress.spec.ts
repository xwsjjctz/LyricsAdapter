import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { DownloadProgressEvent } from '../../src/types/onlineProgress';

interface DownloadAPI {
  downloadAndSave(url: string, cookie: string, filePath: string, requestId: string): Promise<{ success: boolean }>;
  onDownloadProgress(listener: (event: DownloadProgressEvent) => void): void;
  offDownloadProgress(listener: (event: DownloadProgressEvent) => void): void;
}

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('parallel downloads retain their task ids across the real preload and IPC bridge', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-download-progress-')));
  const isolatedHome = path.join(root, 'home');
  const userData = path.join(root, 'user-data');
  await Promise.all([mkdir(isolatedHome), mkdir(userData)]);
  const payload = Buffer.alloc(4096, 7);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Length': payload.length, 'Content-Type': 'audio/mpeg' });
    response.write(payload.subarray(0, 1024));
    setTimeout(() => response.end(payload.subarray(1024)), 30);
  });
  let app: ElectronApplication | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no port');
    const env = Object.fromEntries(Object.entries({ ...process.env,
      HOME: isolatedHome, USERPROFILE: isolatedHome, APPDATA: path.join(root, 'app-data'),
      LOCALAPPDATA: path.join(root, 'local-app-data'), XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'),
      NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: '1',
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    delete env['ELECTRON_RUN_AS_NODE'];
    app = await electron.launch({ cwd: root, args: [
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userData}`, repo,
    ], env });
    const page = await app.firstWindow();
    const files = ['qq', 'netease'].map(source => ({ id: `download-${source}`, file: path.join(root, `${source}.mp3`) }));
    const result = await page.evaluate(async ({ url, files }) => {
      const api = (window as unknown as { electron: DownloadAPI }).electron;
      const progress: DownloadProgressEvent[] = [];
      const listener = (event: DownloadProgressEvent) => progress.push(event);
      api.onDownloadProgress!(listener);
      try {
        const saved = await Promise.all(files.map(({ file, id }) => api.downloadAndSave!(url, '', file, id)));
        // IPC events queued on the same renderer get a turn before removing the listener.
        await new Promise(resolve => setTimeout(resolve, 50));
        return { saved, progress };
      } finally {
        api.offDownloadProgress!(listener);
      }
    }, { url: `http://127.0.0.1:${address.port}/audio`, files });
    expect(result.saved.every(saved => saved.success)).toBe(true);
    expect([...new Set(result.progress.map(event => event.requestId))].sort()).toEqual(files.map(file => file.id).sort());
    for (const { file, id } of files) {
      expect(result.progress.filter(event => event.requestId === id).at(-1)?.progress).toBe(100);
      expect(await readFile(file)).toEqual(payload);
    }
  } finally {
    if (app) await app.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
