import { createRequire } from 'node:module';
import type { MusicPlugin, MusicPluginHost, MusicPluginManifest } from '../../src/shared/musicPlugin';
import type { PluginManifest, TranslationRequest, TranslationResult } from '../../src/shared/plugin';
import { PluginRuntime, validateMusicSource } from './pluginRuntime';

const requirePlugin = createRequire(import.meta.url);

/** Provider methods the host may call on a music source. */
export const PROVIDER_METHODS = new Set(['searchMusic', 'getRecommendedSongs', 'getSongDetails', 'getMusicUrl', 'getLyrics', 'getPlaylists', 'getPlaylistSongs']);

/**
 * One loaded plugin as seen by the registry. The inline implementation runs
 * plugin code in the current process; the process implementation
 * (pluginProcess.ts) runs the inline one inside a utility process and forwards
 * these calls over IPC, so both behave the same apart from isolation.
 */
export interface PluginHandle {
  /** Set when loading or activation failed; the registry shows it as the plugin's error. */
  readonly failure: string | undefined;
  /** Legacy plugins load their module; platform plugins activate. */
  load(): Promise<void>;
  /** A provider method or `validateCookie`. */
  call(method: string, args: unknown[]): Promise<unknown>;
  /** A plugin-specific action, such as the QR login aliases. */
  invoke(action: string, args: unknown[]): Promise<unknown>;
  streamHeaders(cookie: string): Promise<Record<string, string>>;
  translate(providerId: string, request: TranslationRequest, signal: AbortSignal, requestId: string): Promise<TranslationResult>;
  /** The main process wrote new configuration; run the plugin's change listeners. */
  configurationChanged(): void;
  dispose(reason?: Error): void;
}

export interface PluginHandleSpec {
  id: string;
  kind: 'legacy' | 'platform';
  /** The platform manifest for 'platform', the legacy manifest otherwise. */
  manifest: PluginManifest | MusicPluginManifest;
  /** Absolute path of the plugin's entry module. */
  entry: string;
  /** Absolute path of the plugin's private data directory (its cache), outside the package directory. */
  dataDirectory?: string;
}

async function callProvider(plugin: MusicPlugin, method: string, args: unknown[]): Promise<unknown> {
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

/** A legacy `createPlugin(host)` package, loaded once and kept until the process ends. */
class InlineLegacyHandle implements PluginHandle {
  failure: string | undefined;
  private plugin: MusicPlugin | undefined;
  constructor(private readonly spec: PluginHandleSpec, private readonly host: MusicPluginHost) {}
  private loaded(): MusicPlugin {
    if (this.plugin) return this.plugin;
    try {
      const exported = requirePlugin(this.spec.entry) as { createPlugin?: (host: MusicPluginHost) => MusicPlugin };
      if (typeof exported.createPlugin !== 'function') throw new Error('Plugin must export createPlugin');
      const plugin = exported.createPlugin(this.host);
      validateMusicSource(plugin, this.spec.id);
      this.failure = undefined;
      return this.plugin = plugin;
    } catch (error) {
      this.failure = (error as Error).message;
      throw error;
    }
  }
  async load(): Promise<void> { this.loaded(); }
  async call(method: string, args: unknown[]): Promise<unknown> { return callProvider(this.loaded(), method, args); }
  async invoke(action: string, args: unknown[]): Promise<unknown> { return this.loaded().invoke(action, args); }
  async streamHeaders(cookie: string): Promise<Record<string, string>> { return this.loaded().streamHeaders(cookie); }
  async translate(): Promise<TranslationResult> { throw new Error('Translation provider is unavailable'); }
  configurationChanged(): void {}
  dispose(): void {}
}

/** An `activate(context)` package running on PluginRuntime. */
class InlinePlatformHandle implements PluginHandle {
  private readonly runtime: PluginRuntime;
  constructor(spec: PluginHandleSpec, host: MusicPluginHost) {
    this.runtime = new PluginRuntime(spec.manifest as PluginManifest, spec.entry, host, spec.dataDirectory);
  }
  get failure(): string | undefined { return this.runtime.failure; }
  load(): Promise<void> { return this.runtime.activate(); }
  call(method: string, args: unknown[]): Promise<unknown> { return this.runtime.callMusic(plugin => callProvider(plugin, method, args)); }
  invoke(action: string, args: unknown[]): Promise<unknown> { return this.runtime.callMusic(plugin => plugin.invoke(action, args)); }
  streamHeaders(cookie: string): Promise<Record<string, string>> { return this.runtime.callMusic(async plugin => plugin.streamHeaders(cookie)); }
  translate(providerId: string, request: TranslationRequest, signal: AbortSignal, requestId: string): Promise<TranslationResult> {
    return this.runtime.translate(providerId, request, signal, requestId);
  }
  configurationChanged(): void { this.runtime.notifyConfigurationChanged(); }
  dispose(reason?: Error): void { this.runtime.dispose(reason); }
}

/** Runs the plugin in the current process. Used inside the plugin host process and by tests. */
export function createInlineHandle(spec: PluginHandleSpec, host: MusicPluginHost): PluginHandle {
  if (spec.kind === 'platform') return new InlinePlatformHandle(spec, host);
  // A reinstalled package must not be served from Node's module cache.
  delete requirePlugin.cache[requirePlugin.resolve(spec.entry)];
  return new InlineLegacyHandle(spec, host);
}
