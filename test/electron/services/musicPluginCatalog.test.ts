// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicPluginCatalog } from '../../../electron/services/musicPluginCatalog';
import { MusicPluginRegistry } from '../../../electron/services/musicPluginRegistry';
import { prepareMusicPluginDirectory } from '../../../electron/services/musicPluginDirectory';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
const manifest = { id: 'netease', name: 'NetEase', version: '1.0.0', apiVersion: 1, main: 'index.cjs', requiresCookie: false, capabilities: ['search'] };
const code = `exports.createPlugin = () => ({ provider: { id: 'netease', searchMusic: async () => ['installed'], getRecommendedSongs: async () => [], getMusicUrl: async () => ({}), getLyrics: async () => null, getPlaylists: async () => [], getPlaylistSongs: async () => [], requiresCookie: () => false }, invoke: async () => null, validateCookie: async () => ({ valid: true }), streamHeaders: () => ({}) });`;
const bytes = Buffer.from(JSON.stringify({ manifest, code, sha256: createHash('sha256').update(code).digest('hex') }));
const url = 'https://github.com/xwsjjctz/LyricsAdapter-Music-Plugins/releases/download/v1.0.0/netease.laplugin';
const directory = 'https://raw.githubusercontent.com/xwsjjctz/LyricsAdapter-Music-Plugins/main/packages/';
const catalogEntry = { id: 'netease', version: '1.0.0', file: 'netease.laplugin', sha256: createHash('sha256').update(bytes).digest('hex') };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-plugin-download-')); roots.push(root);
  const registry = new MusicPluginRegistry({ installedDirectory: prepareMusicPluginDirectory(root), isEnabled: () => true, setEnabled: vi.fn(),
    host: () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, readSecret: () => '', writeSecrets: vi.fn() }),
  });
  return { root, registry };
}
function downloader(assetUrl = url, data = bytes, digest = `sha256:${createHash('sha256').update(data).digest('hex')}`) {
  return vi.fn(async (input: string) => input === `${directory}catalog.json` ? new Response('', { status: 404 }) : input.includes('api.github.com')
    ? new Response(JSON.stringify({ tag_name: 'v1.0.0', assets: [{ name: 'netease.laplugin', browser_download_url: assetUrl, digest }] }))
    : new Response(data));
}

