import { createHash } from 'node:crypto';
import { logger } from '../logger';
import type { MusicPluginInfo } from '../../src/shared/musicPlugin';
import type { PluginUpdateInfo, PluginUpdateRelease, PluginUpdateSource } from '../../src/shared/pluginUpdate';
import { comparePluginVersions, isPluginVersion, pluginUpdateUrl, validatePluginUpdateSource } from '../../src/shared/pluginUpdate';
import { MusicPluginCatalog } from './musicPluginCatalog';
import { MusicPluginRegistry, validateMusicPluginManifest } from './musicPluginRegistry';
import { PLUGIN_ID } from './pluginManifest';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
interface Options {
  registry: MusicPluginRegistry;
  catalog: MusicPluginCatalog;
  fetcher: Fetcher;
  read(key: string): string | undefined;
  write(key: string, value: string): void;
  changed(updates: PluginUpdateInfo[]): void;
  now?: () => number;
}
interface Release extends PluginUpdateRelease { incompatible?: string }
const DAY = 24 * 60 * 60_000;
const SOURCE_KEY = (id: string) => `plugin-installation:${id}:update-source`;
const CACHE_KEY = (id: string) => `plugin-installation:${id}:update-cache`;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sameSource = (a: PluginUpdateSource | null, b: PluginUpdateSource | null) => JSON.stringify(a) === JSON.stringify(b);

