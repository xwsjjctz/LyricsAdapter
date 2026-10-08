// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
const script = fileURLToPath(new URL('../../scripts/buildMusicPlugins.mjs', import.meta.url));
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture(code: string) {
 const root = mkdtempSync(path.join(os.tmpdir(), 'la-plugin-build-')); roots.push(root);
 mkdirSync(path.join(root, 'scripts'));
 writeFileSync(path.join(root, 'scripts/build.mjs'), code);
 return root;
}
describe('optional independent music plugin build', () => {
 it('uses the explicitly selected checkout and preserves local edits', () => {
  const root = fixture(`import fs from 'node:fs'; import path from 'node:path'; fs.mkdirSync(process.argv[2], {recursive:true}); fs.writeFileSync(path.join(process.argv[2],'result'),fs.readFileSync('local'));`);
  writeFileSync(path.join(root, 'local'), 'local edits');
  const output = path.join(root, 'out');
  const result = spawnSync(process.execPath, [script, output], { cwd: os.tmpdir(), env: { ...process.env, LYRICS_ADAPTER_MUSIC_PLUGIN_SOURCE: root }, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(path.join(output, 'result'), 'utf8')).toBe('local edits');
  expect(readFileSync(path.join(root, 'local'), 'utf8')).toBe('local edits');
 });
 it('reports missing independent sources without mutating Git or fetching a submodule', () => {
  const root = fixture('');
  const result = spawnSync(process.execPath, [script], { env: { ...process.env, LYRICS_ADAPTER_MUSIC_PLUGIN_SOURCE: path.join(root, 'missing') }, encoding: 'utf8' });
  expect(result.status).toBe(1); expect(result.stderr).toContain('LYRICS_ADAPTER_MUSIC_PLUGIN_SOURCE'); expect(result.stderr).not.toContain('MODULE_NOT_FOUND');
 });
 it('propagates the source build failure', () => {
  const root = fixture('process.exit(17)');
  expect(spawnSync(process.execPath, [script], { env: { ...process.env, LYRICS_ADAPTER_MUSIC_PLUGIN_SOURCE: root } }).status).toBe(17);
 });
});
