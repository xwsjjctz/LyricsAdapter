/**
 * Single source of truth for every Electron IPC channel.
 *
 * - `IpcInvokeContract`: renderer → main request/response (`ipcRenderer.invoke`
 *   / `ipcMain.handle`). Each entry is `[args, result]`.
 * - `IpcSendContract`: renderer → main fire-and-forget (`ipcRenderer.send` /
 *   `ipcMain.on`).
 * - `IpcEventContract`: main → renderer events (`webContents.send` /
 *   `ipcRenderer.on`).
 *
 * The preload uses typed `invoke`/`listen`/`send` helpers and the main process
 * registers through `electron/ipc/ipcMainTyped.ts`, so a channel name, argument
 * list or result that disagrees with this table fails to compile on both sides.
 * Arguments still arrive from an untrusted renderer: handlers validate them.
 */
import type {
  IpcResult,
  PersistenceBootstrap,
  PersistenceCloseCommitRequest,
  PersistenceCloseCommitResult,
  UserDataSnapshot,
} from '../types/typedIpc';
import type { SettingsSectionId } from '../types/settingsPanel';
import type { NativeContextMenuRequest } from '../types/nativeContextMenu';
import type { PlayerControlbarAction, PlayerControlbarState } from '../types/playerControlbar';
import type { NativePaletteAction, NativePaletteState } from '../types/nativePalette';
import type { PlaylistSwitcherAction, PlaylistSwitcherState } from '../types/playlistSwitcher';
import type { FocusGlassAction, FocusGlassState, PlaybackSymbols } from '../types/focusGlass';
import type { SystemLyricsAction, SystemLyricsState } from '../types/systemLyrics';
import type { ApplicationMenuAction } from '../types/applicationMenu';
import type { AppNotificationPayload } from '../types/notification';
import type { DownloadProgressEvent } from '../types/onlineProgress';
import type { MusicPluginCatalogEntry, MusicPluginInfo } from './musicPlugin';
import type {
  ExtensionType,
  PluginHostInfo,
  PluginProviderInfo,
  PluginTranslationCall,
  TranslationResult,
} from './plugin';
import type { PluginUpdateInfo, PluginUpdateSource } from './pluginUpdate';
import type { QQCredential } from './qqCredential';
import type { UpdaterState } from './updater';

// ---- Payload and result shapes of the positional channels -----------------

/** 'stored' attaches the saved WebDAV account in the main process; 'none' sends no credentials (e.g. a CDN redirect). */
export type WebdavCredentialMode = 'stored' | 'none';
export interface WebdavRequest { url: string; credentials: WebdavCredentialMode }
export interface WebdavAccountProbe { serverUrl: string; username: string; password: string }
export type PluginConfigurationValue = string | boolean | number;

export interface PathValidationRequest { id: string; filePath?: string | undefined }
export interface PathValidationResult {
  success: boolean;
  results?: { id: string; exists: boolean }[];
  error?: string;
}

export interface CoverThumbnailRequest { id: string; data: string; mime: string }

export interface AudioMetadataWrite {
  title?: string | undefined;
  artist?: string | undefined;
  album?: string | undefined;
  lyrics?: string | undefined;
  coverUrl?: string | undefined;
  wordLyrics?: string | undefined;
  wordLyricsFormat?: 'qrc' | 'yrc' | undefined;
}