/** All executable updates go through the host-owned source binding and installer. */
export class PluginUpdateService {
  private results = new Map<string, PluginUpdateInfo>();
  private checking: Promise<PluginUpdateInfo[]> | undefined;
  private checkGeneration = 0;
  private mutation = false;
  private generation = 0;
  private lifetime = new AbortController();
  private startup: ReturnType<typeof setTimeout> | undefined;
  private periodic: ReturnType<typeof setInterval> | undefined;
  private now: () => number;
  private invalidateChecks(): void {
    this.generation++;
    for (const [id, result] of this.results) if (result.status === 'checking') this.results.delete(id);
  }
  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
    this.installed();
  }
  private plugin(id: string): MusicPluginInfo {
    if (typeof id !== 'string' || !PLUGIN_ID.test(id)) throw new Error('Invalid plugin id');
    const plugin = this.options.registry.list().find(item => item.id === id);
    if (!plugin) throw new Error('Plugin is no longer installed');
    return plugin;
  }
  private source(plugin: MusicPluginInfo): PluginUpdateSource | null {
    try {
      const raw = this.options.read(SOURCE_KEY(plugin.id));
      if (raw === undefined || raw === 'null') return null;
      return validatePluginUpdateSource(JSON.parse(raw), plugin.id);
    } catch (error) { logger.warn('[PluginUpdates] Invalid saved source', plugin.id, error); return null; }
  }
  /** Only first installation adopts a manifest hint; a replacement cannot rebind it. */
  installed(): void {
    for (const plugin of this.options.registry.list()) {
      if (this.options.read(SOURCE_KEY(plugin.id)) === undefined) {
        const source = plugin.update ?? ((plugin.id === 'qq' || plugin.id === 'netease') ? { kind: 'official', channel: 'stable' } as const : null);
        this.options.write(SOURCE_KEY(plugin.id), JSON.stringify(source));
      }
    }
    this.invalidateChecks();
    this.publish();
  }
  private initial(plugin: MusicPluginInfo): PluginUpdateInfo {
    const source = this.source(plugin);
    return { id: plugin.id, currentVersion: plugin.version, source, status: source ? 'unchecked' : 'no-source' };
  }
  list(): PluginUpdateInfo[] {
    return this.options.registry.list().map(plugin => {
      const initial = this.initial(plugin);
      let result = this.results.get(plugin.id);
      if (!result) {
        try {
          const cached = JSON.parse(this.options.read(CACHE_KEY(plugin.id)) ?? 'null') as { schemaVersion?: number; result?: PluginUpdateInfo } | null;
          if (cached?.schemaVersion === 1 && cached.result && ['up-to-date', 'available', 'incompatible', 'error'].includes(cached.result.status)
            && cached.result.id === plugin.id && typeof cached.result.checkedAt === 'number' && Number.isFinite(cached.result.checkedAt)) result = cached.result;
        } catch { /* a cache is disposable, never an installation authority */ }
      }
      if (result && result.currentVersion === plugin.version && sameSource(result.source, initial.source)) return { ...result };
      return initial;
    });
  }
  private publish(): void { this.options.changed(this.list()); }
  private set(result: PluginUpdateInfo, persist = false): void {
    this.results.set(result.id, result);
    if (persist) this.options.write(CACHE_KEY(result.id), JSON.stringify({ schemaVersion: 1, result }));
    this.publish();
  }
  setSource(id: string, value: PluginUpdateSource | null): PluginUpdateInfo[] {
    this.assertIdle(); this.plugin(id);
    const source = value === null ? null : validatePluginUpdateSource(value, id);
    this.options.write(SOURCE_KEY(id), JSON.stringify(source));
    this.options.write(CACHE_KEY(id), 'null');
    this.results.delete(id); this.invalidateChecks(); this.publish();
    return this.list();
  }
  assertIdle(): void { if (this.mutation) throw new Error('Another plugin installation is in progress'); }
  async mutate<T>(operation: () => T | Promise<T>): Promise<T> {
    this.assertIdle(); this.mutation = true; this.invalidateChecks();
    try { return await operation(); }
    finally { this.mutation = false; this.installed(); }
  }
  start(): void {
    if (this.startup || this.periodic) return;
    const check = () => { void this.check(false).catch(error => logger.warn('[PluginUpdates] Background check failed', error)); };
    this.startup = setTimeout(check, 10_000); this.startup.unref();
    this.periodic = setInterval(check, 60 * 60_000); this.periodic.unref();
  }
  dispose(): void {
    this.lifetime.abort(new Error('Plugin updater stopped'));
    clearTimeout(this.startup); clearInterval(this.periodic);
  }
  private async read(url: string, limit = 512 * 1024, milliseconds = 30_000): Promise<Buffer> {
    let current = pluginUpdateUrl(url);
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(milliseconds)]);
    for (let hop = 0; hop <= 5; hop++) {
      const response = await this.options.fetcher(current.href, { signal, redirect: 'manual', headers: { Accept: 'application/vnd.github+json' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || hop === 5) throw new Error('Invalid plugin update redirect');
        current = pluginUpdateUrl(new URL(location, current).href); continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Plugin update HTTP ${response.status}`); }
      if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Plugin update exceeds size limit'); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty plugin update response');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > limit) throw new Error('Plugin update exceeds size limit');
          chunks.push(chunk.value);
        }
        return Buffer.concat(chunks);
      } finally { await reader.cancel(); }
    }
    throw new Error('Invalid plugin update redirect');
  }
  private parseFeed(bytes: Buffer, baseUrl: string, source: PluginUpdateSource): Map<string, Release[]> {
    const feed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!record(feed) || feed['schemaVersion'] !== 1 || !Array.isArray(feed['plugins']) || feed['plugins'].length > 100) throw new Error('Unsupported or invalid plugin update feed');
    const result = new Map<string, Release[]>();
    for (const item of feed['plugins']) {
      if (!record(item) || typeof item['id'] !== 'string' || !PLUGIN_ID.test(item['id']) || result.has(item['id'])
        || !Array.isArray(item['releases']) || item['releases'].length > 100) throw new Error('Invalid plugin update feed entry');
      const versions = new Set<string>();
      const releases: Release[] = item['releases'].map((value: unknown) => {
        if (!record(value) || !isPluginVersion(value['version']) || versions.has(value['version']) || typeof value['url'] !== 'string'
          || typeof value['sha256'] !== 'string' || !/^[a-f0-9]{64}$/.test(value['sha256']) || !record(value['manifest'])
          || value['manifest']['id'] !== item['id'] || value['manifest']['version'] !== value['version']
          || (value['notes'] !== undefined && (typeof value['notes'] !== 'string' || value['notes'].length > 16_384))) throw new Error('Invalid plugin update release');
        versions.add(value['version']);
        const url = pluginUpdateUrl(new URL(value['url'], baseUrl).href);
        if (source.kind === 'github' && (url.origin !== 'https://github.com' || !url.pathname.toLowerCase().startsWith(`/${source.repository.toLowerCase()}/releases/download/`))) throw new Error('Plugin asset must belong to the bound GitHub repository');
        let incompatible: string | undefined;
        try { validateMusicPluginManifest(value['manifest']); }
        catch (error) {
          const message = (error as Error).message;
          if (!message.startsWith('Unsupported ')) throw error;
          incompatible = message;
        }
        return { version: value['version'], url: url.href, sha256: value['sha256'], manifest: value['manifest'] as unknown as PluginUpdateRelease['manifest'],
          ...(typeof value['notes'] === 'string' ? { notes: value['notes'] } : {}), ...(incompatible ? { incompatible } : {}) };
      });
      result.set(item['id'], releases.filter(release => source.channel === 'prerelease' || !release.version.split('+')[0]!.includes('-'))
        .sort((a, b) => comparePluginVersions(b.version, a.version)));
    }
    return result;
  }
  private async releases(source: PluginUpdateSource): Promise<Map<string, Release[]>> {
    if (source.kind === 'official') {
      const downloads = await this.options.catalog.downloads();
      return new Map(downloads.map(download => {
        if (!isPluginVersion(download.version) || !download.sha256 || !/^[a-f0-9]{64}$/.test(download.sha256)) throw new Error('Official release is missing a version or checksum');
        const manifest = { id: download.id, name: download.id, version: download.version, apiVersion: 1, main: 'index.cjs', requiresCookie: false, capabilities: [] };
        return [download.id, [{ version: download.version, url: download.url, sha256: download.sha256, manifest }]];
      }));
    }
    let url: string;
    if (source.kind === 'github') {
      const endpoint = `https://api.github.com/repos/${source.repository}/releases${source.channel === 'stable' ? '/latest' : '?per_page=20'}`;
      const response: unknown = JSON.parse((await this.read(endpoint)).toString('utf8'));
      const releases = Array.isArray(response) ? response : [response];
      const release = releases.find(value => record(value) && !value['draft'] && (source.channel === 'prerelease' || !value['prerelease'])
        && Array.isArray(value['assets']) && value['assets'].some(asset => record(asset) && asset['name'] === 'plugins.update.json'));
      if (!record(release) || !Array.isArray(release['assets'])) throw new Error('Publish plugins.update.json as a GitHub Release asset');
      const asset = release['assets'].find(value => record(value) && value['name'] === 'plugins.update.json');
      if (!record(asset) || typeof asset['browser_download_url'] !== 'string') throw new Error('Missing GitHub update feed');
      const parsed = pluginUpdateUrl(asset['browser_download_url']);
      if (parsed.origin !== 'https://github.com' || !parsed.pathname.toLowerCase().startsWith(`/${source.repository.toLowerCase()}/releases/download/`)) throw new Error('Invalid GitHub update feed URL');
      url = parsed.href;
    } else url = source.url;
    return this.parseFeed(await this.read(url), url, source);
  }
  private select(plugin: MusicPluginInfo, source: PluginUpdateSource, releases: Release[]): { info: PluginUpdateInfo; target?: Release } {
    const newer = releases.filter(release => comparePluginVersions(release.version, plugin.version) > 0);
    const latest = newer[0], target = newer.find(release => !release.incompatible);
    return { info: { id: plugin.id, currentVersion: plugin.version, source, checkedAt: this.now(),
      status: target ? 'available' : latest ? 'incompatible' : 'up-to-date',
      ...(latest ? { latestVersion: latest.version } : {}), ...(target ? { targetVersion: target.version } : {}),
      ...((target ?? latest)?.notes ? { notes: (target ?? latest)!.notes! } : {}),
      ...(!target && latest?.incompatible ? { error: latest.incompatible } : {}) }, ...(target ? { target } : {}) };
  }
  check(force = true): Promise<PluginUpdateInfo[]> {
    if (this.checking) return this.checking.then(() => this.checkGeneration !== this.generation && !this.mutation ? this.check(force) : this.list());
    this.lifetime.signal.throwIfAborted();
    const generation = this.generation;
    this.checkGeneration = generation;
    const feeds = new Map<string, Promise<Map<string, Release[]>>>();
    const queue = [...this.list()];
    const worker = async () => {
      while (queue.length && !this.lifetime.signal.aborted && !this.mutation && generation === this.generation) {
        const old = queue.shift()!;
        if (!old.source) continue;
        const ttl = old.status === 'error' ? 5 * 60_000 : DAY;
        if (!force && old.checkedAt !== undefined && this.now() >= old.checkedAt && this.now() - old.checkedAt < ttl) continue;
        const plugin = this.plugin(old.id), source = old.source;
        this.set({ ...this.initial(plugin), status: 'checking' });
        let result: PluginUpdateInfo;
        try {
          const key = JSON.stringify(source);
          let pending = feeds.get(key);
          if (!pending) { pending = this.releases(source); feeds.set(key, pending); }
          const entries = await pending;
          if (!entries.has(plugin.id)) throw new Error('Plugin is not listed in its update feed');
          result = this.select(plugin, source, entries.get(plugin.id)!).info;
        } catch (error) { result = { ...this.initial(plugin), status: 'error', checkedAt: this.now(), error: (error as Error).message }; }
        if (generation === this.generation && !this.lifetime.signal.aborted) this.set(result, true);
      }
    };
    this.checking = Promise.all(Array.from({ length: 4 }, worker)).then(() => this.list()).finally(() => { this.checking = undefined; });
    return this.checking;
  }
  update(id: string): Promise<MusicPluginInfo[]> {
    return this.mutate(async () => {
      const plugin = this.plugin(id), source = this.source(plugin);
      if (!source) throw new Error('Bind an update source first');
      this.set({ ...this.initial(plugin), status: 'updating' });
      let targetVersion: string | undefined;
      try {
        const entries = await this.releases(source);
        const selection = this.select(plugin, source, entries.get(id) ?? []);
        if (!selection.target) throw new Error(selection.info.error ?? 'No compatible newer plugin version');
        const target = selection.target;
        targetVersion = target.version;
        const bytes = await this.read(target.url, 24 * 1024 * 1024, 60_000);
        if (createHash('sha256').update(bytes).digest('hex') !== target.sha256) throw new Error('Plugin download checksum mismatch');
        this.lifetime.signal.throwIfAborted();
        const plugins = await this.options.registry.updatePackage(bytes, id, target.version);
        this.set({ id, currentVersion: target.version, source, checkedAt: this.now(), status: 'up-to-date' }, true);
        return plugins;
      } catch (error) {
        this.set({ ...this.initial(this.plugin(id)), status: 'error', checkedAt: this.now(), error: (error as Error).message,
          ...(targetVersion ? { targetVersion } : {}) }, true);
        throw error;
      }
    });
  }
}
