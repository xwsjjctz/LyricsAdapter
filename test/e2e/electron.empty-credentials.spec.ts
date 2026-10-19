import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
type Bridge = { ipc: { settings: {
  get(key: string): Promise<{ ok: boolean; data?: string }>;
  set(key: string, value: string): Promise<{ ok: boolean }>;
} } };

test('historical empty credentials migrate, can be cleared, and survive a real app restart', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-empty-credentials-')));
  const home = path.join(root, 'home'), userData = path.join(root, 'user-data');
  const state = path.join(home, '.la');
  await mkdir(state, { recursive: true }); await mkdir(userData);
  const key = 'music-plugin:llm-translation:secret:cookie';
  const original = JSON.stringify({ 'app-language': 'en', [key]: 'enc:' });
  const legacyPath = path.join(state, 'settings.json');
  await writeFile(legacyPath, original);
  const env = Object.fromEntries(Object.entries({ ...process.env, HOME: home, USERPROFILE: home,
    APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE'];
  const launch = () => electron.launch({ cwd: root,
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${userData}`, repo], env });
  let app: ElectronApplication | undefined;
  try {
    app = await launch(); let page = await app.firstWindow();
    await expect(page.locator('.poster-wall')).toBeVisible();
    expect(await page.evaluate(key => (window as unknown as { electron: Bridge }).electron.ipc.settings.get(key), key))
      .toEqual({ ok: true, data: '' });
    expect(await page.evaluate(key => (window as unknown as { electron: Bridge }).electron.ipc.settings.set(key, ''), key))
      .toMatchObject({ ok: true });
    await app.close(); app = undefined;
    const db = new DatabaseSync(path.join(state, 'state.sqlite3'), { readOnly: true });
    try {
      expect(db.prepare('SELECT value FROM settings WHERE key = ?').get(key)).toMatchObject({ value: '' });
      // Reproduce an existing SQLite authority DB written by the affected versions.
    } finally { db.close(); }
    const old = new DatabaseSync(path.join(state, 'state.sqlite3'));
    try { old.prepare('UPDATE settings SET value = ? WHERE key = ?').run('enc:', key); }
    finally { old.close(); }
    app = await launch(); page = await app.firstWindow();
    await expect(page.locator('.poster-wall')).toBeVisible();
    expect(await page.evaluate(key => (window as unknown as { electron: Bridge }).electron.ipc.settings.get(key), key))
      .toEqual({ ok: true, data: '' });
    expect(await readFile(legacyPath, 'utf8')).toBe(original);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
