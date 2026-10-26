// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicPluginRegistry } from '../../../electron/services/musicPluginRegistry';
import { ProcessPluginHandle, type PluginProcessChannel } from '../../../electron/services/pluginProcess';
import type { GuestToHost, HostToGuest, PluginDataSnapshot } from '../../../electron/plugin-host/protocol';
import { inMemorySpawn } from './inMemoryPluginProcess';
import type { PluginManifest, TranslationRequest } from '../../../src/shared/plugin';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); vi.useRealTimers(); });

const legacyManifest = { id: 'indie', name: 'Indie', version: '1.0.0', apiVersion: 1, main: 'index.cjs', requiresCookie: true, capabilities: ['search'] };
const legacyCode = `exports.createPlugin = host => ({
  provider: { id: 'indie', requiresCookie: () => true, getRecommendedSongs: async () => [], getLyrics: async () => null,
    getMusicUrl: async () => ({ url: 'https://cdn.example/a' }), getPlaylists: async () => [], getPlaylistSongs: async () => [],
    searchMusic: async query => { if (query === 'fail') throw new Error('search exploded');
      host.writeSecrets({ seen: query }); return [{ songmid: '1', songname: host.readSecret('cookie') }]; } },
  invoke: async (action, args) => ({ action, args }), validateCookie: async () => ({ valid: true }),
  streamHeaders: cookie => ({ Cookie: cookie, Bad: 1 }),
});`;

function legacyFixture(code = legacyCode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-plugin-process-')); roots.push(root);
  const directory = path.join(root, 'installed', 'indie'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(legacyManifest));
  fs.writeFileSync(path.join(directory, 'index.cjs'), code);
  const secrets: Record<string, string> = { cookie: 'session=1' };
  const writeSecrets = vi.fn((entries: Record<string, string>) => Object.assign(secrets, entries));
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const { spawn, processes } = inMemorySpawn();
  const registry = new MusicPluginRegistry({
    installedDirectory: path.join(root, 'installed'),
    host: () => ({ logger, readSecret: name => secrets[name] ?? '', writeSecrets }),
    isEnabled: () => true, setEnabled: () => {},
    spawn, snapshot: () => ({ secrets: { ...secrets }, settings: {} }),
  });
  return { registry, secrets, writeSecrets, processes, logger };
}

const platformManifest: PluginManifest = { manifestVersion: 1, id: 'translator', name: 'Translator', version: '1.0.0', main: 'index.cjs', coreApi: '^1.0.0',
  extensionApis: { 'lyrics.translation': '^1.0.0' }, permissions: { secrets: 'own' },
  contributes: { providers: [{ type: 'lyrics.translation', id: 'default', name: 'Translation' }], configuration: { prefix: { title: 'Prefix', type: 'string', default: 'one' } } } };
const request: TranslationRequest = { document: { id: 'doc', revision: 'r1', trackId: 't', lines: [{ id: 'line-0', text: 'Hi', startMs: 0 }] }, targetLanguage: 'zh' };
const platformCode = `exports.activate = c => {
  c.storage.set('count', (c.storage.get('count') || 0) + 1);
  c.subscriptions.push({ dispose: () => c.logger.info('dispose') });
  c.configuration.onDidChange(() => c.logger.info('configuration', c.configuration.get('prefix')));
  c.extensions.register('lyrics.translation', 'default', { translate: async ({ document, targetLanguage }, { signal }) => {
    if (document.lines[0].text === 'wait') await new Promise(resolve => signal.addEventListener('abort', () => { c.logger.info('aborted'); resolve(); }, { once: true }));
    return { documentId: document.id, documentRevision: document.revision, targetLanguage,
      lines: document.lines.map(l => ({ lineId: l.id, text: c.configuration.get('prefix') + l.text })) };
  } });
};`;

function platformFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-plugin-process-')); roots.push(root);
  const directory = path.join(root, 'installed', 'translator'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(platformManifest));
  fs.writeFileSync(path.join(directory, 'index.cjs'), platformCode);
  const settings = new Map<string, string>();
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const enabled = new Map<string, boolean>();
  const { spawn, processes } = inMemorySpawn();
  const registry = new MusicPluginRegistry({
    installedDirectory: path.join(root, 'installed'),
    host: () => ({ logger, readSecret: () => '', writeSecrets: vi.fn(),
      readSetting: key => settings.get(key), writeSetting: (key, value) => { if (value === undefined) settings.delete(key); else settings.set(key, value); } }),
    isEnabled: id => enabled.get(id) !== false, setEnabled: (id, value) => { enabled.set(id, value); },
    spawn, snapshot: id => ({ secrets: {}, settings: Object.fromEntries([...settings].filter(([key]) => key.startsWith(`plugin:${id}:`))) }),
  });
  return { registry, settings, logger, processes };
}

describe('plugins in isolated processes', () => {
  it('serves provider calls from a separate host and persists the plugin\'s secret writes in the main process', async () => {
    const { registry, writeSecrets, processes } = legacyFixture();
    await expect(registry.call('indie', 'searchMusic', ['song'])).resolves.toEqual([{ songmid: '1', songname: 'session=1' }]);
    expect(processes).toHaveLength(1);
    await vi.waitFor(() => expect(writeSecrets).toHaveBeenCalledWith({ seen: 'song' }));
    await expect(registry.invoke('indie', 'qr', [1])).resolves.toEqual({ action: 'qr', args: [1] });
    await expect(registry.streamHeaders('indie', 'c=1')).resolves.toEqual({ Cookie: 'c=1' });
    await expect(registry.requiresCookie('indie')).resolves.toBe(true);
    await expect(registry.call('indie', 'searchMusic', ['fail'])).rejects.toThrow('search exploded');
    expect(registry.list()[0]?.error).toBeUndefined();
  });

  it('records a load failure from the plugin process on the plugin', async () => {
    const { registry } = legacyFixture('throw new Error("broken in child")');
    await expect(registry.call('indie', 'searchMusic', ['x'])).rejects.toThrow('broken in child');
    expect(registry.list()[0]?.error).toBe('broken in child');
  });

  it('runs platform plugins remotely: storage, configuration listeners, cancellation and disposal', async () => {
    const { registry, settings, logger, processes } = platformFixture();
    const translate = (text = 'Hi', signal = new AbortController().signal) => registry.translate('translator:default',
      { ...request, document: { ...request.document, lines: [{ id: 'line-0', text, startMs: 0 }] } }, signal, 'req');
    expect((await translate()).lines[0]?.text).toBe('oneHi');
    await vi.waitFor(() => expect(settings.get('plugin:translator:storage:count')).toBe('1'));

    registry.setConfiguration('translator', 'prefix', 'two');
    await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith('configuration', 'two'));
    expect((await translate()).lines[0]?.text).toBe('twoHi');

    const cancel = new AbortController();
    const pending = translate('wait', cancel.signal);
    await new Promise(resolve => setTimeout(resolve, 10));
    cancel.abort(new Error('caller cancelled'));
    await expect(pending).rejects.toThrow('caller cancelled');
    await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith('aborted'));

    registry.setEnabled('translator', false);
    await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith('dispose'));
    await vi.waitFor(() => expect(processes[0]?.killed).toBe(true), { timeout: 2_000 });
  });
});