describe('optional plugin installation', () => {
  it('installs directly from the public repository catalog without a GitHub Release', async () => {
    const { root, registry } = fixture();
    const fetcher = vi.fn(async (input: string) => {
      if (input === `${directory}catalog.json`) return new Response(JSON.stringify({ apiVersion: 1, plugins: [catalogEntry] }));
      if (input === `${directory}netease.laplugin`) return new Response(bytes);
      throw new Error(`Unexpected URL: ${input}`);
    });
    const catalog = new MusicPluginCatalog(fetcher);
    expect(await catalog.list()).toEqual([{ id: 'qq', name: 'QQ 音乐' }, { id: 'netease', name: '网易云音乐', version: '1.0.0' }]);
    expect(await catalog.install('netease', registry)).toMatchObject([{ id: 'netease', version: '1.0.0', enabled: true }]);
    await expect(registry.call('netease', 'searchMusic', [])).resolves.toEqual(['installed']);
    expect(fs.readFileSync(path.join(root, 'plugin/netease/index.cjs'), 'utf8')).toBe(code);
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual([`${directory}catalog.json`, `${directory}catalog.json`, `${directory}netease.laplugin`]);
  });
  it.each([
    { apiVersion: 2, plugins: [catalogEntry] },
    { apiVersion: 1, plugins: [{ ...catalogEntry, file: '../../other.laplugin' }] },
    { apiVersion: 1, plugins: [{ ...catalogEntry, id: 'other' }] },
    { apiVersion: 1, plugins: [{ ...catalogEntry, sha256: 'wrong' }] },
    { apiVersion: 1, plugins: [catalogEntry, catalogEntry] },
  ])('rejects incompatible or invalid repository catalogs before downloading code: %j', async data => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(data)));
    const { registry } = fixture();
    await expect(new MusicPluginCatalog(fetcher).install('netease', registry)).rejects.toThrow('catalog');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(registry.list()).toEqual([]);
  });
  it('rejects a changed package and a version mismatch without creating an installation', async () => {
    const { root, registry } = fixture();
    const fetcher = (entry: typeof catalogEntry, data = bytes) => vi.fn(async (input: string) => input.endsWith('/catalog.json')
      ? new Response(JSON.stringify({ apiVersion: 1, plugins: [entry] })) : new Response(data));
    await expect(new MusicPluginCatalog(fetcher(catalogEntry, Buffer.concat([bytes, Buffer.from(' ')]))).install('netease', registry)).rejects.toThrow('checksum');
    await expect(new MusicPluginCatalog(fetcher({ ...catalogEntry, version: '2.0.0' })).install('netease', registry)).rejects.toThrow('version does not match');
    expect(registry.list()).toEqual([]);
    expect(fs.readdirSync(path.join(root, 'plugin'))).toEqual([]);
  });
  it('starts empty, downloads an official package into plugin/, and enables it immediately', async () => {
    const { root, registry } = fixture();
    expect(registry.list()).toEqual([]);
    const catalog = new MusicPluginCatalog(downloader());
    expect(await catalog.list()).toEqual([{ id: 'qq', name: 'QQ 音乐' }, { id: 'netease', name: '网易云音乐', version: '1.0.0' }]);
    expect(await catalog.install('netease', registry)).toMatchObject([{ id: 'netease', origin: 'installed', enabled: true }]);
    expect(registry.list()[0]?.restartRequired).toBeUndefined();
    await expect(registry.call('netease', 'searchMusic', [])).resolves.toEqual(['installed']);
    expect(fs.readFileSync(path.join(root, 'plugin/netease/index.cjs'), 'utf8')).toBe(code);
    expect(registry.uninstall('netease')).toEqual([]);
  });
  it('shows unreleased plugins and refuses unknown ids without fetching arbitrary URLs', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 }));
    const catalog = new MusicPluginCatalog(fetcher);
    expect((await catalog.list()).every(item => !item.version)).toBe(true);
    const { registry } = fixture();
    await expect(catalog.install('other', registry)).rejects.toThrow('Unknown official plugin');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(catalog.install('netease', registry)).rejects.toThrow('尚未发布');
  });
  it('rejects unofficial download URLs and corrupt assets without changing installed plugins', async () => {
    const { registry } = fixture();
    const fetcher = downloader('https://example.invalid/evil');
    await expect(new MusicPluginCatalog(fetcher).install('netease', registry)).rejects.toThrow('download URL');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(new MusicPluginCatalog(downloader(url, bytes, 'sha256:wrong')).install('netease', registry)).rejects.toThrow('checksum');
    expect(registry.list()).toEqual([]);
  });
  it('retries dropped connections, then surfaces the failure once the attempts are used up', async () => {
    const { registry } = fixture();
    let failures = 2;
    const flaky = vi.fn(async (input: string) => {
      if (input === `${directory}netease.laplugin` && failures-- > 0) throw new Error('net::ERR_TIMED_OUT');
      return input === `${directory}catalog.json` ? new Response(JSON.stringify({ apiVersion: 1, plugins: [catalogEntry] })) : new Response(bytes);
    });
    expect(await new MusicPluginCatalog(flaky, 0).install('netease', registry)).toMatchObject([{ id: 'netease', version: '1.0.0' }]);
    expect(flaky).toHaveBeenCalledTimes(4);
    const offline = vi.fn(async () => { throw new Error('net::ERR_TIMED_OUT'); });
    await expect(new MusicPluginCatalog(offline, 0).list()).rejects.toThrow('net::ERR_TIMED_OUT');
    expect(offline).toHaveBeenCalledTimes(3);
  });
  it('rejects mismatched plugin ids and entry checksums', () => {
    const { registry } = fixture();
    expect(() => registry.installPackage(bytes, 'qq')).toThrow('id does not match');
    const broken = Buffer.from(JSON.stringify({ manifest, code, sha256: 'wrong' }));
    expect(() => registry.installPackage(broken)).toThrow('checksum');
    expect(registry.list()).toEqual([]);
  });
  it('migrates legacy plugins while preserving existing new-directory installations', () => {
    const { root } = fixture();
    fs.mkdirSync(path.join(root, 'music-plugins/qq'), { recursive: true });
    fs.mkdirSync(path.join(root, 'music-plugins/netease'));
    fs.mkdirSync(path.join(root, 'plugin/netease'));
    fs.writeFileSync(path.join(root, 'music-plugins/qq/manifest.json'), 'legacy');
    fs.writeFileSync(path.join(root, 'plugin/netease/manifest.json'), 'new');
    expect(prepareMusicPluginDirectory(root)).toBe(path.join(root, 'plugin'));
    expect(fs.readFileSync(path.join(root, 'plugin/qq/manifest.json'), 'utf8')).toBe('legacy');
    expect(fs.readFileSync(path.join(root, 'plugin/netease/manifest.json'), 'utf8')).toBe('new');
    expect(fs.existsSync(path.join(root, 'music-plugins/netease'))).toBe(true);
  });
});
