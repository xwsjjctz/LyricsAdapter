// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import type { PluginUpdateFeed } from '../../src/shared/pluginUpdate';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
it('generates hashes of complete packages without executing code and retains compatible version history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-update-feed-')); roots.push(root);
  const file = path.join(root, 'translator.laplugin'), output = path.join(root, 'plugins.update.json');
  const code = 'throw new Error("publisher must never execute plugin code");';
  const packageFor = (version: string) => Buffer.from(JSON.stringify({ manifest: { id: 'translator', version }, code, sha256: createHash('sha256').update(code).digest('hex') }));
  const run = (version: string) => { const bytes = packageFor(version); fs.writeFileSync(file, bytes);
    const result = spawnSync(process.execPath, ['scripts/generatePluginUpdateFeed.mjs', root, '--base-url', `https://github.com/example/plugins/releases/download/v${version}/`], { encoding: 'utf8', timeout: 10_000 });
    expect(result.status, result.stderr).toBe(0); return bytes; };
  const old = run('1.0.0'), updated = run('2.0.0'); run('2.0.0');
  const feed = JSON.parse(fs.readFileSync(output, 'utf8')) as PluginUpdateFeed;
  expect(feed.schemaVersion).toBe(1); expect(feed.plugins).toHaveLength(1);
  expect(feed.plugins[0]?.releases).toMatchObject([
    { version: '2.0.0', manifest: { id: 'translator', version: '2.0.0' }, url: 'https://github.com/example/plugins/releases/download/v2.0.0/translator.laplugin', sha256: createHash('sha256').update(updated).digest('hex') },
    { version: '1.0.0', sha256: createHash('sha256').update(old).digest('hex') },
  ]);
});
