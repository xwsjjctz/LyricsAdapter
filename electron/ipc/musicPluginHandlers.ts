import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron';
import { logger } from '../logger';
import { userStateRepository } from '../services/userStateRepository';
import { settingsStore } from '../services/settingsStore';
import { MusicPluginRegistry } from '../services/musicPluginRegistry';
import { MusicPluginCatalog } from '../services/musicPluginCatalog';
import { prepareMusicPluginDirectory } from '../services/musicPluginDirectory';
import type { MusicPlugin } from '../../src/shared/musicPlugin';
import { PLUGIN_CORE_API, PLUGIN_EXTENSION_APIS, type PluginTranslationCall } from '../../src/shared/plugin';

let registry: MusicPluginRegistry;
// Downloads carry only a URL, so the resolving plugin is remembered for as long as
// such a URL can plausibly stay valid and be queued.
const RESOLVED_AUDIO_TTL_MS = 30 * 60_000;
const RESOLVED_AUDIO_LIMIT = 512;
const resolvedAudio = new Map<string, { id: string; expires: number }>();
export function getMusicDownloadHeaders(url: string, cookie: string): Record<string, string> {
  const resolved = resolvedAudio.get(url);
  if (resolved && resolved.expires > Date.now()) return registry.get(resolved.id).streamHeaders(getMusicPluginCookie(resolved.id));
  return { 'User-Agent': 'Mozilla/5.0', ...(cookie ? { Cookie: cookie } : {}) };
}
const LEGACY_SECRET_KEYS: Record<string, Record<string, string>> = {
  qq: { cookie: 'qq_music_cookie', credential: 'qq_music_credential' },
  netease: { cookie: 'netease_cookie' },
};
const secretKey = (id: string, name: string) => {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Invalid plugin secret name');
  const legacy = Object.hasOwn(LEGACY_SECRET_KEYS, id) ? LEGACY_SECRET_KEYS[id]! : {};
  return Object.hasOwn(legacy, name) ? legacy[name]! : `music-plugin:${id}:secret:${name}`;
};
export function getMusicPlugin(id: string): MusicPlugin { return registry.get(id); }
export function getMusicPluginCookie(id: string): string { return settingsStore.get(secretKey(id, 'cookie')) ?? ''; }

