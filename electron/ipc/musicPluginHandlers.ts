import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { logger } from '../logger';
import { userStateRepository } from '../services/userStateRepository';
import { MusicPluginRegistry } from '../services/musicPluginRegistry';
import type { MusicPlugin } from '../../src/shared/musicPlugin';

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
export function getMusicPluginCookie(id: string): string { return userStateRepository.getSetting(secretKey(id, 'cookie')) ?? ''; }

export function registerMusicPluginHandlers(): void {
  registry = new MusicPluginRegistry({
    bundledDirectory: app.isPackaged ? path.join(process.resourcesPath, 'music-plugins') : path.join(app.getAppPath(), 'dist-music-plugins'),
    installedDirectory: path.join(userStateRepository.directoryPath, 'music-plugins'),
    isEnabled: id => userStateRepository.getSetting(`music-plugin:${id}:enabled`) !== 'false',
    setEnabled: (id, enabled) => userStateRepository.setSetting(`music-plugin:${id}:enabled`, String(enabled)),
    host: id => ({ logger,
      readSecret: name => userStateRepository.getSetting(secretKey(id, name)) ?? '',
      writeSecrets: entries => {
        userStateRepository.setManySettings(Object.fromEntries(Object.entries(entries).map(([name, value]) => [secretKey(id, name), value])));
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('music-plugin-secrets-changed', id);
      },
    }),
  });
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
  ipcMain.handle('music-plugin-set-enabled', (_event, id: string, enabled: boolean) => registry.setEnabled(id, enabled));
  ipcMain.handle('music-plugin-uninstall', (_event, id: string) => registry.uninstall(id));
  ipcMain.handle('music-plugin-install', async () => {
    const result = await dialog.showOpenDialog({ title: 'Install music source plugin', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return registry.install(result.filePaths[0]);
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
