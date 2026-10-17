import { createHash } from 'node:crypto';
import type { MusicPluginCatalogEntry, OfficialPluginKind } from '../../src/shared/musicPlugin';
import type { MusicPluginRegistry } from './musicPluginRegistry';
import { PLUGIN_ID } from './pluginManifest';

const OWNER = 'xwsjjctz';
const REPOSITORY = `${OWNER}/LyricsAdapter-Music-Plugins`;
const PACKAGE_DIRECTORY = `https://raw.githubusercontent.com/${REPOSITORY}/main/packages/`;
const SOURCES = [{ id: 'qq', name: 'QQ 音乐', kind: 'music.source' }, { id: 'netease', name: '网易云音乐', kind: 'music.source' }] as const;
const KINDS: readonly OfficialPluginKind[] = ['music.source', 'lyrics.translation'];
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
interface ReleaseAsset { name: string; browser_download_url: string; digest?: string }
interface Release { assets: ReleaseAsset[]; tag_name?: string }
const ATTEMPTS = 3;
/** A dropped or timed-out connection is worth retrying; an HTTP answer or a validation failure is final. */
const transient = (error: unknown) => error instanceof TypeError
  || (error instanceof Error && (error.name === 'TimeoutError' || error.message.startsWith('net::ERR_')));
export interface OfficialPluginDownload {
  id: string;
  version: string;
  url: string;
  sha256?: string;
  expectedVersion?: string;
  /** Present for catalog v2 entries. */
  name?: string;
  kind?: OfficialPluginKind;
  description?: string;
}

const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;

/**
 * A v2 package lives next to the catalog (`file`) or in a GitHub Release of a repository
 * owned by the official account (`url`); either way the catalog pins its SHA-256.
 */
function v2PackageUrl(id: string, file: unknown, url: unknown): string {
  if (file !== undefined && url === undefined && file === `${id}.laplugin`) return `${PACKAGE_DIRECTORY}${file}`;
  if (file === undefined && typeof url === 'string') {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/');
    if (parsed.origin === 'https://github.com' && !parsed.search && !parsed.hash && !parsed.username && !parsed.password
      && parts.length === 7 && parts[1] === OWNER && /^[\w.-]+$/.test(parts[2]!) && parts[3] === 'releases' && parts[4] === 'download'
      && /^[\w.-]+$/.test(parts[5]!) && parts[6] === `${id}.laplugin`) return parsed.href;
  }
  throw new Error('Invalid official plugin catalog entry');
}

/** Catalog v2: any plugin id and kind, with a display name; older hosts keep reading catalog.json (v1). */
function parseCatalogV2(bytes: Buffer): OfficialPluginDownload[] {
  const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  if (value['apiVersion'] !== 2 || !Array.isArray(value['plugins']) || value['plugins'].length > 100) throw new Error('Invalid official plugin catalog');
  const ids = new Set<string>();
  return value['plugins'].map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid official plugin catalog entry');
    const { id, name, kind, version, file, url, sha256, description } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !PLUGIN_ID.test(id) || ids.has(id) || !text(name, 100) || !KINDS.includes(kind as OfficialPluginKind)
      || typeof version !== 'string' || !VERSION.test(version) || typeof sha256 !== 'string' || !SHA256.test(sha256)
      || (description !== undefined && !text(description, 500))) throw new Error('Invalid official plugin catalog entry');
    ids.add(id);
    return { id, name, kind: kind as OfficialPluginKind, version, url: v2PackageUrl(id, file, url), sha256, expectedVersion: version,
      ...(description ? { description } : {}) };
  });
}

