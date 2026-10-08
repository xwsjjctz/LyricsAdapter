import type { OnlineMusicProvider } from './onlineMusic.js';
import type { PluginManifest, PluginElectronAPI } from './plugin.js';

export const MUSIC_PLUGIN_API_VERSION = 1;
export interface MusicPluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  main: string;
  requiresCookie: boolean;
  capabilities: string[];
  homepage?: string;
  /** Present only for activate(context) packages; apiVersion remains a legacy management alias. */
  platform?: PluginManifest;
}
export interface MusicPluginInfo extends MusicPluginManifest {
  enabled: boolean;
  origin: 'bundled' | 'installed';
  error?: string;
  restartRequired?: boolean;
  /** Changes when configuration, credentials or installed platform code change. */
  revision?: number;
}
export interface MusicPluginCatalogEntry {
  id: 'qq' | 'netease';
  name: string;
  version?: string;
}
export interface MusicPluginPackage {
  manifest: MusicPluginManifest;
  code: string;
  sha256: string;
}
export interface MusicPluginHost {
  logger: { debug(...args: unknown[]): void; info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void };
  readSecret(name: string): string;
  writeSecrets(entries: Record<string, string>): void;
  readSetting?(key: string): string | undefined;
  writeSetting?(key: string, value: string | undefined): void;
}
export interface MusicPlugin {
  provider: OnlineMusicProvider;
  validateCookie(cookie: string): Promise<{ valid: boolean; message?: string }>;
  invoke(action: string, args: unknown[]): Promise<unknown>;
  streamHeaders(cookie: string): Record<string, string>;
}
export interface MusicPluginElectronAPI extends PluginElectronAPI {
  musicPluginCall?: (id: string, method: string, args: unknown[]) => Promise<unknown>;
  musicPluginList?: () => Promise<MusicPluginInfo[]>;
  musicPluginInstall?: () => Promise<MusicPluginInfo[] | null>;
  musicPluginUninstall?: (id: string) => Promise<MusicPluginInfo[]>;
  musicPluginSetEnabled?: (id: string, enabled: boolean) => Promise<MusicPluginInfo[]>;
  musicPluginCatalog?: () => Promise<MusicPluginCatalogEntry[]>;
  musicPluginDownload?: (id: string) => Promise<MusicPluginInfo[]>;
  musicPluginDirectory?: () => Promise<string>;
  musicPluginOpenDirectory?: () => Promise<void>;
  onMusicPluginsChanged?: (callback: (plugins: MusicPluginInfo[]) => void) => () => void;
  onMusicPluginSecretsChanged?: (callback: (id: string) => void) => () => void;
}
