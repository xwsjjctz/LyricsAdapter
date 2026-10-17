// Secure preload script using contextBridge. Every channel goes through the
// typed helpers below, which take their channel names, arguments and results
// from src/shared/ipcContract.ts; the exposed object satisfies ElectronBridge.
import type { TypedElectronIPC } from '../src/types/typedIpc';
import type { SystemLyricsAction } from '../src/types/systemLyrics';
import type { DownloadProgressEvent } from '../src/types/onlineProgress';
import type { ElectronBridge } from '../src/shared/electronBridge';
import type {
  IpcEventArgs,
  IpcEventChannel,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
  IpcSendArgs,
  IpcSendChannel,
} from '../src/shared/ipcContract';
import type { UpdaterState } from '../src/shared/updater';
import { readOsReleaseArgument } from '../src/shared/preloadArguments';

const { contextBridge, ipcRenderer, webUtils } = require('electron') as typeof import('electron');

function invoke<C extends IpcInvokeChannel>(channel: C, ...args: IpcInvokeArgs<C>): Promise<IpcInvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeResult<C>>;
}

/** Bridge method that forwards its arguments unchanged to one invoke channel. */
function invoker<C extends IpcInvokeChannel>(channel: C): (...args: IpcInvokeArgs<C>) => Promise<IpcInvokeResult<C>> {
  return (...args) => invoke(channel, ...args);
}

