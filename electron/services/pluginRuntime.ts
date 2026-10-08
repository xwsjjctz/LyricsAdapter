import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { MusicPluginHost, MusicPlugin } from '../../src/shared/musicPlugin';
import { PLUGIN_CORE_API, type ExtensionType, type ExtensionProviders, type JsonValue, type PluginContext,
  type PluginManifest, type PluginModule, type Disposable, type TranslationRequest, type TranslationResult, type MusicSourceProvider } from '../../src/shared/plugin';
import { validateTranslationRequest, validateTranslationResult } from '../../src/shared/pluginValidation';
import { negotiateExtensions, PLUGIN_ID } from './pluginManifest';

const requirePlugin = createRequire(import.meta.url);
/** Deadlines protect asynchronous requests; trusted Node code can still block the main event loop. */
export async function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, milliseconds = 20_000): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason ?? new Error('Plugin request cancelled'));
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Plugin request timed out')), milliseconds);
  try {
    return await new Promise<T>((resolve, reject) => {
      const cancelled = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', cancelled, { once: true });
      if (controller.signal.aborted) cancelled();
      else Promise.resolve().then(() => work(controller.signal)).then(resolve, reject);
    });
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

export class PluginRuntime {
  failure: string | undefined;
  private lifetime = new AbortController();
  private providers = new Map<string, ExtensionProviders[ExtensionType]>();
  private subscriptions: Disposable[] = [];
  private configurationListeners = new Set<() => void>();
  private localSettings = new Map<string, string>();
  private activation: Promise<void> | undefined;
  private module: PluginModule | undefined;
  private activeCalls = 0;
  private readonly versions;
  constructor(readonly manifest: PluginManifest, private readonly entry: string, private readonly host: MusicPluginHost) {
    this.versions = negotiateExtensions(manifest);
  }
  private ensureLive(): void { if (this.lifetime.signal.aborted) throw new Error('Plugin is inactive'); }
  private key(key: string, area: string): string {
    if (!PLUGIN_ID.test(key)) throw new Error('Invalid plugin data key');
    return `plugin:${this.manifest.id}:${area}:${key}`;
  }
  private read(key: string): string | undefined { return this.host.readSetting ? this.host.readSetting(key) : this.localSettings.get(key); }
  private write(key: string, value: string | undefined): void {
    this.ensureLive();
    if (this.host.writeSetting) this.host.writeSetting(key, value);
    else if (value === undefined) this.localSettings.delete(key); else this.localSettings.set(key, value);
  }
  configuration(): Record<string, string | boolean | number> {
    return Object.fromEntries(Object.entries(this.manifest.contributes.configuration ?? {}).map(([key, field]) => {
      try {
        const value: unknown = JSON.parse(this.read(this.key(key, 'configuration')) ?? 'null');
        if (typeof value === field.type && (!field.enum || field.enum.includes(value as never))) return [key, value as string | boolean | number];
      } catch { /* corrupt values fall back to the declared default */ }
      return [key, field.default];
    }));
  }
  setConfiguration(key: string, value: string | boolean | number): void {
    const field = this.manifest.contributes.configuration?.[key];
    if (!Object.hasOwn(this.manifest.contributes.configuration ?? {}, key) || !field || typeof value !== field.type
      || (typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && value.length > 16_384)
      || (field.enum && !field.enum.includes(value as never))) throw new Error('Invalid plugin configuration value');
    this.write(this.key(key, 'configuration'), JSON.stringify(value));
    for (const listener of this.configurationListeners) { try { listener(); } catch (error) { this.host.logger.warn('[Plugins] Configuration listener failed', error); } }
  }
  private disposable(callback: () => void): Disposable {
    let disposed = false;
    const disposable = { dispose: () => { if (!disposed) { disposed = true; callback(); } } };
    this.subscriptions.push(disposable);
    return disposable;
  }
  private release(disposable: Disposable): void {
    try { disposable.dispose(); } catch (error) { this.host.logger.warn('[Plugins] Cleanup failed', error); }
  }
  private context(): PluginContext {
    return {
      pluginId: this.manifest.id, apiVersions: { coreApi: PLUGIN_CORE_API, extensionApis: this.versions, legacyMusicApi: 1 },
      signal: this.lifetime.signal, subscriptions: new Proxy(this.subscriptions, {
        get: (items, property, receiver) => property === 'push' ? (...entries: Disposable[]) => {
          for (const entry of entries) {
            if (!entry || typeof entry.dispose !== 'function') throw new Error('Invalid plugin subscription');
            if (this.lifetime.signal.aborted) this.release(entry); else items.push(entry);
          }
          return items.length;
        } : Reflect.get(items, property, receiver),
      }), logger: this.host.logger,
      extensions: { register: (type, id, provider) => {
        this.ensureLive();
        if (!Object.hasOwn(this.versions, type) || !this.manifest.contributes.providers.some(p => p.type === type && p.id === id)) throw new Error('Provider is not declared or API is unavailable');
        const key = `${type}:${id}`;
        if (this.providers.has(key)) throw new Error('Provider is already registered');
        if (type === 'lyrics.translation' && typeof (provider as ExtensionProviders['lyrics.translation'])?.translate !== 'function') throw new Error('Invalid translation provider');
        if (type === 'music.source') validateMusicSource(provider as MusicSourceProvider, this.manifest.id);
        this.providers.set(key, provider);
        return this.disposable(() => this.providers.delete(key));
      } },
      storage: {
        get: key => { this.ensureLive(); const value = this.read(this.key(key, 'storage')); return value === undefined ? undefined : JSON.parse(value) as JsonValue; },
        set: (key, value) => {
          const json = JSON.stringify(value);
          if (json === undefined || json.length > 65_536) throw new Error('Plugin storage value exceeds 64 KiB or is not JSON');
          this.write(this.key(key, 'storage'), json);
        },
        delete: key => this.write(this.key(key, 'storage'), undefined),
      },
      secrets: {
        get: key => { this.ensureLive(); this.key(key, 'secret'); if (this.manifest.permissions?.secrets !== 'own') throw new Error('Plugin secrets permission is required'); return this.host.readSecret(key); },
        set: (key, value) => { this.ensureLive(); this.key(key, 'secret'); if (this.manifest.permissions?.secrets !== 'own' || typeof value !== 'string' || value.length > 65_536) throw new Error('Invalid plugin secret or missing permission'); this.host.writeSecrets({ [key]: value }); },
      },
      configuration: {
        get: key => { this.ensureLive(); if (!Object.hasOwn(this.manifest.contributes.configuration ?? {}, key)) throw new Error('Unknown configuration key'); return this.configuration()[key]!; },
        onDidChange: listener => { this.ensureLive(); this.configurationListeners.add(listener); return this.disposable(() => this.configurationListeners.delete(listener)); },
      },
      network: { fetchText: async (url, options = {}) => {
        this.ensureLive();
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !this.manifest.permissions?.network?.includes(parsed.origin)) throw new Error('Network origin is not declared');
        if (options.method && !['GET', 'POST'].includes(options.method)) throw new Error('Unsupported network method');
        if (options.body && Buffer.byteLength(options.body) > 1_000_000) throw new Error('Network request body exceeds 1 MiB');
        return withDeadline(async signal => {
          const response = await fetch(url, { ...options, signal, redirect: 'error' });
          if (!response.ok) throw new Error(`Plugin network HTTP ${response.status}`);
          if (!response.body) return '';
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = []; let size = 0;
          try {
            while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 1_000_000) throw new Error('Network response exceeds 1 MiB'); chunks.push(chunk.value); }
            return Buffer.concat(chunks).toString('utf8');
          } finally { await reader.cancel(); }
        }, AbortSignal.any([this.lifetime.signal, ...(options.signal ? [options.signal] : [])]));
      } },
    };
  }
  activate(): Promise<void> {
    this.ensureLive();
    return this.activation ??= withDeadline(async () => {
      delete requirePlugin.cache[requirePlugin.resolve(this.entry)];
      this.module = requirePlugin(this.entry) as PluginModule;
      if (typeof this.module.activate !== 'function') throw new Error('Plugin must export activate(context)');
      const result = await this.module.activate(this.context());
      if (this.lifetime.signal.aborted) { if (result && typeof result.dispose === 'function') this.release(result); this.ensureLive(); }
      if (result) { if (typeof result.dispose !== 'function') throw new Error('activate must return void or a Disposable'); this.subscriptions.push(result); }
      for (const declaration of this.manifest.contributes.providers) {
        if (this.versions[declaration.type as ExtensionType] && !this.providers.has(`${declaration.type}:${declaration.id}`)) throw new Error(`Provider was not registered: ${declaration.id}`);
      }
    }, this.lifetime.signal).catch(error => { this.failure = (error as Error).message; this.dispose(error as Error); throw error; });
  }
  music(): MusicPlugin {
    this.ensureLive();
    const entry = this.manifest.contributes.providers.find(p => p.type === 'music.source');
    const provider = entry && this.providers.get(`music.source:${entry.id}`);
    if (!provider) throw new Error('Music source is not active');
    return provider as MusicPlugin;
  }
  async callMusic<T>(call: (plugin: MusicPlugin) => Promise<T>): Promise<T> {
    return withDeadline(async () => { await this.activate(); return call(this.music()); }, this.lifetime.signal);
  }
  async translate(id: string, requestValue: TranslationRequest, signal: AbortSignal, requestId: string = randomUUID()): Promise<TranslationResult> {
    const request = validateTranslationRequest(requestValue);
    this.ensureLive();
    if (this.activeCalls >= 4) throw new Error('Plugin request concurrency limit reached');
    this.activeCalls++;
    try {
      return await withDeadline(async callSignal => {
        await this.activate();
        if (callSignal.aborted) throw callSignal.reason;
        const provider = this.providers.get(`lyrics.translation:${id}`) as ExtensionProviders['lyrics.translation'] | undefined;
        if (!provider) throw new Error('Translation provider is unavailable');
        const result = await provider.translate(request, { requestId, signal: callSignal });
        if (callSignal.aborted) throw callSignal.reason;
        return validateTranslationResult(result, request);
      }, AbortSignal.any([signal, this.lifetime.signal]));
    } finally { this.activeCalls--; }
  }
  dispose(reason = new Error('Plugin is inactive')): void {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort(reason);
    for (const subscription of this.subscriptions.splice(0).reverse()) this.release(subscription);
    this.providers.clear(); this.configurationListeners.clear();
    if (this.module?.deactivate) void withDeadline(async () => { await this.module?.deactivate?.(); }, new AbortController().signal, 5000)
      .catch(error => this.host.logger.warn('[Plugins] Deactivation failed', error));
  }
}

export function validateMusicSource(plugin: MusicSourceProvider, id: string): void {
  if (!plugin?.provider || plugin.provider.id !== id || typeof plugin.invoke !== 'function' || typeof plugin.streamHeaders !== 'function' || typeof plugin.validateCookie !== 'function') throw new Error('Invalid music plugin exports');
  for (const method of ['searchMusic', 'getRecommendedSongs', 'getMusicUrl', 'getLyrics', 'getPlaylists', 'getPlaylistSongs', 'requiresCookie'] as const) {
    if (typeof plugin.provider[method] !== 'function') throw new Error(`Missing provider method: ${method}`);
  }
}
