import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Self-contained Node CJS entry; packaging never executes plugin code.
const source = path.resolve(process.argv[2] ?? 'examples/plugins/lyric-translation');
const output = path.resolve(process.argv[3] ?? 'dist-plugins');
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
if (!/^[a-z][a-z0-9-]{0,63}$/.test(manifest.id) || !/^[\w.-]+\.cjs$/.test(manifest.main)) throw new Error('Invalid package id or entry');
const result = await build({ entryPoints: [path.join(source, 'index.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false });
const code = result.outputFiles[0].text;
await mkdir(output, { recursive: true });
const file = path.join(output, `${manifest.id}.laplugin`);
await writeFile(file, JSON.stringify({ manifest, code, sha256: createHash('sha256').update(code).digest('hex') }));
console.log(`Plugin package: ${file}`);
