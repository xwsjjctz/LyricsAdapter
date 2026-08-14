import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
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

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
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