export interface ShortcutTriggerEvent {
  accelerator: string;
  key: string;
  code: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface QQLoginQrStartResult {
  success: boolean;
  token?: string;
  qrcode?: string;
  expiresIn?: number;
  error?: string;
}
export interface QQLoginQrPollResult {
  success: boolean;
  status?: 'waiting' | 'confirming' | 'done' | 'expired' | 'error';
  msg?: string;
  cookie?: string;
  credential?: QQCredential;
  error?: string;
}
export interface QQLoginRefreshResult {
  success: boolean;
  credential?: QQCredential;
  cookie?: string;
  error?: string;
}
export interface NeteaseQrKeyResult { success: boolean; unikey?: string; error?: string }
export interface NeteaseQrCreateResult { success: boolean; qrcode?: string; error?: string }
/** code 800=expired 801=waiting 802=confirming 803=success. */
export interface NeteaseQrCheckResult {
  success: boolean;
  code?: number;
  message?: string;
  cookie?: string;
  error?: string;
}

/** Positional channels report failures in-band rather than rejecting. */
interface OperationResult { success: boolean; error?: string }

export interface IpcInvokeContract {
  // ---- Typed envelope channels (payload validated with zod in main) ----
  'ipc:settingsPanel:open': [[section: SettingsSectionId], IpcResult<boolean>];
  'ipc:settingsPanel:close': [[], IpcResult<void>];
  'ipc:settingsPanel:prewarm': [[], IpcResult<boolean>];
  'ipc:settingsPanel:ready': [[payload: number | { height: number; darkMode: boolean }], IpcResult<void>];
  'ipc:settingsPanel:previewOpacity': [[value: number], IpcResult<void>];
  'ipc:settingsPanel:shortcut': [[payload: { key: string; modifiers: number }], IpcResult<void>];
  'ipc:contextMenu:popup': [[request: NativeContextMenuRequest], IpcResult<string | null>];
  'ipc:playerControlbar:start': [[], IpcResult<boolean>];
  'ipc:playerControlbar:update': [[state: PlayerControlbarState], IpcResult<void>];
  'ipc:playerControlbar:artwork': [[url: string | null], IpcResult<void>];
  'ipc:playerControlbar:stop': [[], IpcResult<void>];
  'ipc:nativePalette:start': [[], IpcResult<boolean>];
  'ipc:nativePalette:update': [[state: NativePaletteState], IpcResult<void>];
  'ipc:nativePalette:stop': [[], IpcResult<void>];
  'ipc:playlistSwitcher:start': [[], IpcResult<boolean>];
  'ipc:playlistSwitcher:update': [[state: PlaylistSwitcherState], IpcResult<void>];
  'ipc:playlistSwitcher:stop': [[], IpcResult<void>];
  'ipc:focusGlass:playbackSymbols': [[], IpcResult<PlaybackSymbols>];
  'ipc:focusGlass:start': [[], IpcResult<boolean>];
  'ipc:focusGlass:update': [[state: FocusGlassState], IpcResult<void>];
  'ipc:focusGlass:backdrop': [[payload: { source: string | null }], IpcResult<void>];
  'ipc:focusGlass:stop': [[], IpcResult<void>];
  'ipc:file:selectAudio': [[], IpcResult<{ canceled: boolean; filePaths: string[] }>];
  'ipc:file:readAudio': [[payload: { filePath: string }], IpcResult<{ data: ArrayBuffer }>];
  'ipc:file:allowAudioPath': [[payload: { filePath: string }], IpcResult<void>];
  'ipc:library:loadIndex': [[], IpcResult<unknown>];
  'ipc:library:saveIndex': [[library: unknown], IpcResult<void>];
  'ipc:webdav:propfind': [[payload: WebdavRequest & { depth: string }], IpcResult<{ xml: string }>];
  'ipc:webdav:getRange': [[payload: WebdavRequest & { start: number; end: number }], IpcResult<{ data: ArrayBuffer }>];
  'ipc:webdav:put': [[payload: WebdavRequest & { data: ArrayBuffer; contentType: string }], IpcResult<void>];
  'ipc:webdav:delete': [[payload: WebdavRequest], IpcResult<void>];
  'ipc:webdav:getRedirect': [[payload: WebdavRequest], IpcResult<{ redirectUrl?: string; status: number }>];
  'ipc:webdav:mkcol': [[payload: WebdavRequest], IpcResult<{ status: number }>];
  /** Checks an account the user has typed but not saved yet. */
  'ipc:webdav:test': [[payload: WebdavAccountProbe], IpcResult<void>];
  'ipc:settings:get': [[payload: { key: string }], IpcResult<string | undefined>];
  'ipc:settings:getAll': [[], IpcResult<Record<string, string>>];
  'ipc:settings:set': [[payload: { key: string; value: string }], IpcResult<void>];
  'ipc:settings:setMany': [[payload: { entries: Record<string, string> }], IpcResult<void>];
  'ipc:settings:delete': [[payload: { key: string }], IpcResult<void>];
  'ipc:settings:replaceAll': [[payload: { entries: Record<string, string> }], IpcResult<void>];
  'ipc:userData:load': [[], IpcResult<UserDataSnapshot>];
  'ipc:userData:saveLibraryState': [[payload: { tracks: unknown[]; playback: Record<string, string> }], IpcResult<void>];
  'ipc:persistence:loadBootstrap': [[], IpcResult<PersistenceBootstrap>];
  'ipc:persistence:commitClose': [[request: PersistenceCloseCommitRequest], IpcResult<PersistenceCloseCommitResult>];
  'ipc:systemLyrics:update': [[state: SystemLyricsState], IpcResult<void>];

  // ---- Positional channels ----
  'get-app-data-path': [[], string];
  'validate-file-path': [[filePath: string], boolean];
  'validate-all-paths': [[songs: PathValidationRequest[]], PathValidationResult];
  'save-cover-thumbnail': [[payload: CoverThumbnailRequest], OperationResult & { filePath?: string; coverUrl?: string }];
  'delete-cover-thumbnail': [[trackId: string], OperationResult & { deleted?: boolean }];
  'window-minimize': [[], void];
  'window-maximize': [[], void];
  'window-close': [[alreadyFlushed?: boolean], void];
  'window-is-maximized': [[], boolean];
  'window-is-fullscreen': [[], boolean];
  'read-audio-metadata': [[filePath: string], OperationResult & { metadata?: unknown }];
  'write-audio-metadata': [[filePath: string, metadata: AudioMetadataWrite], OperationResult];
  'select-download-folder': [[], OperationResult & { path?: string | undefined; canceled?: boolean }];
  'download-and-save': [
    [url: string, cookieString: string, filePath: string, requestId?: string],
    OperationResult & { filePath?: string; size?: number },
  ];
  'fetch-cover-base64': [[url: string], OperationResult & { dataUrl?: string }];
  'set-online-cookie': [[source: string, cookie: string], void];
  'run-startup-cleanup': [[activeTrackIds: string[]], OperationResult & { message?: string; exitCode?: number | null }];
  'notification:show': [[payload: AppNotificationPayload], { ok: boolean; reason?: string }];
  'updater:state': [[], UpdaterState];
  'updater:check': [[], { ok: boolean; reason?: string }];
  'updater:quit-and-install': [[], { ok: boolean }];
  'app:get-version': [[], string];

