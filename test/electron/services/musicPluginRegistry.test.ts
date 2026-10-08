import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MusicPluginRegistry, validateMusicPluginManifest } from '../../../electron/services/musicPluginRegistry';
import { isSensitiveSettingKey } from '../../../src/shared/persistencePolicy';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const manifest = { id: 'netease', name: 'NetEase', version: '1.0.0', apiVersion: 1, main: 'index.cjs', requiresCookie: false, capabilities: ['search', 'stream'] };
function packageAt(directory: string, version = '1.0.0', invalid = false) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ ...manifest, version }));
  fs.writeFileSync(path.join(directory, 'index.cjs'), invalid ? 'throw new Error("broken plugin")' : `exports.createPlugin = () => ({
    provider: { id: 'netease', searchMusic: async () => ['${version}'], getRecommendedSongs: async () => [],
      getMusicUrl: async () => ({ url: 'https://cdn.example/audio', quality: '320' }), getLyrics: async () => null,
      getPlaylists: async () => [], getPlaylistSongs: async () => [], requiresCookie: () => false },
    invoke: async () => null, validateCookie: async () => ({ valid: true }), streamHeaders: () => ({ Referer: 'https://music.163.com' })
  });`);
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-plugin-registry-')); roots.push(root);
  const enabled = new Map<string, boolean>();
  const options = {
    bundledDirectory: path.join(root, 'bundled'), installedDirectory: path.join(root, 'installed'),
    host: () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, readSecret: () => '', writeSecrets: vi.fn() }),
    isEnabled: (id: string) => enabled.get(id) !== false,
    setEnabled: (id: string, value: boolean) => { enabled.set(id, value); },
  };
  packageAt(path.join(options.bundledDirectory, 'netease'));
  return { root, options, registry: new MusicPluginRegistry(options) };
}

