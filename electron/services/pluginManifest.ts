import type { MusicPluginManifest } from '../../src/shared/musicPlugin';
import { PLUGIN_CORE_API, PLUGIN_EXTENSION_APIS, type PluginManifest, type ExtensionType } from '../../src/shared/plugin';

export const PLUGIN_ID = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function supportsApi(version: string, range: string): boolean {
  if (!/^[~^]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(range) || !VERSION.test(version)) return false;
  const prefix = range[0];
  const wanted = range.replace(/^[~^]/, '').split('.').map(Number);
  const actual = version.split('.').map(Number);
  if (prefix !== '^' && prefix !== '~') return version === range;
  const [major, minor, patch] = wanted as [number, number, number];
  const [a, b, c] = actual as [number, number, number];
  if (a !== major || b < minor || (b === minor && c < patch)) return false;
  // SemVer's ^0.x ranges do not promise compatibility across the first nonzero component.
  if (prefix === '~') return b === minor;
  return major === 0 ? b === minor && (minor !== 0 || c === patch) : true;
}
export function negotiateExtensions(manifest: PluginManifest): Partial<Record<ExtensionType, string>> {
  if (!supportsApi(PLUGIN_CORE_API, manifest.coreApi)) throw new Error(`Unsupported core API: ${manifest.coreApi} (host ${PLUGIN_CORE_API})`);
  const versions: Partial<Record<ExtensionType, string>> = {};
  for (const [type, range] of Object.entries(manifest.extensionApis)) {
    const version = PLUGIN_EXTENSION_APIS[type as ExtensionType];
    if (!version || !supportsApi(version, range)) throw new Error(`Unsupported extension API: ${type} ${range}`);
    versions[type as ExtensionType] = version;
  }
  for (const [type, range] of Object.entries(manifest.optionalExtensionApis ?? {})) {
    const version = PLUGIN_EXTENSION_APIS[type as ExtensionType];
    if (version && supportsApi(version, range)) versions[type as ExtensionType] = version;
  }
  return versions;
}
/** Normalize the new manifest into the old management DTO without changing legacy packages. */
export function validatePlatformManifest(value: Record<string, unknown>): MusicPluginManifest & { platform: PluginManifest } {
  if (value['manifestVersion'] !== 1) throw new Error(`Unsupported plugin manifest version: ${String(value['manifestVersion'])}`);
  if (typeof value['coreApi'] !== 'string' || !record(value['extensionApis'])
    || !Object.values(value['extensionApis']).every(v => typeof v === 'string')
    || (value['optionalExtensionApis'] !== undefined && (!record(value['optionalExtensionApis']) || !Object.values(value['optionalExtensionApis']).every(v => typeof v === 'string')))
    || !record(value['contributes']) || !Array.isArray(value['contributes']['providers'])) throw new Error('Invalid platform manifest');
  const manifest = value as unknown as PluginManifest;
  for (const range of [manifest.coreApi, ...Object.values(manifest.extensionApis), ...Object.values(manifest.optionalExtensionApis ?? {})]) {
    if (!/^[~^]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(range)) throw new Error(`Invalid API range: ${range}`);
  }
  const versions = negotiateExtensions(manifest);
  const keys = new Set<string>();
  for (const item of manifest.contributes.providers) {
    if (!record(item) || typeof item.type !== 'string' || typeof item.id !== 'string' || !PLUGIN_ID.test(item.id)
      || typeof item.name !== 'string' || !item.name.trim()
      || !Object.hasOwn({ ...manifest.extensionApis, ...manifest.optionalExtensionApis }, item.type)
      || keys.has(`${item.type}:${item.id}`)) throw new Error('Invalid provider contribution');
    keys.add(`${item.type}:${item.id}`);
  }
  if (manifest.contributes.providers.filter(p => p.type === 'music.source').length > 1) throw new Error('Only one music source per plugin is supported');
  if (manifest.permissions !== undefined) {
    if (!record(manifest.permissions) || (manifest.permissions.secrets !== undefined && manifest.permissions.secrets !== 'own')
      || (manifest.permissions.network !== undefined && (!Array.isArray(manifest.permissions.network)
        || !manifest.permissions.network.every(origin => {
          try { const url = new URL(origin); return url.protocol === 'https:' && url.origin === origin && !url.username && !url.password; } catch { return false; }
        })))) throw new Error('Invalid plugin permissions');
  }
  const configuration = manifest.contributes.configuration;
  if (configuration !== undefined) {
    if (!record(configuration) || Object.keys(configuration).length > 64) throw new Error('Invalid plugin configuration');
    for (const [key, field] of Object.entries(configuration)) {
      if (!PLUGIN_ID.test(key) || !record(field) || typeof field.title !== 'string' || !field.title.trim()
        || !['string', 'boolean', 'number'].includes(field.type) || typeof field.default !== field.type
        || (typeof field.default === 'number' && !Number.isFinite(field.default)) || (typeof field.default === 'string' && field.default.length > 16_384)
        || (field.enum !== undefined && (!Array.isArray(field.enum) || !field.enum.length || !field.enum.every(v => typeof v === field.type)
          || !field.enum.every(v => typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && v.length <= 16_384)
          || !field.enum.includes(field.default as never)))) throw new Error('Invalid plugin configuration field');
    }
  }
  const music = manifest.contributes.providers.some(p => p.type === 'music.source' && versions['music.source']);
  return { id: manifest.id, name: manifest.name, version: manifest.version, main: manifest.main,
    ...(manifest.homepage ? { homepage: manifest.homepage } : {}), apiVersion: 1, requiresCookie: false,
    capabilities: music ? ['search', 'stream', 'lyrics', 'playlists'] : [], platform: manifest };
}