  // ---- Plugin host ----
  'plugin-host-info': [[], PluginHostInfo];
  'plugin-update-list': [[], PluginUpdateInfo[]];
  'plugin-check-updates': [[], PluginUpdateInfo[]];
  'plugin-update': [[id: string], MusicPluginInfo[]];
  'plugin-set-update-source': [[id: string, source: PluginUpdateSource | null], PluginUpdateInfo[]];
  'plugin-providers': [[type: ExtensionType], PluginProviderInfo[]];
  'plugin-translate': [[call: PluginTranslationCall], TranslationResult];
  'plugin-configuration': [[id: string], Record<string, PluginConfigurationValue>];
  'plugin-set-configuration': [[id: string, key: string, value: PluginConfigurationValue], void];
  'music-plugin-call': [[id: string, method: string, args: unknown[]], unknown];
  'music-plugin-list': [[], MusicPluginInfo[]];
  'music-plugin-catalog': [[], MusicPluginCatalogEntry[]];
  'music-plugin-download': [[id: string], MusicPluginInfo[]];
  'music-plugin-directory': [[], string];
  'music-plugin-open-directory': [[], void];
  'music-plugin-install': [[], MusicPluginInfo[] | null];
  'music-plugin-uninstall': [[id: string], MusicPluginInfo[]];
  'music-plugin-set-enabled': [[id: string, enabled: boolean], MusicPluginInfo[]];

  // ---- QR login aliases, implemented by the qq / netease plugins ----
  'qq-login-qr-start': [[], QQLoginQrStartResult];
  'qq-login-qr-poll': [[token: string], QQLoginQrPollResult];
  'qq-login-refresh': [[credential: QQCredential, cookie: string], QQLoginRefreshResult];
  'netease-qr-key': [[], NeteaseQrKeyResult];
  'netease-qr-create': [[key: string], NeteaseQrCreateResult];
  'netease-qr-check': [[key: string], NeteaseQrCheckResult];
}

export interface IpcSendContract {
  'window-before-close-flush-done': [saved: boolean, requestId: number];
  'plugin-cancel': [requestId: string];
}

export interface IpcEventContract {
  'settings-panel-section': [section: SettingsSectionId];
  'settings-panel-shortcut': [key: string, modifiers: number];
  'settings-panel-preview-opacity': [value: number];
  'settings-panel-closed': [];
  'settings-changed': [entries: Record<string, string | null>, replaced: boolean];
  'application-menu-action': [action: ApplicationMenuAction];
  'player-controlbar-action': [action: PlayerControlbarAction];
  'native-palette-action': [action: NativePaletteAction];
  'playlist-switcher-action': [action: PlaylistSwitcherAction];
  'focus-glass-action': [action: FocusGlassAction];
  'focus-glass-backdrop': [payload: { luminance: number | null }];
  'system-lyrics-action': [action: SystemLyricsAction];
  'download-progress': [progress: DownloadProgressEvent];
  'fullscreen-changed': [isFullScreen: boolean];
  'window-visibility-changed': [visible: boolean];
  'window-before-close-flush': [requestId: number];
  'shortcut-triggered': [event: ShortcutTriggerEvent];
  'updater-event': [state: UpdaterState];
  'plugin-updates-changed': [updates: PluginUpdateInfo[]];
  'music-plugins-changed': [plugins: MusicPluginInfo[]];
  'music-plugin-secrets-changed': [id: string];
}

export type IpcInvokeChannel = keyof IpcInvokeContract;
export type IpcInvokeArgs<C extends IpcInvokeChannel> = IpcInvokeContract[C][0];
export type IpcInvokeResult<C extends IpcInvokeChannel> = IpcInvokeContract[C][1];
export type IpcSendChannel = keyof IpcSendContract;
export type IpcSendArgs<C extends IpcSendChannel> = IpcSendContract[C];
export type IpcEventChannel = keyof IpcEventContract;
export type IpcEventArgs<C extends IpcEventChannel> = IpcEventContract[C];

/** A bridge method that forwards its arguments to one invoke channel. */
export type IpcInvoker<C extends IpcInvokeChannel> = (...args: IpcInvokeArgs<C>) => Promise<IpcInvokeResult<C>>;