export function registerMusicPluginHandlers(): void {
  const directory = prepareMusicPluginDirectory(userStateRepository.directoryPath);
  const catalog = new MusicPluginCatalog((url, init) => net.fetch(url, init));
  registry = new MusicPluginRegistry({
    installedDirectory: directory,
    isEnabled: id => userStateRepository.getSetting(`music-plugin:${id}:enabled`) !== 'false',
    setEnabled: (id, enabled) => userStateRepository.setSetting(`music-plugin:${id}:enabled`, String(enabled)),
    host: id => ({ logger: {
      debug: (...args) => logger.debug(`[Plugin:${id}]`, ...args),
      info: (...args) => logger.info(`[Plugin:${id}]`, ...args),
      warn: (...args) => logger.warn(`[Plugin:${id}]`, ...args),
      error: (...args) => logger.error(`[Plugin:${id}]`, ...args),
    },
      readSetting: key => userStateRepository.getSetting(key),
      writeSetting: (key, value) => { if (value === undefined) userStateRepository.deleteSetting(key); else userStateRepository.setSetting(key, value); },
      // Preserve dev's session-only secrets when secure storage is unavailable.
      readSecret: name => settingsStore.get(secretKey(id, name)) ?? '',
      writeSecrets: entries => {
        settingsStore.setMany(Object.fromEntries(Object.entries(entries).map(([name, value]) => [secretKey(id, name), value])));
        registry.markChanged(id);
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('music-plugin-secrets-changed', id);
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('music-plugins-changed', registry.list());
      },
    }),
  });
  const changed = () => {
    const plugins = registry.list();
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('music-plugins-changed', plugins);
    return plugins;
  };
  app.once('before-quit', () => registry.dispose());
  ipcMain.handle('plugin-host-info', () => ({ coreApi: PLUGIN_CORE_API, extensionApis: PLUGIN_EXTENSION_APIS, legacyMusicApi: 1 }));
  ipcMain.handle('plugin-providers', (_event, type: string) => {
    if (!Object.hasOwn(PLUGIN_EXTENSION_APIS, type)) throw new Error('Unknown extension type');
    return registry.providers(type as keyof typeof PLUGIN_EXTENSION_APIS);
  });
  ipcMain.handle('plugin-configuration', (_event, id: string) => registry.configuration(id));
  ipcMain.handle('plugin-set-configuration', (_event, id: string, key: string, value: string | boolean | number) => { registry.setConfiguration(id, key, value); changed(); });
  const requests = new Map<string, AbortController>();
  const watched = new Set<number>();
  ipcMain.handle('plugin-translate', async (event, call: PluginTranslationCall) => {
    if (!call || typeof call.requestId !== 'string' || !/^[\w-]{1,128}$/.test(call.requestId) || typeof call.providerKey !== 'string') throw new Error('Invalid plugin request');
    const key = `${event.sender.id}:${call.requestId}`;
    if (requests.has(key) || requests.size >= 64) throw new Error('Duplicate or excessive plugin request');
    if (!watched.has(event.sender.id)) {
      watched.add(event.sender.id);
      event.sender.once('destroyed', () => {
        for (const [id, request] of requests) if (id.startsWith(`${event.sender.id}:`)) { request.abort(new Error('Window closed')); requests.delete(id); }
        watched.delete(event.sender.id);
      });
    }
    const controller = new AbortController(); requests.set(key, controller);
    try { return await registry.translate(call.providerKey, call.request, controller.signal, call.requestId); }
    catch (error) { changed(); throw error; }
    finally { requests.delete(key); }
  });
  ipcMain.on('plugin-cancel', (event, requestId: string) => requests.get(`${event.sender.id}:${requestId}`)?.abort(new Error('Plugin request cancelled')));
  ipcMain.handle('music-plugin-call', async (_event, id: string, method: string, args: unknown[]) => {
    const result = await registry.call(id, method, args);
    if (method === 'getMusicUrl' && result && typeof result === 'object' && typeof (result as { url?: unknown }).url === 'string') {
      const url = (result as { url: string }).url;
      resolvedAudio.delete(url);
      resolvedAudio.set(url, { id, expires: Date.now() + RESOLVED_AUDIO_TTL_MS });
      while (resolvedAudio.size > RESOLVED_AUDIO_LIMIT) resolvedAudio.delete(resolvedAudio.keys().next().value!);
    }
    return result;
  });
  ipcMain.handle('music-plugin-list', () => registry.list());
  ipcMain.handle('music-plugin-set-enabled', (_event, id: string, enabled: boolean) => { registry.setEnabled(id, enabled); return changed(); });
  ipcMain.handle('music-plugin-uninstall', (_event, id: string) => { registry.uninstall(id); return changed(); });
  ipcMain.handle('music-plugin-catalog', () => catalog.list());
  ipcMain.handle('music-plugin-directory', () => directory);
  ipcMain.handle('music-plugin-open-directory', async () => {
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });
  ipcMain.handle('music-plugin-download', async (_event, id: string) => { await catalog.install(id, registry); return changed(); });
  ipcMain.handle('music-plugin-install', async () => {
    const result = await dialog.showOpenDialog({ title: 'Install plugin', properties: ['openFile'], filters: [{ name: 'LyricsAdapter Plugin', extensions: ['laplugin'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    registry.install(result.filePaths[0]);
    return changed();
  });
  // Compatibility aliases keep login UI / stored credentials stable. All protocol
  // implementations live inside the selected plugin and obey its enabled state.
  const actions: Record<string, string[]> = {
    qq: ['qq-music-request', 'get-qq-music-url', 'get-qq-music-lyrics', 'qq-login-qr-start', 'qq-login-qr-poll', 'qq-login-refresh'],
    netease: ['netease-request', 'netease-qr-key', 'netease-qr-create', 'netease-qr-check'],
  };
  for (const [id, channels] of Object.entries(actions)) {
    for (const channel of channels) ipcMain.handle(channel, (_event, ...args: unknown[]) => registry.get(id).invoke(channel, args));
  }
  ipcMain.handle('fetch-cover-base64', async (_event, url: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { success: true, dataUrl: `data:${response.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}` };
    } catch (error) { return { success: false, error: (error as Error).message }; }
  });
}
