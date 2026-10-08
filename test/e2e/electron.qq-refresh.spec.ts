import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { QQCredential } from '../../src/shared/qqCredential';
import type { TypedElectronIPC } from '../../src/types/typedIpc';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const credentialKey = 'qq_music_credential';
const cookieKey = 'qq_music_cookie';

interface TestBridge {
  qqLoginRefresh(credential: QQCredential, cookie: string): Promise<{
    success: boolean; error?: string; credential?: QQCredential; cookie?: string;
  }>;
  settingsGet(key: string): Promise<string | undefined>;
  ipc: Pick<TypedElectronIPC, 'settings'>;
}

interface RefreshProbe {
  calls: { payload: { req: { param: Record<string, unknown> }; comm: Record<string, unknown> }; cookie: string }[];
}

test('QQ refresh rotates OAuth fields through IPC and respects encrypted persistence availability across restart', async () => {
  test.skip(!existsSync(path.join(repo, 'dist-music-plugins/qq')), 'Build optional official plugins to run QQ protocol integration');
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-qq-refresh-')));
  const isolatedHome = path.join(root, 'home');
  const userData = path.join(root, 'user-data');
  await mkdir(path.join(isolatedHome, '.la'), { recursive: true });
  await mkdir(userData, { recursive: true });
  await cp(path.join(repo, 'dist-music-plugins/qq'), path.join(isolatedHome, '.la/plugin/qq'), { recursive: true });
  await writeFile(path.join(isolatedHome, '.la/settings.json'), JSON.stringify({ 'app-language': 'en' }));
  const env = Object.fromEntries(Object.entries({ ...process.env,
    HOME: isolatedHome, USERPROFILE: isolatedHome, APPDATA: path.join(root, 'app-data'),
    LOCALAPPDATA: path.join(root, 'local-app-data'), XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE'];
  const launch = () => electron.launch({ cwd: root, args: [
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userData}`, repo,
  ], env });
  let app: ElectronApplication | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.waitForFunction(() => Boolean((window as unknown as { electron?: TestBridge }).electron?.qqLoginRefresh));
    // Stub only QQ's login CGI in the main process: the real preload, IPC handler,
    // refresh service, and settings repository all remain in the path.
    await app.evaluate(() => {
      const host = globalThis as typeof globalThis & { qqRefreshProbe?: RefreshProbe };
      const probe: RefreshProbe = { calls: [] };
      host.qqRefreshProbe = probe;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        if (String(input) !== 'https://u.y.qq.com/cgi-bin/musicu.fcg') return originalFetch(input, init);
        probe.calls.push({ payload: JSON.parse(String(init?.body)), cookie: new Headers(init?.headers).get('Cookie') || '' });
        const now = Math.floor(Date.now() / 1000);
        const data = probe.calls.length === 1 ? {
          musicid: 12345, musickey: 'test-new-key', refresh_key: 'test-new-refresh-key',
          refresh_token: 'test-new-refresh-token', openid: 'test-new-openid', access_token: 'test-new-access',
          expired_at: now + 86400, musickeyCreateTime: now, keyExpiresIn: 259200,
        } : { musickey: 'test-newer-key', refresh_token: '' };
        return new Response(JSON.stringify({ code: 0, req: probe.calls.length === 3
          ? { code: 1000 } : { code: 0, data } }), { headers: { 'Content-Type': 'application/json' } });
      };
    });
    const legacy: QQCredential = {
      musicid: 12345, musickey: 'test-old-key', refreshKey: 'test-old-refresh-key', refreshToken: 'test-old-refresh-token',
      loginType: 2, musickeyCreateTime: 1_700_000_000, keyExpiresIn: 259200,
    };
    const oldCookie = 'uin=o12345; qm_keyst=test-old-key; p_skey=test-unrelated; psrf_qqopenid=test-old-openid; psrf_qqaccess_token=test-old-access';
    const first = await page.evaluate(async ({ credential, cookie }) =>
      (window as unknown as { electron: TestBridge }).electron.qqLoginRefresh(credential, cookie),
    { credential: legacy, cookie: oldCookie });
    expect(first.success).toBe(true);
    expect(first.credential).toMatchObject({ openId: 'test-new-openid', accessToken: 'test-new-access', refreshToken: 'test-new-refresh-token' });
    expect(first.cookie).toContain('p_skey=test-unrelated');
    expect(first.cookie).toContain('psrf_qqaccess_token=test-new-access');
    const partial = await page.evaluate(async ({ credential, cookie }) =>
      (window as unknown as { electron: TestBridge }).electron.qqLoginRefresh(credential, cookie),
    { credential: first.credential!, cookie: first.cookie! });
    expect(partial.success).toBe(true);
    expect(partial.credential).toMatchObject({ ...first.credential, musickey: 'test-newer-key', musickeyCreateTime: expect.any(Number) });
    const rejected = await page.evaluate(async ({ credential, cookie }) =>
      (window as unknown as { electron: TestBridge }).electron.qqLoginRefresh(credential, cookie),
    { credential: partial.credential!, cookie: partial.cookie! });
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain('req.code=1000');
    expect(rejected.error).toContain('重新扫码登录');
    const incomplete = await page.evaluate(async credential =>
      (window as unknown as { electron: TestBridge }).electron.qqLoginRefresh(credential, ''), legacy);
    expect(incomplete.success).toBe(false);
    expect(incomplete.error).toContain('凭据不完整');
    const probe = await app.evaluate(() => (globalThis as typeof globalThis & { qqRefreshProbe?: RefreshProbe }).qqRefreshProbe!);
    expect(probe.calls).toHaveLength(3);
    expect(probe.calls[0]?.payload.req.param).toMatchObject({ openid: 'test-old-openid', access_token: 'test-old-access', expired_in: 0, loginMode: 2 });
    expect(probe.calls[0]?.payload.comm['tmeLoginType']).toBe(2);
    expect(probe.calls[0]?.cookie).toBe(oldCookie);
    expect(probe.calls[1]?.payload.req.param).toMatchObject({ openid: 'test-new-openid', access_token: 'test-new-access', refresh_token: 'test-new-refresh-token' });

    // Keep the real encrypted store in the path. Headless Linux may only have
    // basic_text: verify refusal to save credentials there, not plaintext storage.
    const encryptionAvailable = await app.evaluate(({ safeStorage }) =>
      safeStorage.isEncryptionAvailable()
      && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'));
    const entries = { [credentialKey]: JSON.stringify(partial.credential), [cookieKey]: partial.cookie! };
    const writeResult = await page.evaluate(async entries =>
      (window as unknown as { electron: TestBridge }).electron.ipc.settings.setMany(entries), entries);
    expect(writeResult.ok).toBe(encryptionAvailable);
    if (!writeResult.ok) expect(writeResult.error).toContain('Failed to persist settings');
    await app.close(); app = undefined;
    app = await launch();
    page = await app.firstWindow();
    await page.waitForFunction(() => Boolean((window as unknown as { electron?: TestBridge }).electron?.settingsGet));
    const persisted = await page.evaluate(async ({ credentialKey, cookieKey }) => {
      const api = (window as unknown as { electron: TestBridge }).electron;
      return { credential: await api.settingsGet(credentialKey), cookie: await api.settingsGet(cookieKey) };
    }, { credentialKey, cookieKey });
    expect(persisted).toEqual(encryptionAvailable
      ? { credential: entries[credentialKey], cookie: entries[cookieKey] }
      : { credential: undefined, cookie: undefined });
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
