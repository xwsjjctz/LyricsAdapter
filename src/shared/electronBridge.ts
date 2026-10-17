import type { TypedElectronIPC } from '../types/typedIpc';
import type { AppNotificationOptions } from '../types/notification';
import type { DownloadProgressEvent } from '../types/onlineProgress';
import type { IpcEventArgs, IpcInvokeResult, IpcInvoker } from './ipcContract';
import type { MusicPluginInfo } from './musicPlugin';
import type { PluginUpdateInfo } from './pluginUpdate';
import type { UpdaterState } from './updater';

type Unsubscribe = () => void;

/**
 * The exact object electron/preload.ts exposes as `window.electron`. The
 * preload declares `satisfies ElectronBridge`, and the renderer adapter is
 * built on this type, so both sides follow src/shared/ipcContract.ts.
 * Renderer application code reaches it only through services/desktopAdapter.ts.
 */
export interface ElectronBridge {
  platform: string;
  /** Kernel release (`os.release()`), e.g. Darwin 25.x for macOS 26. */
  osRelease: string;
  ipc: TypedElectronIPC;

  onDownloadProgress(callback: (progress: DownloadProgressEvent) => void): void;
  offDownloadProgress(callback: (progress: DownloadProgressEvent) => void): void;

  getAppDataPath: IpcInvoker<'get-app-data-path'>;
  validateFilePath: IpcInvoker<'validate-file-path'>;
  validateAllPaths: IpcInvoker<'validate-all-paths'>;
  saveCoverThumbnail: IpcInvoker<'save-cover-thumbnail'>;
  deleteCoverThumbnail: IpcInvoker<'delete-cover-thumbnail'>;

  minimizeWindow: IpcInvoker<'window-minimize'>;
  maximizeWindow: IpcInvoker<'window-maximize'>;
  closeWindow: IpcInvoker<'window-close'>;
  isMaximized: IpcInvoker<'window-is-maximized'>;
  isFullScreen: IpcInvoker<'window-is-fullscreen'>;
  onFullScreenChange(callback: (isFullScreen: boolean) => void): Unsubscribe;
  /** False while the main window is minimized or hidden. */
  onWindowVisibilityChange(callback: (visible: boolean) => void): Unsubscribe;
  /** The callback's boolean tells the main process whether the final save succeeded. */
  onBeforeWindowClose(callback: () => Promise<boolean> | boolean): Unsubscribe;
  /** Resolves a dropped File to its path and admits it to the audio allowlist. */
  getPathForFile(file: File): string;

  musicPluginCall: IpcInvoker<'music-plugin-call'>;
  pluginHostInfo: IpcInvoker<'plugin-host-info'>;
  pluginUpdateList: IpcInvoker<'plugin-update-list'>;
  pluginCheckUpdates: IpcInvoker<'plugin-check-updates'>;
  pluginUpdate: IpcInvoker<'plugin-update'>;
  pluginSetUpdateSource: IpcInvoker<'plugin-set-update-source'>;
  onPluginUpdatesChanged(callback: (updates: PluginUpdateInfo[]) => void): Unsubscribe;
  pluginProviders: IpcInvoker<'plugin-providers'>;
  pluginTranslate: IpcInvoker<'plugin-translate'>;
  pluginCancel(requestId: string): void;
  pluginConfiguration: IpcInvoker<'plugin-configuration'>;
  pluginSetConfiguration: IpcInvoker<'plugin-set-configuration'>;
  pluginDataInfo: IpcInvoker<'plugin-data-info'>;
  pluginClearCache: IpcInvoker<'plugin-clear-cache'>;
  musicPluginList: IpcInvoker<'music-plugin-list'>;
  musicPluginCatalog: IpcInvoker<'music-plugin-catalog'>;
  musicPluginDownload: IpcInvoker<'music-plugin-download'>;
  musicPluginDirectory: IpcInvoker<'music-plugin-directory'>;
  musicPluginOpenDirectory: IpcInvoker<'music-plugin-open-directory'>;
  onMusicPluginsChanged(callback: (plugins: MusicPluginInfo[]) => void): Unsubscribe;
  musicPluginInstall: IpcInvoker<'music-plugin-install'>;
  musicPluginUninstall: IpcInvoker<'music-plugin-uninstall'>;
  musicPluginSetEnabled: IpcInvoker<'music-plugin-set-enabled'>;
  onMusicPluginSecretsChanged(callback: (id: string) => void): Unsubscribe;

  qqLoginQrStart: IpcInvoker<'qq-login-qr-start'>;
  qqLoginQrPoll: IpcInvoker<'qq-login-qr-poll'>;
  qqLoginRefresh: IpcInvoker<'qq-login-refresh'>;
  neteaseQrKey: IpcInvoker<'netease-qr-key'>;
  neteaseQrCreate: IpcInvoker<'netease-qr-create'>;
  neteaseQrCheck: IpcInvoker<'netease-qr-check'>;
  setOnlineCookie: IpcInvoker<'set-online-cookie'>;
  fetchCoverBase64: IpcInvoker<'fetch-cover-base64'>;

  selectDownloadFolder: IpcInvoker<'select-download-folder'>;
  downloadAndSave: IpcInvoker<'download-and-save'>;
  readAudioMetadata: IpcInvoker<'read-audio-metadata'>;
  writeAudioMetadata: IpcInvoker<'write-audio-metadata'>;
  onShortcut(callback: (...args: IpcEventArgs<'shortcut-triggered'>) => void): Unsubscribe;
  runStartupCleanup: IpcInvoker<'run-startup-cleanup'>;

  checkForUpdates: IpcInvoker<'updater:check'>;
  getUpdaterState: IpcInvoker<'updater:state'>;
  quitAndInstall: IpcInvoker<'updater:quit-and-install'>;
  getAppVersion: IpcInvoker<'app:get-version'>;
  showNotification(title: string, body: string, options?: AppNotificationOptions): Promise<IpcInvokeResult<'notification:show'>>;
  onUpdaterEvent(callback: (state: UpdaterState) => void): void;
  offUpdaterEvent(callback: (state: UpdaterState) => void): void;
}
