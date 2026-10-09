/** Distribution metadata is versioned separately from the runtime APIs. */
import type { PluginManifest } from './plugin.js';
import type { MusicPluginManifest } from './musicPlugin.js';
export interface PluginUpdateRelease {
  version: string;
  url: string;
  sha256: string;
  manifest: PluginManifest | MusicPluginManifest;
  notes?: string;
}
export interface PluginUpdateFeed {
  schemaVersion: 1;
  plugins: { id: string; releases: PluginUpdateRelease[] }[];
}
export type PluginUpdateChannel = 'stable' | 'prerelease';
export type PluginUpdateSource =
  | { kind: 'official'; channel: 'stable' }
  | { kind: 'github'; repository: string; channel: PluginUpdateChannel }
  | { kind: 'manifest'; url: string; channel: PluginUpdateChannel };

export interface PluginUpdateInfo {
  id: string;
  currentVersion: string;
  source: PluginUpdateSource | null;
  status: 'unchecked' | 'no-source' | 'checking' | 'up-to-date' | 'available' | 'incompatible' | 'error' | 'updating';
  checkedAt?: number;
  latestVersion?: string;
  targetVersion?: string;
  notes?: string;
  error?: string;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export function isPluginVersion(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 128) return false;
  const match = VERSION.exec(value);
  return !!match && !(match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0'));
}
export function comparePluginVersions(a: string, b: string): number {
  if (!isPluginVersion(a) || !isPluginVersion(b)) throw new Error('Invalid plugin version');
  const x = VERSION.exec(a)!, y = VERSION.exec(b)!;
  for (let index = 1; index <= 3; index++) {
    const left = BigInt(x[index]!), right = BigInt(y[index]!);
    if (left !== right) return left > right ? 1 : -1;
  }
  if (!x[4] || !y[4]) return x[4] === y[4] ? 0 : x[4] ? -1 : 1;
  const left = x[4].split('.'), right = y[4].split('.');
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const l = left[index], r = right[index];
    if (l === r) continue;
    if (l === undefined || r === undefined) return l === undefined ? -1 : 1;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    if (ln && rn) return BigInt(l) > BigInt(r) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return l > r ? 1 : -1;
  }
  return 0;
}

export function pluginUpdateUrl(value: string): URL {
  const url = new URL(value);
  if (value.length > 2048 || url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Update URLs must use HTTPS without credentials or fragments');
  return url;
}
export function validatePluginUpdateSource(value: unknown, id: string): PluginUpdateSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plugin update source');
  const source = value as Record<string, unknown>;
  if (source['kind'] === 'official' && (id === 'qq' || id === 'netease')) return { kind: 'official', channel: 'stable' };
  const channel = source['channel'] ?? 'stable';
  if (channel !== 'stable' && channel !== 'prerelease') throw new Error('Invalid plugin update channel');
  if (source['kind'] === 'github' && typeof source['repository'] === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(source['repository'])
    && !source['repository'].split('/').some(part => part === '.' || part === '..')) return { kind: 'github', repository: source['repository'], channel };
  if (source['kind'] === 'manifest' && typeof source['url'] === 'string') return { kind: 'manifest', url: pluginUpdateUrl(source['url']).href, channel };
  throw new Error('Invalid plugin update source');
}