async function readLimited(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok) throw new Error(`Plugin download failed: HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Plugin download exceeds size limit');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty plugin download');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Plugin download exceeds size limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

/** Only the official catalog can supply downloadable executable packages, each pinned by its SHA-256. */
export class MusicPluginCatalog {
  constructor(private readonly fetcher: Fetcher = fetch, private readonly retryDelay = 1_000) {}
  /** Resolves to null for a missing resource, so callers can fall back instead of failing. */
  private async read(url: string, limit: number, milliseconds: number, headers?: Record<string, string>): Promise<Buffer | null> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.fetcher(url, { ...(headers ? { headers } : {}), signal: AbortSignal.timeout(milliseconds) });
        if (response.status === 404) return null;
        return await readLimited(response, limit);
      } catch (error) {
        if (attempt >= ATTEMPTS || !transient(error)) throw error;
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
      }
    }
  }
  async downloads(): Promise<OfficialPluginDownload[]> {
    // Only a missing v2 catalog falls back; an invalid one is an error, never a silent downgrade.
    const v2 = await this.read(`${PACKAGE_DIRECTORY}catalog.v2.json`, 512 * 1024, 30_000);
    if (v2) return parseCatalogV2(v2);
    const catalog = await this.read(`${PACKAGE_DIRECTORY}catalog.json`, 512 * 1024, 30_000);
    if (!catalog) {
      const release = await this.release();
      return SOURCES.flatMap(source => {
        const asset = release?.assets.find(item => item.name === `${source.id}.laplugin`);
        if (!asset) return [];
        const url = new URL(asset.browser_download_url);
        if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`/${REPOSITORY}/releases/download/`)) throw new Error('Invalid official plugin download URL');
        return [{ id: source.id, version: release?.tag_name?.replace(/^v/, '') || 'latest', url: url.href,
          ...(asset.digest ? { sha256: asset.digest.replace(/^sha256:/, '') } : {}) }];
      });
    }
    const value = JSON.parse(catalog.toString('utf8')) as Record<string, unknown>;
    if (value['apiVersion'] !== 1 || !Array.isArray(value['plugins'])) throw new Error('Invalid official plugin catalog');
    const ids = new Set<string>();
    return value['plugins'].map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid official plugin catalog entry');
      const { id, version, file, sha256 } = item as Record<string, unknown>;
      if (typeof id !== 'string' || !SOURCES.some(source => source.id === id) || ids.has(id)
        || typeof version !== 'string' || !VERSION.test(version)
        || file !== `${id}.laplugin` || typeof sha256 !== 'string' || !SHA256.test(sha256)) {
        throw new Error('Invalid official plugin catalog entry');
      }
      ids.add(id);
      return { id, version, url: `${PACKAGE_DIRECTORY}${file}`, sha256, expectedVersion: version };
    });
  }
  private async release(): Promise<Release | null> {
    const bytes = await this.read(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, 512 * 1024, 30_000, { Accept: 'application/vnd.github+json' });
    if (!bytes) return null;
    const value = JSON.parse(bytes.toString('utf8')) as Release;
    if (!Array.isArray(value.assets)) throw new Error('Invalid plugin release');
    return value;
  }
  /** QQ and NetEase first (unreleased when absent), then the other catalog plugins in catalog order. */
  async list(): Promise<MusicPluginCatalogEntry[]> {
    const downloads = await this.downloads();
    const builtIn = SOURCES.map(source => {
      const download = downloads.find(item => item.id === source.id);
      return { ...source, ...(download ? { version: download.version } : {}) };
    });
    const others = downloads.filter(download => download.name && download.kind && !SOURCES.some(source => source.id === download.id))
      .map(download => ({ id: download.id, name: download.name!, kind: download.kind!, version: download.version,
        ...(download.description ? { description: download.description } : {}) }));
    return [...builtIn, ...others];
  }
  async install(id: string, registry: MusicPluginRegistry) {
    if (typeof id !== 'string' || !PLUGIN_ID.test(id)) throw new Error('Unknown official plugin');
    const download = (await this.downloads()).find(item => item.id === id);
    if (!download) {
      if (SOURCES.some(source => source.id === id)) throw new Error('该插件尚未发布安装包，请稍后重试或安装本地插件。');
      throw new Error('Unknown official plugin');
    }
    const bytes = await this.read(download.url, 24 * 1024 * 1024, 60_000);
    if (!bytes) throw new Error('Plugin download failed: HTTP 404');
    if (download.sha256 && download.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Plugin download checksum mismatch');
    return registry.installPackage(bytes, id, download.expectedVersion);
  }
}
