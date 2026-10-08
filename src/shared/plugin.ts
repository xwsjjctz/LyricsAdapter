/** Public plugin API. Keep application Track/React/Electron types out of this contract. */
import type { MusicPlugin } from './musicPlugin.js';
import type { OnlineMusicProvider, PlaylistInfo } from './onlineMusic.js';

export const PLUGIN_CORE_API = '1.0.0';
export const PLUGIN_EXTENSION_APIS = { 'music.source': '1.0.0', 'lyrics.translation': '1.0.0' } as const;
export type ExtensionType = keyof typeof PLUGIN_EXTENSION_APIS;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface Disposable { dispose(): void }
export interface ConfigurationField {
  title: string;
  type: 'string' | 'boolean' | 'number';
  default: string | boolean | number;
  enum?: readonly (string | number)[];
}
export interface PluginManifest {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  main: string;
  homepage?: string;
  coreApi: string;
  extensionApis: Partial<Record<ExtensionType, string>>;
  /** Unknown future extension names are allowed here and skipped by older hosts. */
  optionalExtensionApis?: Record<string, string>;
  permissions?: { network?: readonly string[]; secrets?: 'own' };
  contributes: {
    providers: readonly { type: string; id: string; name: string }[];
    configuration?: Record<string, ConfigurationField>;
  };
}
export interface PluginHostInfo {
  coreApi: string;
  extensionApis: Partial<Record<ExtensionType, string>>;
  legacyMusicApi: 1;
}
export interface LyricLine {
  id: string;
  text: string;
  startMs?: number;
  endMs?: number;
  words?: readonly { text: string; startMs: number; endMs: number }[];
}
export interface LyricDocument {
  id: string;
  revision: string;
  /** Opaque identifier; no file path, audio URL or credentials are exposed. */
  trackId: string;
  sourceLanguage?: string;
  lines: readonly LyricLine[];
}
export interface TranslationRequest { document: LyricDocument; targetLanguage: string }
export interface TranslationResult {
  documentId: string;
  documentRevision: string;
  targetLanguage: string;
  lines: readonly { lineId: string; text: string }[];
}
export interface ProviderCallContext { requestId: string; signal: AbortSignal }
export interface LyricsTranslationProvider {
  translate(request: TranslationRequest, context: ProviderCallContext): Promise<TranslationResult>;
}
/** Existing music DTOs with open source IDs; UI integration of custom sources is separate. */
export type MusicSourceProvider = Omit<MusicPlugin, 'provider'> & {
  provider: Omit<OnlineMusicProvider, 'id' | 'getPlaylists'> & {
    readonly id: string;
    getPlaylists(): Promise<(Omit<PlaylistInfo, 'source'> & { source: string })[]>;
  };
};
export interface ExtensionProviders {
  'music.source': MusicSourceProvider;
  'lyrics.translation': LyricsTranslationProvider;
}
export interface PluginContext {
  readonly pluginId: string;
  readonly apiVersions: PluginHostInfo;
  /** Aborted on disable, uninstall, update or failed activation. */
  readonly signal: AbortSignal;
  readonly subscriptions: Disposable[];
  readonly logger: { debug(...args: unknown[]): void; info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void };
  readonly extensions: {
    register<K extends ExtensionType>(type: K, id: string, provider: ExtensionProviders[K]): Disposable;
  };
  readonly storage: { get(key: string): JsonValue | undefined; set(key: string, value: JsonValue): void; delete(key: string): void };
  readonly secrets: { get(key: string): string; set(key: string, value: string): void };
  readonly configuration: { get(key: string): string | boolean | number; onDidChange(listener: () => void): Disposable };
  readonly network: {
    /** HTTPS exact origins, manual redirects, bounded UTF-8 body; rejects non-2xx. */
    fetchText(url: string, options?: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<string>;
  };
}
export interface PluginModule {
  activate(context: PluginContext): void | Disposable | Promise<void | Disposable>;
  deactivate?(): void | Promise<void>;
}
export interface PluginProviderInfo { key: string; pluginId: string; id: string; type: ExtensionType; name: string; version: string }
export interface PluginTranslationCall { requestId: string; providerKey: string; request: TranslationRequest }
export interface PluginElectronAPI {
  pluginHostInfo?: () => Promise<PluginHostInfo>;
  pluginProviders?: (type: ExtensionType) => Promise<PluginProviderInfo[]>;
  pluginTranslate?: (call: PluginTranslationCall) => Promise<TranslationResult>;
  pluginCancel?: (requestId: string) => void;
  pluginConfiguration?: (id: string) => Promise<Record<string, string | boolean | number>>;
  pluginSetConfiguration?: (id: string, key: string, value: string | boolean | number) => Promise<void>;
}