describe('ProcessPluginHandle supervision', () => {
  const spec = { id: 'stuck', kind: 'legacy' as const, manifest: legacyManifest, entry: '/unused.cjs' };
  const snapshot = (): PluginDataSnapshot => ({ secrets: {}, settings: {} });
  const host = () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, readSecret: () => '', writeSecrets: vi.fn(), writeSetting: vi.fn() });

  /** A process that receives messages but never answers: a plugin blocking its event loop. */
  function silentProcess() {
    const channels: { posted: HostToGuest[]; killed: boolean; exit?: () => void; reply?: (message: GuestToHost) => void }[] = [];
    const spawn = (): PluginProcessChannel => {
      const channel: (typeof channels)[number] = { posted: [], killed: false };
      channels.push(channel);
      return {
        post: message => { channel.posted.push(message); },
        onMessage: listener => { channel.reply = listener; },
        onExit: listener => { channel.exit = listener; },
        kill: () => { channel.killed = true; },
      };
    };
    return { spawn, channels };
  }

  it('times out a blocked plugin, kills the unresponsive process and starts a new one for the next request', async () => {
    vi.useFakeTimers();
    const { spawn, channels } = silentProcess();
    const handle = new ProcessPluginHandle({ spec, host: host(), snapshot, spawn, requestTimeoutMs: 100, pingTimeoutMs: 50 });
    const first = handle.call('searchMusic', []);
    const assertion = expect(first).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(channels[0]?.posted.some(message => message.type === 'ping')).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(channels[0]?.killed).toBe(true);

    void handle.call('searchMusic', []).catch(() => {});
    expect(channels).toHaveLength(2);
    expect(channels[1]?.posted[0]?.type).toBe('init');
  });

  it('keeps a responsive process that is merely slow', async () => {
    vi.useFakeTimers();
    const { spawn, channels } = silentProcess();
    const handle = new ProcessPluginHandle({ spec, host: host(), snapshot, spawn, requestTimeoutMs: 100, pingTimeoutMs: 50 });
    const assertion = expect(handle.call('searchMusic', [])).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    const ping = channels[0]!.posted.find(message => message.type === 'ping') as { nonce: number };
    channels[0]!.reply!({ type: 'pong', nonce: ping.nonce });
    await vi.advanceTimersByTimeAsync(100);
    expect(channels[0]?.killed).toBe(false);
  });

  it('fails pending requests when the process crashes and stops restarting after repeated crashes', async () => {
    const { spawn, channels } = silentProcess();
    const handle = new ProcessPluginHandle({ spec, host: host(), snapshot, spawn });
    for (let crash = 0; crash < 3; crash++) {
      const pending = handle.call('searchMusic', []);
      channels.at(-1)!.exit!();
      await expect(pending).rejects.toThrow('exited unexpectedly');
    }
    expect(handle.failure).toBe('Plugin process crashed repeatedly');
    await expect(handle.call('searchMusic', [])).rejects.toThrow('crashed repeatedly');
    expect(channels).toHaveLength(3);
  });

  it('accepts setting writes only inside the plugin\'s own data area', () => {
    const { spawn, channels } = silentProcess();
    const mainHost = host();
    const handle = new ProcessPluginHandle({ spec, host: mainHost, snapshot, spawn });
    void handle.call('searchMusic', []).catch(() => {});
    channels[0]!.reply!({ type: 'writeSetting', key: 'plugin:stuck:storage:a', value: '1' });
    channels[0]!.reply!({ type: 'writeSetting', key: 'webdav-config', value: '{}' });
    expect(mainHost.writeSetting).toHaveBeenCalledOnce();
    expect(mainHost.writeSetting).toHaveBeenCalledWith('plugin:stuck:storage:a', '1');
    handle.dispose();
  });
});


describe('isolated translation cache control', () => {
 it('forwards reload and clear through the real guest protocol', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-translation-control-')); roots.push(root);
  const directory = path.join(root, 'installed', 'translator'); fs.mkdirSync(directory, { recursive: true });
  const manifest: PluginManifest = { ...platformManifest, extensionApis: { 'lyrics.translation': '^1.3.0' }, contributes: { providers: [{ type: 'lyrics.translation', id: 'default', name: 'Translation', cacheControl: true }] } };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, 'index.cjs'), `exports.activate = c => c.extensions.register('lyrics.translation', 'default', {
   translate: async r => ({documentId:r.document.id,documentRevision:r.document.revision,targetLanguage:r.targetLanguage,lines:[{lineId:'line-0',text:r.cacheMode || 'normal'}]}),
   clearTranslation: async r => c.logger.info('cleared',r.document.trackId,r.targetLanguage)
  });`);
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const { spawn } = inMemorySpawn();
  const registry = new MusicPluginRegistry({ installedDirectory:path.join(root,'installed'), spawn,
   host:() => ({ logger,readSecret:()=>'',writeSecrets:vi.fn() }), isEnabled:()=>true,setEnabled:()=>{} });
  const result = await registry.translate('translator:default', { ...request, cacheMode:'reload' }, new AbortController().signal, 'reload');
  expect(result.lines[0]?.text).toBe('reload');
  await registry.clearTranslation('translator:default', request, new AbortController().signal, 'clear');
  expect(logger.info).toHaveBeenCalledWith('cleared','t','zh');
  registry.dispose();
 });
});
