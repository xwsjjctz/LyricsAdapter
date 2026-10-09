import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { isPluginVersion } from '../src/shared/pluginUpdate.ts';

// Reads packages as data; never executes third-party plugin code.
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const source = path.resolve(args[0] ?? 'dist-plugins');
const base = option('--base-url');
if (!base) throw new Error('Usage: npm run plugins:feed -- <package-or-directory> --base-url <HTTPS package directory> [--out <feed>] [--notes <text-file>]');
const url = new URL(base);
if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.pathname.endsWith('/')) throw new Error('Package base URL must be an HTTPS directory without credentials or fragments');
const sourceStat = await stat(source);
const output = path.resolve(option('--out') ?? path.join(sourceStat.isDirectory() ? source : path.dirname(source), 'plugins.update.json'));
const notesFile = option('--notes');
const notes = notesFile ? await readFile(path.resolve(notesFile), 'utf8') : undefined;
if (notes && notes.length > 16_384) throw new Error('Release notes exceed 16 KiB');
let feed = { schemaVersion: 1, plugins: [] };
try { feed = JSON.parse(await readFile(output, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (feed.schemaVersion !== 1 || !Array.isArray(feed.plugins)) throw new Error('Invalid existing update feed');
const files = sourceStat.isDirectory() ? (await readdir(source)).filter(name => name.endsWith('.laplugin')).map(name => path.join(source, name)) : [source];
if (!files.length) throw new Error('No .laplugin packages found');
for (const file of files) {
  const bytes = await readFile(file);
  if (bytes.length > 24 * 1024 * 1024) throw new Error('Plugin package exceeds 24 MiB');
  const pkg = JSON.parse(bytes.toString('utf8')), manifest = pkg.manifest;
  if (!manifest || !/^[a-z][a-z0-9-]{0,63}$/.test(manifest.id) || typeof pkg.code !== 'string'
    || pkg.sha256 !== createHash('sha256').update(pkg.code).digest('hex')) throw new Error('Invalid plugin package');
  // Hosts reject a release whose version fails this check, so refuse to publish one.
  if (!isPluginVersion(manifest.version)) throw new Error(`${path.basename(file)} needs a semantic version such as 1.2.3, not ${JSON.stringify(manifest.version)}`);
  const release = { version: manifest.version, manifest, url: new URL(path.basename(file), url).href,
    sha256: createHash('sha256').update(bytes).digest('hex'), ...(notes ? { notes } : {}) };
  let plugin = feed.plugins.find(item => item.id === manifest.id);
  if (!plugin) { plugin = { id: manifest.id, releases: [] }; feed.plugins.push(plugin); }
  // Keep older releases so hosts can select a compatible version independently.
  plugin.releases = [release, ...plugin.releases.filter(item => item.version !== manifest.version)];
  if (plugin.releases.length > 100 || feed.plugins.length > 100) throw new Error('Update feed exceeds release or plugin limit');
}
const json = JSON.stringify(feed, null, 2)+'\n';
if (Buffer.byteLength(json) > 512 * 1024) throw new Error('Update feed exceeds 512 KiB');
await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, json);
console.log(`Plugin update feed: ${output}`);