function listen<C extends IpcEventChannel>(channel: C, callback: (...args: IpcEventArgs<C>) => void): () => void {
  const handler = (_event: unknown, ...args: unknown[]) => callback(...(args as IpcEventArgs<C>));
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

function send<C extends IpcSendChannel>(channel: C, ...args: IpcSendArgs<C>): void {
  ipcRenderer.send(channel, ...args);
}

/** Registers at most one listener per callback, so repeated `on` calls do not stack. */
function keyedListener<C extends IpcEventChannel, T extends (...args: IpcEventArgs<C>) => void>(channel: C) {
  const active = new Map<T, () => void>();
  return {
    on(callback: T): void {
      active.get(callback)?.();
      active.set(callback, listen(channel, callback));
    },
    off(callback: T): void {
      active.get(callback)?.();
      active.delete(callback);
    },
  };
}

function isSystemLyricsAction(action: unknown): action is SystemLyricsAction {
  return action === 'toggle-play' || action === 'previous' || action === 'next';
}

const downloadProgress = keyedListener<'download-progress', (progress: DownloadProgressEvent) => void>('download-progress');
const updaterEvents = keyedListener<'updater-event', (state: UpdaterState) => void>('updater-event');

const typedIpc = {
  settingsPanel: {
    open: invoker('ipc:settingsPanel:open'),
    close: invoker('ipc:settingsPanel:close'),
    prewarm: invoker('ipc:settingsPanel:prewarm'),
    ready: async (height: number, darkMode?: boolean) => invoke('ipc:settingsPanel:ready',
      darkMode === undefined ? height : { height, darkMode }),
    previewOpacity: invoker('ipc:settingsPanel:previewOpacity'),
    forwardShortcut: async (key: string, modifiers: number) => invoke('ipc:settingsPanel:shortcut', { key, modifiers }),
    onSection: callback => listen('settings-panel-section', callback),
    onShortcut: callback => listen('settings-panel-shortcut', callback),
    onPreviewOpacity: callback => listen('settings-panel-preview-opacity', callback),
    onClosed: callback => listen('settings-panel-closed', callback),
  },
  applicationMenu: {
    onAction: callback => listen('application-menu-action', callback),
  },
  contextMenu: {
    popup: invoker('ipc:contextMenu:popup'),
  },
  playerControlbar: {
    start: invoker('ipc:playerControlbar:start'),
    update: invoker('ipc:playerControlbar:update'),
    updateArtwork: invoker('ipc:playerControlbar:artwork'),
    stop: invoker('ipc:playerControlbar:stop'),
    onAction: callback => listen('player-controlbar-action', callback),
  },
  nativePalette: {
    start: invoker('ipc:nativePalette:start'),
    update: invoker('ipc:nativePalette:update'),
    stop: invoker('ipc:nativePalette:stop'),
    onAction: callback => listen('native-palette-action', callback),
  },
  playlistSwitcher: {
    start: invoker('ipc:playlistSwitcher:start'),
    update: invoker('ipc:playlistSwitcher:update'),
    stop: invoker('ipc:playlistSwitcher:stop'),
    onAction: callback => listen('playlist-switcher-action', callback),
  },
  focusGlass: {
    getPlaybackSymbols: invoker('ipc:focusGlass:playbackSymbols'),
    start: invoker('ipc:focusGlass:start'),
    update: invoker('ipc:focusGlass:update'),
    setBackdrop: async (source: string | null) => invoke('ipc:focusGlass:backdrop', { source }),
    stop: invoker('ipc:focusGlass:stop'),
    onAction: callback => listen('focus-glass-action', callback),
    onBackdropLuminance: callback => listen('focus-glass-backdrop', payload => callback(payload.luminance)),
  },
  file: {
    selectAudio: invoker('ipc:file:selectAudio'),
    readAudio: async (filePath: string) => invoke('ipc:file:readAudio', { filePath }),
    allowAudioPath: async (filePath: string) => invoke('ipc:file:allowAudioPath', { filePath }),
  },
  library: {
    loadIndex: invoker('ipc:library:loadIndex'),
    saveIndex: invoker('ipc:library:saveIndex'),
  },
  webdav: {
    propfind: invoker('ipc:webdav:propfind'),
    getRange: invoker('ipc:webdav:getRange'),
    put: invoker('ipc:webdav:put'),
    delete: invoker('ipc:webdav:delete'),
    getRedirect: invoker('ipc:webdav:getRedirect'),
    mkcol: invoker('ipc:webdav:mkcol'),
    test: invoker('ipc:webdav:test'),
  },
  settings: {
    onChanged: callback => listen('settings-changed', callback),
    get: async (key: string) => invoke('ipc:settings:get', { key }),
    getAll: invoker('ipc:settings:getAll'),
    set: async (key: string, value: string) => invoke('ipc:settings:set', { key, value }),
    setMany: async (entries: Record<string, string>) => invoke('ipc:settings:setMany', { entries }),
    delete: async (key: string) => invoke('ipc:settings:delete', { key }),
    replaceAll: async (entries: Record<string, string>) => invoke('ipc:settings:replaceAll', { entries }),
  },
  userData: {
    load: invoker('ipc:userData:load'),
    saveLibraryState: async (tracks: unknown[], playback: Record<string, string>) => (
      invoke('ipc:userData:saveLibraryState', { tracks, playback })
    ),
  },
  persistence: {
    loadBootstrap: invoker('ipc:persistence:loadBootstrap'),
    commitClose: invoker('ipc:persistence:commitClose'),
  },
  systemLyrics: {
    update: invoker('ipc:systemLyrics:update'),
    onAction: callback => listen('system-lyrics-action', action => {
      if (isSystemLyricsAction(action)) callback(action);
    }),
  },
} satisfies TypedElectronIPC;

const bridge = {
  platform: process.platform,
  osRelease: readOsReleaseArgument(process.argv),
  ipc: typedIpc,

  onDownloadProgress: downloadProgress.on,
  offDownloadProgress: downloadProgress.off,

  getAppDataPath: invoker('get-app-data-path'),
  validateFilePath: invoker('validate-file-path'),
  validateAllPaths: invoker('validate-all-paths'),
  saveCoverThumbnail: invoker('save-cover-thumbnail'),
  deleteCoverThumbnail: invoker('delete-cover-thumbnail'),

  minimizeWindow: invoker('window-minimize'),
  maximizeWindow: invoker('window-maximize'),
  closeWindow: async (alreadyFlushed = false) => invoke('window-close', alreadyFlushed),
  isMaximized: invoker('window-is-maximized'),
  isFullScreen: invoker('window-is-fullscreen'),
  onFullScreenChange: callback => listen('fullscreen-changed', callback),
  onWindowVisibilityChange: callback => listen('window-visibility-changed', callback),
  onBeforeWindowClose: callback => listen('window-before-close-flush', async requestId => {
    let saved = false;
    try {
      saved = await callback();
    } catch {
      saved = false;
    }
    send('window-before-close-flush-done', saved, requestId);
  }),
  // Real path of a dropped File (drag-and-drop), admitted to the audio allowlist.
  getPathForFile: (file: File) => {
    const filePath = webUtils.getPathForFile(file);
    invoke('ipc:file:allowAudioPath', { filePath }).catch(() => {});
    return filePath;
  },

  musicPluginCall: invoker('music-plugin-call'),
  pluginHostInfo: invoker('plugin-host-info'),
  pluginUpdateList: invoker('plugin-update-list'),
  pluginCheckUpdates: invoker('plugin-check-updates'),
  pluginUpdate: invoker('plugin-update'),
  pluginSetUpdateSource: invoker('plugin-set-update-source'),
  onPluginUpdatesChanged: callback => listen('plugin-updates-changed', callback),
  pluginProviders: invoker('plugin-providers'),
  pluginTranslate: invoker('plugin-translate'),
  pluginCancel: (requestId: string) => send('plugin-cancel', requestId),
  pluginConfiguration: invoker('plugin-configuration'),
  pluginSetConfiguration: invoker('plugin-set-configuration'),
  musicPluginList: invoker('music-plugin-list'),
  musicPluginCatalog: invoker('music-plugin-catalog'),
  musicPluginDownload: invoker('music-plugin-download'),
  musicPluginDirectory: invoker('music-plugin-directory'),
  musicPluginOpenDirectory: invoker('music-plugin-open-directory'),
  onMusicPluginsChanged: callback => listen('music-plugins-changed', callback),
  musicPluginInstall: invoker('music-plugin-install'),
  musicPluginUninstall: invoker('music-plugin-uninstall'),
  musicPluginSetEnabled: invoker('music-plugin-set-enabled'),
  onMusicPluginSecretsChanged: callback => listen('music-plugin-secrets-changed', callback),

  // QR login and musickey refresh, implemented by the qq / netease plugins
  qqLoginQrStart: invoker('qq-login-qr-start'),
  qqLoginQrPoll: invoker('qq-login-qr-poll'),
  qqLoginRefresh: invoker('qq-login-refresh'),
  neteaseQrKey: invoker('netease-qr-key'),
  neteaseQrCreate: invoker('netease-qr-create'),
  neteaseQrCheck: invoker('netease-qr-check'),
  // Sync an online-source cookie to the main process for the stream:// protocol
  setOnlineCookie: invoker('set-online-cookie'),
  fetchCoverBase64: invoker('fetch-cover-base64'),

  selectDownloadFolder: invoker('select-download-folder'),
  // Download straight to a path in the main process (non-blocking)
  downloadAndSave: invoker('download-and-save'),
  // music-tag-native metadata read / write (with custom QRC/YRC fields)
  readAudioMetadata: invoker('read-audio-metadata'),
  writeAudioMetadata: invoker('write-audio-metadata'),
  onShortcut: callback => listen('shortcut-triggered', callback),
  runStartupCleanup: invoker('run-startup-cleanup'),

  // ---- Auto-updater (electron-updater) ----
  checkForUpdates: invoker('updater:check'),
  // Events may predate the listener, so the current state is also readable.
  getUpdaterState: invoker('updater:state'),
  quitAndInstall: invoker('updater:quit-and-install'),
  getAppVersion: invoker('app:get-version'),
  showNotification: async (title, body, options) => invoke('notification:show', {
    title,
    body,
    ...(options?.silent !== undefined ? { silent: options.silent } : {}),
    ...(options?.artworkUrls ? { artworkUrls: options.artworkUrls } : {}),
  }),
  onUpdaterEvent: updaterEvents.on,
  offUpdaterEvent: updaterEvents.off,
} satisfies ElectronBridge;

contextBridge.exposeInMainWorld('electron', bridge);
