// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicPluginRegistry } from '../../../electron/services/musicPluginRegistry';
import { MusicPluginCatalog } from '../../../electron/services/musicPluginCatalog';
import { PluginUpdateService } from '../../../electron/services/pluginUpdates';
import { comparePluginVersions, isPluginVersion } from '../../../src/shared/pluginUpdate';

const roots: string[] = [], services: PluginUpdateService[] = [], registries: MusicPluginRegistry[] = [];
afterEach(() => { services.splice(0).forEach(service => service.dispose()); registries.splice(0).forEach(registry => registry.dispose()); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
const feedUrl = 'https://publisher.example/plugins.update.json';
const source = { kind: 'manifest', url: feedUrl, channel: 'stable' } as const;
const request = { targetLanguage: 'zh', document: { id: 'doc', revision: 'rev', trackId: 'track', lines: [{ id: 'line', text: 'original' }] } };
function packageFor(id = 'translator', version = '1.0.0', code?: string) {
  const manifest = { manifestVersion: 1, id, name: id, version, main: 'index.cjs', coreApi: '^1.0.0', extensionApis: { 'lyrics.translation': '^1.0.0' },
    update: source, contributes: { providers: [{ type: 'lyrics.translation', id: 'default', name: 'Translator' }], configuration: { prefix: { title: 'Prefix', type: 'string', default: 'Default' } } } };
  const entry = code ?? `exports.activate = c => c.extensions.register('lyrics.translation','default',{translate: async r => ({documentId:r.document.id,documentRevision:r.document.revision,targetLanguage:r.targetLanguage,lines:r.document.lines.map(l=>({lineId:l.id,text:c.configuration.get('prefix')+' ${version}'}))})});`;
  const bytes = Buffer.from(JSON.stringify({ manifest, code: entry, sha256: createHash('sha256').update(entry).digest('hex') }));
  return { manifest, bytes, entry };
}
function release(id = 'translator', version = '2.0.0', code?: string) {
  const pkg = packageFor(id, version, code);
  return { pkg, data: { version, manifest: pkg.manifest, url: `https://publisher.example/${id}-${version}.laplugin`, sha256: createHash('sha256').update(pkg.bytes).digest('hex') } };
}
function fixture(ids = ['translator']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-plugin-updates-')); roots.push(root);
  const settings = new Map<string, string>(), enabled = new Map<string, boolean>();
  const registry = new MusicPluginRegistry({ installedDirectory: path.join(root, 'plugin'), isEnabled: id => enabled.get(id) !== false,
    setEnabled: (id, value) => { enabled.set(id, value); }, host: () => ({ readSetting: key => settings.get(key), writeSetting: (key, value) => { if (value === undefined) settings.delete(key); else settings.set(key, value); },
      readSecret: key => settings.get('secret:'+key) ?? '', writeSecrets: entries => Object.entries(entries).forEach(([key, value]) => settings.set('secret:'+key, value)),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }),
  }); registries.push(registry);
  ids.forEach(id => registry.installPackage(packageFor(id).bytes));
  const updates = ids.map(id => release(id));
  let feed: unknown = { schemaVersion: 1, plugins: updates.map(update => ({ id: update.pkg.manifest.id, releases: [update.data] })) };
  const fetcher = vi.fn(async (url: string) => url === feedUrl ? new Response(JSON.stringify(feed)) : new Response(updates.find(update => update.data.url === url)?.pkg.bytes ?? '', { status: updates.some(update => update.data.url === url) ? 200 : 404 }));
  const changed = vi.fn(); let now = 1000;
  const createService = () => { const service = new PluginUpdateService({ registry, catalog: new MusicPluginCatalog(fetcher), fetcher, read: key => settings.get(key), write: (key, value) => { settings.set(key, value); }, changed, now: () => now }); services.push(service); return service; };
  const service = createService();
  return { root, registry, settings, enabled, fetcher, changed, service, createService, updates, setFeed: (value: unknown) => { feed = value; }, advance: (milliseconds: number) => { now += milliseconds; } };
}

describe('plugin distribution and updates', () => {
  it('checks one shared feed once, caches for 24 hours across restart, and refreshes explicitly', async () => {
    const f = fixture(['translator', 'other']);
    expect(f.service.list().map(info => info.status)).toEqual(['unchecked', 'unchecked']);
    expect((await f.service.check()).map(info => info.status)).toEqual(['available', 'available']);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    const restarted = f.createService();
    expect(restarted.list()[0]).toMatchObject({ targetVersion: '2.0.0', status: 'available' });
    await restarted.check(false); expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.advance(24 * 60 * 60_000); await restarted.check(false); expect(f.fetcher).toHaveBeenCalledTimes(2);
    await restarted.check(); expect(f.fetcher).toHaveBeenCalledTimes(3);
  });
  it('selects the newest compatible stable version and excludes prereleases until opted in', async () => {
    const f = fixture(), stable = release(), next = release('translator', '3.0.0'), preview = release('translator', '4.0.0-beta.1');
    f.setFeed({ schemaVersion: 1, plugins: [{ id: 'translator', releases: [preview.data, { ...next.data, manifest: { ...next.data.manifest, coreApi: '^2.0.0' } }, stable.data] }] });
    expect((await f.service.check())[0]).toMatchObject({ latestVersion: '3.0.0', targetVersion: '2.0.0', status: 'available' });
    f.service.setSource('translator', { ...source, channel: 'prerelease' });
    expect((await f.service.check())[0]).toMatchObject({ latestVersion: '4.0.0-beta.1', targetVersion: '4.0.0-beta.1' });
  });
  it('reports incompatibility without downloading or loading code', async () => {
    const f = fixture(), next = release();
    f.setFeed({ schemaVersion: 1, plugins: [{ id: 'translator', releases: [{ ...next.data, manifest: { ...next.data.manifest, coreApi: '^2.0.0' } }] }] });
    expect((await f.service.check())[0]).toMatchObject({ status: 'incompatible', latestVersion: '2.0.0', error: expect.stringContaining('Unsupported core API') });
    await expect(f.service.update('translator')).rejects.toThrow('Unsupported core API');
    expect(f.fetcher.mock.calls.every(([url]) => url === feedUrl)).toBe(true);
    expect(f.registry.list()[0]?.version).toBe('1.0.0');
  });
  it('updates active code, preserves configuration, secrets and source, and survives rediscovery', async () => {
    const f = fixture();
    f.registry.setConfiguration('translator', 'prefix', 'Saved'); f.settings.set('secret:token', 'private');
    expect((await f.registry.translate('translator:default', request, new AbortController().signal, 'old')).lines[0]?.text).toBe('Saved 1.0.0');
    expect(await f.service.update('translator')).toMatchObject([{ version: '2.0.0', enabled: true }]);
    expect((await f.registry.translate('translator:default', request, new AbortController().signal, 'new')).lines[0]?.text).toBe('Saved 2.0.0');
    expect(f.settings.get('secret:token')).toBe('private');
    expect(f.service.list()[0]).toMatchObject({ currentVersion: '2.0.0', source, status: 'up-to-date' });
    expect(fs.readdirSync(path.join(f.root, 'plugin'))).toEqual(['translator']);
  });
  it('does not activate a disabled replacement or allow a downloaded manifest to change the source', async () => {
    const f = fixture(); f.registry.setEnabled('translator', false);
    const next = release('translator', '2.0.0', 'exports.activate=()=>{throw new Error("must not activate")};');
    const manifest = { ...next.pkg.manifest, update: { ...source, url: 'https://different.example/feed.json' } };
    const bytes = Buffer.from(JSON.stringify({ ...JSON.parse(next.pkg.bytes.toString()), manifest }));
    f.setFeed({ schemaVersion: 1, plugins: [{ id: 'translator', releases: [{ ...next.data, manifest, sha256: createHash('sha256').update(bytes).digest('hex') }] }] });
    f.fetcher.mockImplementation(async url => url === feedUrl ? new Response(JSON.stringify({ schemaVersion: 1, plugins: [{ id: 'translator', releases: [{ ...next.data, manifest, sha256: createHash('sha256').update(bytes).digest('hex') }] }] })) : new Response(bytes));
    expect(await f.service.update('translator')).toMatchObject([{ version: '2.0.0', enabled: false }]);
    expect(f.service.list()[0]?.source).toEqual(source);
  });
  it('restores old files and a working runtime after replacement activation fails', async () => {
    const f = fixture(), next = release('translator', '2.0.0', 'exports.activate=()=>{throw new Error("activation failed")};');
    f.setFeed({ schemaVersion: 1, plugins: [{ id: 'translator', releases: [next.data] }] });
    f.updates.splice(0, 1, next);
    await expect(f.service.update('translator')).rejects.toThrow('activation failed');
    expect(f.registry.list()[0]?.version).toBe('1.0.0');
    expect(JSON.parse(fs.readFileSync(path.join(f.root, 'plugin/translator/manifest.json'), 'utf8')).version).toBe('1.0.0');
    expect((await f.registry.translate('translator:default', request, new AbortController().signal, 'recovered')).lines[0]?.text).toBe('Default 1.0.0');
    expect(f.service.list()[0]).toMatchObject({ status: 'error', targetVersion: '2.0.0' });
  });
  it.each(['checksum', 'id', 'syntax'])('rejects %s failures and leaves the installed version intact', async failure => {
    const f = fixture();
    if (failure === 'checksum') f.updates[0]!.data.sha256 = '0'.repeat(64);
    if (failure === 'id') {
      f.updates[0]!.pkg.bytes = packageFor('different', '2.0.0').bytes;
      f.updates[0]!.data.sha256 = createHash('sha256').update(f.updates[0]!.pkg.bytes).digest('hex');
    }
    if (failure === 'syntax') f.updates.splice(0, 1, release('translator', '2.0.0', 'exports.activate = !!!'));
    f.setFeed({ schemaVersion: 1, plugins: [{ id: 'translator', releases: [f.updates[0]!.data] }] });
    await expect(f.service.update('translator')).rejects.toThrow();
    expect(f.registry.list()[0]?.version).toBe('1.0.0');
    expect(fs.readdirSync(path.join(f.root, 'plugin'))).toEqual(['translator']);
  });
  it('supports legacy official updates while keeping loaded code until restart', async () => {
    const f = fixture([]);
    const legacy = (version: string) => { const manifest = { id: 'qq', name: 'QQ', version, apiVersion: 1, main: 'index.cjs', requiresCookie: false, capabilities: ['search'] };
      const code = `exports.createPlugin=()=>({provider:{id:'qq',searchMusic:async()=>['${version}'],getRecommendedSongs:async()=>[],getMusicUrl:async()=>({}),getLyrics:async()=>null,getPlaylists:async()=>[],getPlaylistSongs:async()=>[],requiresCookie:()=>false},invoke:async()=>null,streamHeaders:()=>({}),validateCookie:async()=>({valid:true})});`;
      return Buffer.from(JSON.stringify({ manifest, code, sha256: createHash('sha256').update(code).digest('hex') })); };
    f.registry.installPackage(legacy('1.0.0')); f.service.installed();
    await f.registry.call('qq', 'searchMusic', []);
    const bytes = legacy('2.0.0');
    f.fetcher.mockImplementation(async url => url.endsWith('catalog.json') ? new Response(JSON.stringify({ apiVersion: 1, plugins: [{ id: 'qq', version: '2.0.0', file: 'qq.laplugin', sha256: createHash('sha256').update(bytes).digest('hex') }] })) : new Response(bytes));
    expect((await f.service.check())[0]?.status).toBe('available');
    expect(await f.service.update('qq')).toMatchObject([{ version: '2.0.0', restartRequired: true }]);
    await expect(f.registry.call('qq', 'searchMusic', [])).resolves.toEqual(['1.0.0']);
  });
  it('loads a GitHub Release feed and refuses packages from another repository', async () => {
    const f = fixture(), githubSource = { kind: 'github', repository: 'author/plugins', channel: 'stable' } as const;
    f.service.setSource('translator', githubSource);
    const feed = 'https://github.com/author/plugins/releases/download/v2/plugins.update.json';
    const next = release();
    f.fetcher.mockImplementation(async url => url.startsWith('https://api.github.com')
      ? new Response(JSON.stringify({ assets: [{ name: 'plugins.update.json', browser_download_url: feed }] }))
      : new Response(JSON.stringify({ schemaVersion: 1, plugins: [{ id: 'translator', releases: [{ ...next.data, url: 'https://github.com/other/repo/releases/download/v2/translator.laplugin' }] }] })));
    expect((await f.service.check())[0]).toMatchObject({ status: 'error', error: expect.stringContaining('bound GitHub repository') });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it('confines a malformed feed entry to its own plugin', async () => {
    const f = fixture(['translator', 'other', 'third']), other = release('other'), third = release('third');
    f.setFeed({ schemaVersion: 1, plugins: [null, { id: 'Not An Id', releases: [] },
      { id: 'translator', releases: [{ ...release().data, version: '2.0' }] }, { id: 'other', releases: [other.data] },
      { id: 'third', releases: [third.data] }, { id: 'third', releases: [third.data] }] });
    const checked = Object.fromEntries((await f.service.check()).map(info => [info.id, info]));
    expect(checked['translator']).toMatchObject({ status: 'error', error: expect.stringContaining('Invalid plugin update release') });
    expect(checked['third']).toMatchObject({ status: 'error', error: expect.stringContaining('Invalid plugin update feed entry') });
    expect(checked['other']).toMatchObject({ status: 'available', targetVersion: '2.0.0' });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    await expect(f.service.update('translator')).rejects.toThrow('Invalid plugin update release');
    expect(f.registry.list().find(plugin => plugin.id === 'translator')?.version).toBe('1.0.0');
    expect((await f.service.update('other')).find(plugin => plugin.id === 'other')?.version).toBe('2.0.0');
  });
  it('does not replace code with the same or an older semantic version', async () => {
    const f = fixture();
    f.setFeed({ schemaVersion: 1, plugins: [{ id: 'translator', releases: [release('translator', '1.0.0+new-build').data, release('translator', '0.9.0').data] }] });
    expect((await f.service.check())[0]?.status).toBe('up-to-date');
    await expect(f.service.update('translator')).rejects.toThrow('No compatible newer');
  });
  it('can turn off update checks and rejects invalid source bindings before fetching', async () => {
    const f = fixture();
    for (const url of ['http://example.com/feed', 'https://user:password@example.com/feed', 'https://example.com/feed#secret']) expect(() => f.service.setSource('translator', { ...source, url })).toThrow();
    f.service.setSource('translator', null);
    expect((await f.service.check())[0]?.status).toBe('no-source'); expect(f.fetcher).not.toHaveBeenCalled();
    await expect(f.service.update('translator')).rejects.toThrow('Bind an update source');
  });
  it('rejects oversized responses and redirects to HTTP', async () => {
    const f = fixture();
    f.fetcher.mockImplementation(async () => new Response('{}', { headers: { 'content-length': '9999999' } }));
    expect((await f.service.check())[0]?.error).toContain('size limit');
    f.fetcher.mockImplementation(async () => new Response(null, { status: 302, headers: { location: 'http://example.com/feed' } }));
    expect((await f.service.check())[0]?.error).toContain('HTTPS');
  });
  it('locks installation mutations while downloading and ignores checks from an old binding', async () => {
    const f = fixture(); let resolve!: (value: Response) => void;
    f.fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const pending = f.service.check();
    f.service.setSource('translator', null);
    resolve(new Response(JSON.stringify({ schemaVersion: 1, plugins: [{ id: 'translator', releases: [f.updates[0]!.data] }] })));
    await pending; expect(f.service.list()[0]?.status).toBe('no-source');
    f.service.setSource('translator', source);
    f.fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const installing = f.service.update('translator');
    expect(() => f.service.setSource('translator', null)).toThrow('in progress');
    await expect(f.service.update('translator')).rejects.toThrow('in progress');
    resolve(new Response(JSON.stringify({ schemaVersion: 1, plugins: [{ id: 'translator', releases: [f.updates[0]!.data] }] })));
    await installing;
  });
});

describe('semantic plugin versions', () => {
  it('orders numeric prereleases correctly, promotes stable releases, and ignores build metadata', () => {
    expect(comparePluginVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1);
    expect(comparePluginVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(comparePluginVersions('1.0.0+abc', '1.0.0+def')).toBe(0);
    expect(comparePluginVersions('10.0.0', '2.0.0')).toBe(1);
    expect(isPluginVersion('1.0.0-beta.01')).toBe(false);
    expect(isPluginVersion('01.0.0')).toBe(false);
  });
});