describe('music plugin runtime', () => {
  it('rejects incompatible manifests and escaping entry paths before executing code', () => {
    expect(() => validateMusicPluginManifest({ ...manifest, apiVersion: 2 })).toThrow(/API version/);
    for (const main of ['../evil.cjs', '/tmp/evil.cjs', 'nested/evil.cjs', 'entry.js']) {
      expect(() => validateMusicPluginManifest({ ...manifest, main })).toThrow(/entry/);
    }
    expect(() => validateMusicPluginManifest({ ...manifest, id: '../qq' })).toThrow(/manifest/);
  });
  it('dispatches provider methods and persists disablement across restart', async () => {
    const { registry, options } = fixture();
    await expect(registry.call('netease', 'searchMusic', ['query'])).resolves.toEqual(['1.0.0']);
    registry.setEnabled('netease', false);
    await expect(registry.call('netease', 'searchMusic', ['query'])).rejects.toThrow(/disabled/);
    expect(new MusicPluginRegistry(options).list()[0]?.enabled).toBe(false);
    registry.setEnabled('netease', true);
    await expect(registry.call('netease', 'constructor', [])).rejects.toThrow(/Invalid/);
    await expect(registry.call('missing', 'getLyrics', ['song'])).rejects.toThrow(/not installed/);
  });
  it('keeps running code until restart, then selects the installed update', async () => {
    const { root, registry, options } = fixture();
    await registry.call('netease', 'searchMusic', []);
    const source = path.join(root, 'package'); packageAt(source, '2.0.0');
    expect(registry.install(source)[0]).toMatchObject({ version: '2.0.0', origin: 'installed', restartRequired: true });
    await expect(registry.call('netease', 'searchMusic', [])).resolves.toEqual(['1.0.0']);
    const restarted = new MusicPluginRegistry(options);
    await expect(restarted.call('netease', 'searchMusic', [])).resolves.toEqual(['2.0.0']);
    expect(restarted.list()[0]?.restartRequired).toBeUndefined();
  });
  it('refuses a symlink entry and leaves an existing installation intact', async () => {
    const { root, registry, options } = fixture();
    const source = path.join(root, 'package'); packageAt(source, '2.0.0');
    registry.install(source);
    fs.unlinkSync(path.join(source, 'index.cjs'));
    fs.symlinkSync(path.join(options.installedDirectory, 'netease/index.cjs'), path.join(source, 'index.cjs'));
    expect(() => registry.install(source)).toThrow(/entry/);
    await expect(new MusicPluginRegistry(options).call('netease', 'searchMusic', [])).resolves.toEqual(['2.0.0']);
  });
  it('lists a broken local installation with its error instead of hiding the source or using bundled code', async () => {
    const { root, options } = fixture();
    fs.mkdirSync(path.join(root, 'installed/netease'), { recursive: true });
    fs.writeFileSync(path.join(root, 'installed/netease/manifest.json'), '{}');
    fs.mkdirSync(path.join(root, 'installed/.install-leftover'));
    const registry = new MusicPluginRegistry(options);
    expect(registry.list()).toMatchObject([{ id: 'netease', origin: 'installed', error: 'Invalid plugin manifest' }]);
    await expect(registry.call('netease', 'searchMusic', [])).rejects.toThrow('Invalid plugin manifest');
    expect(registry.uninstall('netease')).toMatchObject([{ id: 'netease', origin: 'bundled', version: '1.0.0' }]);
    await expect(registry.call('netease', 'searchMusic', [])).resolves.toEqual(['1.0.0']);
  });
  it('lets a newer bundled plugin supersede a stale local installation', async () => {
    const { root, registry, options } = fixture();
    const source = path.join(root, 'package'); packageAt(source, '1.2.0');
    registry.install(source);
    packageAt(path.join(options.bundledDirectory, 'netease'), '1.10.0');
    const updated = new MusicPluginRegistry(options);
    expect(updated.list()).toMatchObject([{ origin: 'bundled', version: '1.10.0' }]);
    await expect(updated.call('netease', 'searchMusic', [])).resolves.toEqual(['1.10.0']);
    expect(() => updated.install(source)).toThrow(/newer/);
  });
  it('keeps an unloaded source usable after installing an update and blocks only first installations', async () => {
    const { root, registry } = fixture();
    const source = path.join(root, 'package'); packageAt(source, '2.0.0');
    registry.install(source);
    await expect(registry.call('netease', 'searchMusic', [])).resolves.toEqual(['1.0.0']);
    const other = path.join(root, 'other'); packageAt(other);
    fs.writeFileSync(path.join(other, 'manifest.json'), JSON.stringify({ ...manifest, id: 'other' }));
    expect(registry.install(other).find(plugin => plugin.id === 'other')).toMatchObject({ restartRequired: true });
    await expect(registry.call('other', 'searchMusic', [])).rejects.toThrow(/Restart/);
  });
  it('uninstalls a local installation, serving loaded code until restart and bundled code afterwards', async () => {
    const { root, registry, options } = fixture();
    const source = path.join(root, 'package'); packageAt(source, '2.0.0');
    registry.install(source);
    const restarted = new MusicPluginRegistry(options);
    await restarted.call('netease', 'searchMusic', []);
    expect(restarted.uninstall('netease')).toMatchObject([{ origin: 'bundled', version: '1.0.0', restartRequired: true }]);
    await expect(restarted.call('netease', 'searchMusic', [])).resolves.toEqual(['2.0.0']);
    expect(fs.existsSync(path.join(options.installedDirectory, 'netease'))).toBe(false);
    expect(() => restarted.uninstall('netease')).toThrow(/not locally installed/);
    await expect(new MusicPluginRegistry(options).call('netease', 'searchMusic', [])).resolves.toEqual(['1.0.0']);
  });
  it('rejects a plugin whose provider omits a method the host calls', () => {
    const { root, options } = fixture();
    const directory = path.join(root, 'installed/netease'); packageAt(directory, '2.0.0');
    const entry = path.join(directory, 'index.cjs');
    fs.writeFileSync(entry, fs.readFileSync(entry, 'utf8').replace(', requiresCookie: () => false', ''));
    expect(() => new MusicPluginRegistry(options).get('netease')).toThrow('Missing provider method: requiresCookie');
  });
  it('isolates a plugin load failure without preventing the registry from listing sources', () => {
    const { root, options } = fixture();
    packageAt(path.join(root, 'installed/netease'), '2.0.0', true);
    const registry = new MusicPluginRegistry(options);
    expect(() => registry.get('netease')).toThrow('broken plugin');
    expect(registry.list()[0]?.error).toBe('broken plugin');
  });
  it('treats plugin secrets as encrypted data while ordinary plugin settings remain ordinary settings', () => {
    expect(isSensitiveSettingKey('music-plugin:example:secret:cookie')).toBe(true);
    expect(isSensitiveSettingKey('music-plugin:example:enabled')).toBe(false);
    expect(isSensitiveSettingKey('qq_music_credential')).toBe(true);
  });
});
