import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { MUSIC_PLUGIN_API_VERSION, type MusicPlugin, type MusicPluginHost, type MusicPluginInfo, type MusicPluginManifest } from '../../src/shared/musicPlugin';
import { PLUGIN_ID, validatePlatformManifest, negotiateExtensions } from './pluginManifest';
import { PluginRuntime, validateMusicSource } from './pluginRuntime';
import type { ExtensionType, PluginProviderInfo, TranslationRequest, TranslationResult } from '../../src/shared/plugin';
import { isPluginVersion, comparePluginVersions, validatePluginUpdateSource } from '../../src/shared/pluginUpdate';
import { Script } from 'node:vm';

const requirePlugin = createRequire(import.meta.url);
const PROVIDER_METHODS = new Set(['searchMusic', 'getRecommendedSongs', 'getSongDetails', 'getMusicUrl', 'getLyrics', 'getPlaylists', 'getPlaylistSongs']);

export function validateMusicPluginManifest(value: unknown): MusicPluginManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid plugin manifest');
  const v = value as Record<string, unknown>;
  if (typeof v['id'] !== 'string' || !PLUGIN_ID.test(v['id'])
    || typeof v['name'] !== 'string' || !v['name'].trim()
    || !isPluginVersion(v['version'])
    || (v['homepage'] !== undefined && (typeof v['homepage'] !== 'string' || !v['homepage'].startsWith('https://')))) {
    throw new Error('Invalid plugin manifest');
  }
  if (typeof v['main'] !== 'string' || !/^[\w.-]+\.cjs$/.test(v['main'])) throw new Error('Plugin entry must be a local .cjs file');
  if (v['update'] !== undefined) v['update'] = validatePluginUpdateSource(v['update'], v['id'] as string);
  if (v['manifestVersion'] !== undefined) return validatePlatformManifest(v);
  if (typeof v['requiresCookie'] !== 'boolean' || !Array.isArray(v['capabilities']) || !v['capabilities'].every(c => typeof c === 'string')) throw new Error('Invalid plugin manifest');
  if (v['apiVersion'] !== MUSIC_PLUGIN_API_VERSION) throw new Error(`Unsupported plugin API version: ${String(v['apiVersion'])}`);
  return v as unknown as MusicPluginManifest;
}

function inspectDirectory(directory: string): MusicPluginManifest {
  const root = fs.realpathSync(directory);
  const manifestPath = path.join(root, 'manifest.json');
  if (fs.lstatSync(manifestPath).isSymbolicLink() || fs.statSync(manifestPath).size > 64 * 1024) throw new Error('Invalid manifest file');
  const manifest = validateMusicPluginManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  const entry = path.join(root, manifest.main);
  if (fs.lstatSync(entry).isSymbolicLink() || !fs.statSync(entry).isFile()) throw new Error('Invalid plugin entry');
  return manifest;
}

const compareVersions = comparePluginVersions;

/** `blocked` explains why the package in `directory` must not be loaded in this session. */
interface PluginRecord { info: MusicPluginInfo; directory: string; plugin?: MusicPlugin; runtime?: PluginRuntime; blocked?: string }
interface RegistryOptions {
  bundledDirectory?: string;
  installedDirectory: string;
  host(id: string): MusicPluginHost;
  isEnabled(id: string): boolean;
  setEnabled(id: string, enabled: boolean): void;
}

/** Loads explicitly installed, trusted Node plugins. This is not a code sandbox. */
export class MusicPluginRegistry {
  private records = new Map<string, PluginRecord>();
  constructor(private readonly options: RegistryOptions) { this.discover(); }

  private discover(): void {
    for (const [origin, root] of [['bundled', this.options.bundledDirectory], ['installed', this.options.installedDirectory]] as const) {
      if (!root || !fs.existsSync(root)) continue;
      for (const item of fs.readdirSync(root, { withFileTypes: true })) {
        // Staging leftovers and other non-id names are not plugin packages.
        if (!item.isDirectory() || item.isSymbolicLink() || !PLUGIN_ID.test(item.name)) continue;
        const directory = path.join(root, item.name);
        const enabled = this.options.isEnabled(item.name);
        try {
          const manifest = inspectDirectory(directory);
          if (manifest.id !== item.name) throw new Error('Plugin directory must match its id');
          const bundled = this.records.get(manifest.id);
          // An app update that ships a newer plugin supersedes a stale local installation.
          if (origin === 'installed' && bundled && compareVersions(bundled.info.version, manifest.version) > 0) continue;
          this.records.set(manifest.id, { directory, info: { ...manifest, origin, enabled } });
        } catch (error) {
          const message = (error as Error).message;
          this.options.host(item.name).logger.warn('[MusicPlugins] Failed to discover', item.name, error);
          // An invalid installed override must never silently fall back to bundled code;
          // it stays listed with its error so it can be replaced or uninstalled.
          if (origin === 'installed') this.records.set(item.name, { directory, blocked: message, info: {
            id: item.name, name: item.name, version: '0.0.0', apiVersion: MUSIC_PLUGIN_API_VERSION, main: '',
            requiresCookie: false, capabilities: [], origin, enabled, error: message,
          } });
        }
      }
    }
  }

