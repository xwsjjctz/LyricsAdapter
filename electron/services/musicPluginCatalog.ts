import { createHash } from 'node:crypto';
import type { MusicPluginCatalogEntry } from '../../src/shared/musicPlugin';
import type { MusicPluginRegistry } from './musicPluginRegistry';

const REPOSITORY = 'xwsjjctz/LyricsAdapter-Music-Plugins';
const PACKAGE_DIRECTORY = `https://raw.githubusercontent.com/${REPOSITORY}/main/packages/`;
const SOURCES = [{ id: 'qq', name: 'QQ 音乐' }, { id: 'netease', name: '网易云音乐' }] as const;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
interface ReleaseAsset { name: string; browser_download_url: string; digest?: string }
interface Release { assets: ReleaseAsset[]; tag_name?: string }
export interface OfficialPluginDownload { id: string; version: string; url: string; sha256?: string; expectedVersion?: string }

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

/** Only the official repository can supply downloadable executable packages. */
export class MusicPluginCatalog {
  constructor(private readonly fetcher: Fetcher = fetch) {}
  async downloads(): Promise<OfficialPluginDownload[]> {
    const response = await this.fetcher(`${PACKAGE_DIRECTORY}catalog.json`, { signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) {
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
    const value = JSON.parse((await readLimited(response, 512 * 1024)).toString('utf8')) as Record<string, unknown>;
    if (value['apiVersion'] !== 1 || !Array.isArray(value['plugins'])) throw new Error('Invalid official plugin catalog');
    const ids = new Set<string>();
    return value['plugins'].map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid official plugin catalog entry');
      const { id, version, file, sha256 } = item as Record<string, unknown>;
      if (typeof id !== 'string' || !SOURCES.some(source => source.id === id) || ids.has(id)
        || typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
        || file !== `${id}.laplugin` || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
        throw new Error('Invalid official plugin catalog entry');
      }
      ids.add(id);
      return { id, version, url: `${PACKAGE_DIRECTORY}${file}`, sha256, expectedVersion: version };
    });
  }
  private async release(): Promise<Release | null> {
    const response = await this.fetcher(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return null;
    const value = JSON.parse((await readLimited(response, 512 * 1024)).toString('utf8')) as Release;
    if (!Array.isArray(value.assets)) throw new Error('Invalid plugin release');
    return value;
  }
  async list(): Promise<MusicPluginCatalogEntry[]> {
    const downloads = await this.downloads();
    return SOURCES.map(source => {
      const download = downloads.find(item => item.id === source.id);
      return { ...source, ...(download ? { version: download.version } : {}) };
    });
  }
  async install(id: string, registry: MusicPluginRegistry) {
    if (!SOURCES.some(source => source.id === id)) throw new Error('Unknown official plugin');
    const download = (await this.downloads()).find(item => item.id === id);
    if (!download) throw new Error('该插件尚未发布安装包，请稍后重试或安装本地插件。');
    const bytes = await readLimited(await this.fetcher(download.url, { signal: AbortSignal.timeout(60_000) }), 24 * 1024 * 1024);
    if (download.sha256 && download.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Plugin download checksum mismatch');
    return registry.installPackage(bytes, id, download.expectedVersion);
  }
}
