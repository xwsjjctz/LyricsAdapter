import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify, stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const electronBinary: string = createRequire(import.meta.url)('electron');
const execute = promisify(execFile);

test('real Chromium requests read complete bodies and manual redirects after the request Writable closes', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-plugin-network-')));
  try {
    await mkdir(path.join(root, 'native-transport-profile'));
    await build({ entryPoints: [path.join(repo, 'electron/services/pluginUpdateFetch.ts')],
      bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(root, 'plugin-transport.cjs') });
    const entry = path.join(root, 'main.cjs');
    await copyFile(path.join(repo, 'test/e2e/fixtures/plugin-update-network.cjs'), entry);
    const env = Object.fromEntries(Object.entries({ ...process.env, HOME: root, USERPROFILE: root,
      APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata'),
      XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    delete env['ELECTRON_RUN_AS_NODE'];
    const { stdout } = await execute(electronBinary, [...(process.platform === 'linux' ? ['--no-sandbox'] : []), entry],
      { cwd: root, env, timeout: 30_000 });
    const output = stripVTControlCharacters(stdout);
    expect(output).toContain('DIRECT_RESPONSE 200 {"version":"1.0.1"}');
    expect(output).toContain('REDIRECT_RESPONSE 302 /feed');
    expect(output).toContain('REDIRECT_TARGET 200 {"version":"1.0.1"}');
    expect(output).toContain('NATIVE_TRANSPORT_SUCCESS');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