  list(): MusicPluginInfo[] { return [...this.records.values()].map(record => ({ ...record.info })); }
  private record(id: string): PluginRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`Music plugin is not installed: ${id}`);
    if (!record.info.enabled) throw new Error(`Music plugin is disabled: ${record.info.name}`);
    if (record.blocked) throw new Error(record.blocked);
    return record;
  }
  private runtime(id: string): PluginRuntime {
    const record = this.record(id);
    if (!record.info.platform) throw new Error('This operation requires the platform API');
    return record.runtime ??= new PluginRuntime(record.info.platform, path.join(record.directory, inspectDirectory(record.directory).main), this.options.host(id));
  }
  providers(type: ExtensionType): PluginProviderInfo[] {
    return this.list().flatMap(info => {
      if (!info.enabled || info.error) return [];
      if (!info.platform) return type === 'music.source' ? [{ key: `${info.id}:default`, pluginId: info.id, id: 'default', type, name: info.name, version: info.version }] : [];
      const versions = negotiateExtensions(info.platform);
      return info.platform.contributes.providers.filter(p => p.type === type && versions[type])
        .map(p => ({ key: `${info.id}:${p.id}`, pluginId: info.id, id: p.id, type, name: p.name, version: info.version }));
    });
  }
  async translate(key: string, request: TranslationRequest, signal: AbortSignal, requestId: string): Promise<TranslationResult> {
    const provider = this.providers('lyrics.translation').find(p => p.key === key);
    if (!provider) throw new Error('Translation provider is unavailable');
    const record = this.record(provider.pluginId);
    try { return await this.runtime(provider.pluginId).translate(provider.id, request, signal, requestId); }
    catch (error) {
      // Request failures do not disable a provider; an activation failure does.
      if (record.runtime?.failure) record.info.error = record.runtime.failure;
      throw error;
    }
  }
  configuration(id: string): Record<string, string | boolean | number> { return this.runtime(id).configuration(); }
  markChanged(id: string): void { const record = this.records.get(id); if (record) record.info.revision = (record.info.revision ?? 0) + 1; }
  setConfiguration(id: string, key: string, value: string | boolean | number): void { this.runtime(id).setConfiguration(key, value); this.markChanged(id); }
  dispose(): void { for (const record of this.records.values()) record.runtime?.dispose(); }
  get(id: string): MusicPlugin {
    const record = this.record(id);
    if (record.info.platform) return this.runtime(id).music();
    if (!record.plugin) {
      try {
        // Recheck the entry at load time; no renderer-provided path reaches require().
        const entry = path.join(record.directory, inspectDirectory(record.directory).main);
        const exported = requirePlugin(entry) as { createPlugin?: (host: MusicPluginHost) => MusicPlugin };
        if (typeof exported.createPlugin !== 'function') throw new Error('Plugin must export createPlugin');
        const plugin = exported.createPlugin(this.options.host(id));
        validateMusicSource(plugin, id);
        record.plugin = plugin;
        delete record.info.error;
      } catch (error) {
        record.info.error = (error as Error).message;
        throw error;
      }
    }
    return record.plugin;
  }
  async call(id: string, method: string, args: unknown[]): Promise<unknown> {
    if ((!PROVIDER_METHODS.has(method) && method !== 'validateCookie') || !Array.isArray(args) || args.length > 5) throw new Error('Invalid music plugin call');
    if (this.record(id).info.platform) {
      try { return await this.runtime(id).callMusic(plugin => this.callProvider(plugin, method, args)); }
      catch (error) { const record = this.records.get(id); if (record?.runtime?.failure) record.info.error = record.runtime.failure; throw error; }
    }
    return this.callProvider(this.get(id), method, args);
  }
  private async callProvider(plugin: MusicPlugin, method: string, args: unknown[]): Promise<unknown> {
    if (method === 'validateCookie') {
      if (args.length !== 1 || typeof args[0] !== 'string') throw new Error('Invalid cookie validation call');
      return plugin.validateCookie(args[0]);
    }
    const provider = plugin.provider;
    const fn = provider[method as keyof typeof provider];
    if (typeof fn !== 'function') throw new Error(`Unsupported provider method: ${method}`);
    const result: unknown = await Reflect.apply(fn, provider, args);
    if (['searchMusic', 'getRecommendedSongs', 'getSongDetails', 'getPlaylistSongs'].includes(method) && Array.isArray(result)) {
      return result.map(song => song && typeof song === 'object' && typeof provider.getCoverUrl === 'function'
        ? { ...song, coverUrlFullSize: provider.getCoverUrl(song) } : song);
    }
    return result;
  }
  setEnabled(id: string, enabled: boolean): MusicPluginInfo[] {
    const record = this.records.get(id);
    if (!record || typeof enabled !== 'boolean') throw new Error('Invalid music plugin');
    this.options.setEnabled(id, enabled);
    record.info.enabled = enabled;
    this.markChanged(id);
    if (!enabled) { record.runtime?.dispose(); delete record.runtime; }
    else { if (record.runtime?.failure) { record.runtime.dispose(); delete record.runtime; } delete record.info.error; }
    return this.list();
  }
  private inspectBundled(id: string): MusicPluginManifest | undefined {
    if (!this.options.bundledDirectory) return undefined;
    try { return inspectDirectory(path.join(this.options.bundledDirectory, id)); } catch { return undefined; }
  }
  install(directory: string): MusicPluginInfo[] {
    const stat = fs.statSync(directory);
    if (stat.isFile()) {
      if (stat.size > 24 * 1024 * 1024) throw new Error('Plugin package exceeds 24 MiB');
      return this.installPackage(fs.readFileSync(directory));
    }
    const manifest = inspectDirectory(directory);
    const bundled = this.inspectBundled(manifest.id);
    if (bundled && compareVersions(bundled.version, manifest.version) > 0) {
      throw new Error(`The bundled ${bundled.name} plugin (${bundled.version}) is newer than ${manifest.version}`);
    }
    fs.mkdirSync(this.options.installedDirectory, { recursive: true });
    const target = path.join(fs.realpathSync(this.options.installedDirectory), manifest.id);
    const root = fs.realpathSync(directory);
    if (root === target || root.startsWith(`${target}${path.sep}`)) throw new Error('Cannot install a plugin from its own installation directory');
    // A plugin package consists of a self-contained entry and manifest. No arbitrary
    // tree copy, symlinks, executable installers or archive extraction are needed.
    const bytes = fs.readFileSync(path.join(root, manifest.main));
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Plugin entry exceeds 20 MiB');
    const staging = fs.mkdtempSync(path.join(this.options.installedDirectory, '.install-'));
    try {
      fs.writeFileSync(path.join(staging, manifest.main), bytes);
      fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest.platform ?? manifest));
      if (fs.existsSync(target)) {
        if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Invalid installed plugin directory');
        const backup = `${staging}-previous`;
        fs.renameSync(target, backup);
        try { fs.renameSync(staging, target); } catch (error) { fs.renameSync(backup, target); throw error; }
        fs.rmSync(backup, { recursive: true, force: true });
      } else fs.renameSync(staging, target);
      // Updates retain working code until restart. First installations can load now.
      const previous = this.records.get(manifest.id);
      if (manifest.platform || previous?.info.platform) previous?.runtime?.dispose();
      const working = previous && !previous.blocked && !previous.info.platform && !manifest.platform ? previous : undefined;
      this.records.set(manifest.id, {
        directory: working?.directory ?? target,
        ...(working?.plugin ? { plugin: working.plugin } : {}),
        info: { ...manifest, origin: 'installed', enabled: this.options.isEnabled(manifest.id), revision: (previous?.info.revision ?? 0) + 1, ...(working ? { restartRequired: true } : {}) },
      });
      if (!working && !manifest.platform && this.options.isEnabled(manifest.id)) {
        delete requirePlugin.cache[requirePlugin.resolve(path.join(target, manifest.main))];
        // Keep incompatible packages visible with their error, but unavailable to UI.
        try { this.get(manifest.id); } catch { /* get() records the load error. */ }
      }
      return this.list();
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }
  installPackage(bytes: Uint8Array, expectedId?: string, expectedVersion?: string): MusicPluginInfo[] {
    if (bytes.byteLength > 24 * 1024 * 1024) throw new Error('Plugin package exceeds 24 MiB');
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
    const manifest = validateMusicPluginManifest(value['manifest']);
    if (expectedId && manifest.id !== expectedId) throw new Error('Downloaded plugin id does not match');
    if (expectedVersion && manifest.version !== expectedVersion) throw new Error('Downloaded plugin version does not match');
    const code = value['code'];
    if (typeof code !== 'string' || Buffer.byteLength(code) > 20 * 1024 * 1024) throw new Error('Invalid plugin code');
    if (value['sha256'] !== createHash('sha256').update(code).digest('hex')) throw new Error('Plugin checksum mismatch');
    fs.mkdirSync(this.options.installedDirectory, { recursive: true });
    const staging = fs.mkdtempSync(path.join(this.options.installedDirectory, '.package-'));
    try {
      fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest.platform ?? manifest));
      fs.writeFileSync(path.join(staging, manifest.main), code);
      return this.install(staging);
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }
  /** Online updates keep a filesystem backup through activation of the replacement. */
  async updatePackage(bytes: Uint8Array, id: string, version: string): Promise<MusicPluginInfo[]> {
    const previous = this.records.get(id);
    if (!previous) throw new Error('Plugin is no longer installed');
    // Validate without executing code or disturbing the active version.
    if (bytes.byteLength > 24 * 1024 * 1024) throw new Error('Plugin package exceeds 24 MiB');
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
    const manifest = validateMusicPluginManifest(value['manifest']);
    if (manifest.id !== id || manifest.version !== version) throw new Error('Downloaded plugin id or version does not match');
    if (typeof value['code'] !== 'string' || Buffer.byteLength(value['code']) > 20 * 1024 * 1024
      || value['sha256'] !== createHash('sha256').update(value['code']).digest('hex')) throw new Error('Plugin checksum mismatch');
    new Script(value['code'], { filename: manifest.main });
    fs.mkdirSync(this.options.installedDirectory, { recursive: true });
    const backup = fs.mkdtempSync(path.join(this.options.installedDirectory, '.rollback-'));
    const target = path.join(fs.realpathSync(this.options.installedDirectory), id);
    const hadInstalled = fs.existsSync(target);
    let replaced = false;
    try {
      if (hadInstalled) {
        if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Invalid installed plugin directory');
        fs.cpSync(target, path.join(backup, id), { recursive: true, dereference: false });
      }
      this.installPackage(bytes, id, version);
      replaced = true;
      const next = this.records.get(id)!;
      if (next.info.platform && next.info.enabled) await this.runtime(id).activate();
      if (next.info.error) throw new Error(next.info.error);
      return this.list();
    } catch (error) {
      if (replaced) {
        const replacement = this.records.get(id);
        replacement?.runtime?.dispose();
        fs.rmSync(target, { recursive: true, force: true });
        if (hadInstalled) fs.renameSync(path.join(backup, id), target);
        // The old platform runtime was cancelled during replacement; recreate it lazily.
        if (previous.info.platform) delete previous.runtime;
        previous.info = { ...previous.info, revision: Math.max(previous.info.revision ?? 0, replacement?.info.revision ?? 0) + 1 };
        this.records.set(id, previous);
      }
      throw error;
    } finally { fs.rmSync(backup, { recursive: true, force: true }); }
  }
  /** Removes a local installation; the bundled plugin with the same id takes over again. */
  uninstall(id: string): MusicPluginInfo[] {
    const record = this.records.get(id);
    if (!record || record.info.origin !== 'installed' || !PLUGIN_ID.test(id)) throw new Error('Music plugin is not locally installed');
    record.runtime?.dispose();
    fs.rmSync(path.join(this.options.installedDirectory, id), { recursive: true, force: true });
    const bundled = this.inspectBundled(id);
    if (!bundled) this.records.delete(id);
    else {
      const info: MusicPluginInfo = { ...bundled, origin: 'bundled', enabled: record.info.enabled };
      // Code that is already loaded keeps serving until restart; otherwise the bundled plugin loads on demand.
      this.records.set(id, record.plugin
        ? { directory: record.directory, plugin: record.plugin, info: { ...info, restartRequired: true } }
        : { directory: path.join(this.options.bundledDirectory!, id), info });
    }
    return this.list();
  }
}
