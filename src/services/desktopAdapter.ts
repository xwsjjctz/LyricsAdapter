/**
 * Desktop API adapter for Electron.
 */

// Import parseAudioFile for Electron compatibility
import { parseAudioFile as parseAudioFileSync } from './metadataService';
import { validateMetadataMap, type ValidatedMetadata } from './dataValidator';
import { logger } from './logger';
import { APP } from '../constants/config';
import type {
  IpcResult,
  PersistenceBootstrap,
  PersistenceCloseCommitRequest,
  PersistenceCloseCommitResult,
  TypedElectronIPC,
  UserDataSnapshot,
} from '../types/typedIpc';
import type { MusicPluginInfo, MusicPluginCatalogEntry } from '../shared/musicPlugin';
import type { ExtensionType, PluginDataInfo, PluginHostInfo, PluginProviderInfo, PluginTranslationCall, TranslationResult } from '../shared/plugin';
import type { PluginUpdateInfo, PluginUpdateSource } from '../shared/pluginUpdate';
import type { OnlineMusicElectronAPI } from './onlineMusicProvider';
import { normalizeStoredUserDataSnapshot } from '../shared/userDataSchema';
import type { QQCredential } from '../shared/qqCredential';
import type { AppNotificationOptions } from '../types/notification';
import type { DownloadProgressEvent } from '../types/onlineProgress';
import type { UpdaterState } from '../shared/updater';
import type { CoverCacheInfo } from '../types/coverCache';
import type { WindowChromeAppearance } from '../shared/windowsChrome';
import type { ElectronBridge } from '../shared/electronBridge';
import type { PathValidationRequest, PathValidationResult, WebdavAccountProbe, WebdavCredentialMode } from '../shared/ipcContract';

declare global {
  interface Window {
    /** Exposed by electron/preload.ts; absent in browser mode. */
    electron?: ElectronBridge;
  }
}

/** The full Electron surface the renderer may use: core DesktopAPI + online-music channels. */
type FullDesktopAPI = DesktopAPI & OnlineMusicElectronAPI;

/** Unwraps a typed IPC result; a failed result or a malformed reply rejects. */
function unwrapIpcResult<T>(value: IpcResult<T>, operation: string): T {
  if (typeof value !== 'object' || value === null || typeof value.ok !== 'boolean') {
    throw new Error(`${operation}: malformed IPC response`);
  }
  if (!value.ok) throw new Error(`${operation}: ${value.error}`);
  return value.data;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(entry => typeof entry === 'string');
}

export type { UpdateInfo, UpdaterState } from '../shared/updater';

type Bridge = ElectronBridge;

export interface DesktopAPI {
  platform: string;
  /** Kernel release from preload; optional for older desktop bridges. */
  osRelease?: string | undefined;
  ipc?: TypedElectronIPC;
  readFile: (filePath: string) => Promise<{ success: boolean; data: ArrayBuffer; error?: string }>;
  selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  loadLibraryIndex: () => Promise<{ success: boolean; library: unknown; error?: string }>;
  saveLibraryIndex: (library: unknown) => Promise<{ success: boolean; error?: string }>;
  validateFilePath: (filePath: string) => Promise<boolean>;
  validateAllPaths: Bridge['validateAllPaths'];
  saveCoverThumbnail?: Bridge['saveCoverThumbnail'];
  deleteCoverThumbnail?: Bridge['deleteCoverThumbnail'];
  getAppDataPath: () => Promise<string | null>;
  loadMetadataCache: () => Promise<{ entries: Record<string, unknown> }>;
  saveMetadataCache: (cache: { entries: Record<string, unknown> }) => Promise<{ success: boolean; error?: string }>;
  /** Read audio metadata using music-tag-native (main process). */
  readAudioMetadata?: Bridge['readAudioMetadata'];
  /** Legacy renderer-side audio metadata parsing. */
  parseAudioMetadata: (filePath: string) => Promise<{ success: boolean; metadata?: unknown; error?: string }>;
  writeAudioMetadata?: Bridge['writeAudioMetadata'];
  getPathForFile?: (file: File) => string;
  // Window control APIs
  minimizeWindow?: Bridge['minimizeWindow'];
  maximizeWindow?: Bridge['maximizeWindow'];
  closeWindow?: Bridge['closeWindow'];
  isMaximized?: Bridge['isMaximized'];
  isFullScreen?: Bridge['isFullScreen'];
  setWindowChromeAppearance?: Bridge['setWindowChromeAppearance'];
  onFullScreenChange?: Bridge['onFullScreenChange'];
  onWindowVisibilityChange?: Bridge['onWindowVisibilityChange'];
  onBeforeWindowClose?: Bridge['onBeforeWindowClose'];
  // Settings APIs
  selectDownloadFolder?: Bridge['selectDownloadFolder'];
  // Shortcut API
  onShortcut?: Bridge['onShortcut'];
  // WebDAV APIs — implemented by ElectronAdapter over the typed ipc.webdav.*
  // channels. The main process attaches the stored account ('stored') itself.
  webdavPropfind: (url: string, credentials: WebdavCredentialMode, depth: string) => Promise<{ success: boolean; xml?: string; error?: string }>;
  webdavGetRedirect: (url: string, credentials: WebdavCredentialMode) => Promise<{ success: boolean; redirectUrl?: string; error?: string }>;
  webdavGetRange: (url: string, credentials: WebdavCredentialMode, start: number, end: number) => Promise<{ success: boolean; data?: ArrayBuffer; error?: string }>;
  webdavPut: (url: string, credentials: WebdavCredentialMode, data: ArrayBuffer, contentType: string) => Promise<{ success: boolean; error?: string }>;
  webdavDelete: (url: string, credentials: WebdavCredentialMode) => Promise<{ success: boolean; error?: string }>;
  /** MKCOL 创建集合（目录），幂等。返回 success 与 HTTP status（201/2xx/405 视为已就绪）。 */
  webdavMkcol: (url: string, credentials: WebdavCredentialMode) => Promise<{ success: boolean; status?: number; error?: string }>;
  /** Probes an unsaved account (settings "test connection"). */
  webdavTest: (account: WebdavAccountProbe) => Promise<{ success: boolean; error?: string }>;
  runStartupCleanup?: Bridge['runStartupCleanup'];
  // Auto-updater APIs
  checkForUpdates?: Bridge['checkForUpdates'];
  quitAndInstall?: Bridge['quitAndInstall'];
  getUpdaterState?: Bridge['getUpdaterState'];
  getAppVersion?: Bridge['getAppVersion'];
  coverCacheInfo?: Bridge['coverCacheInfo'];
  clearCoverCache?: Bridge['clearCoverCache'];
  onUpdaterEvent?: (cb: (state: UpdaterState) => void) => void;
  offUpdaterEvent?: (cb: (state: UpdaterState) => void) => void;
  // System notification API (main process Notification)
  showNotification?: Bridge['showNotification'];
  // Online music: push a provider cookie to the main-process stream:// proxy.
  setOnlineCookie?: Bridge['setOnlineCookie'];
  // Settings store (SQLite-backed main-process facade)
  settingsGet?: (key: string) => Promise<string | undefined>;
  settingsGetAll?: () => Promise<Record<string, string>>;
  settingsSet?: (key: string, value: string) => Promise<void>;
  settingsSetMany?: (entries: Record<string, string>) => Promise<void>;
  settingsDelete?: (key: string) => Promise<void>;
  settingsReplaceAll?: (entries: Record<string, string>) => Promise<void>;
  // Aggregate persistence bootstrap and close commit (typed IPC)
  persistenceLoadBootstrap?: () => Promise<PersistenceBootstrap>;
  persistenceCommitClose?: (
    request: PersistenceCloseCommitRequest,
  ) => Promise<PersistenceCloseCommitResult>;
  // User data store (~/.la/state.sqlite3)
  userDataLoad?: () => Promise<UserDataSnapshot>;
  userDataSaveLibraryState?: (tracks: unknown[], playback: Record<string, string>) => Promise<void>;
}

class ElectronAdapter implements FullDesktopAPI {
  private metadataCache: Record<string, ValidatedMetadata> = {};

  // Return actual OS platform from underlying API
  get platform(): string {
    return this.api.platform;
  }

  get osRelease(): string | undefined {
    return this.api.osRelease;
  }

  // Forward the typed IPC surface (window.electron.ipc) so callers that hold
  // the adapter instance can reach channels like file.allowAudioPath. Without
  // this, api.ipc is undefined and any code doing `api.ipc.file.allowAudioPath`
  // silently no-ops — which previously broke post-cache-clear re-parsing
  // (paths never entered the main-process allowlist).
  get ipc(): TypedElectronIPC {
    return this.api.ipc!;
  }

  constructor(private api: ElectronBridge) {
    // Initialize with empty cache, will be loaded from IndexedDB if needed
    this.metadataCache = {};
  }

  async readFile(filePath: string): Promise<{ success: boolean; data: ArrayBuffer; error?: string }> {
    const result = await this.api.ipc!.file.readAudio(filePath);
    return result.ok ? { success: true, data: result.data.data } : { success: false, data: new ArrayBuffer(0), error: result.error };
  }

  async selectFiles(): Promise<{ canceled: boolean; filePaths: string[] }> {
    const result = await this.api.ipc!.file.selectAudio();
    return result.ok ? result.data : { canceled: true, filePaths: [] };
  }

  async loadLibraryIndex(): Promise<{ success: boolean; library: any; error?: string }> {
    const result = await this.api.ipc!.library.loadIndex();
    return result.ok
      ? { success: true, library: result.data }
      : { success: false, library: null, error: result.error };
  }

  async saveLibraryIndex(library: any): Promise<{ success: boolean; error?: string }> {
    const result = await this.api.ipc!.library.saveIndex(library);
    return result.ok ? { success: true } : { success: false, error: result.error };
  }

  async validateFilePath(filePath: string): Promise<boolean> {
    return this.api.validateFilePath(filePath);
  }

  async validateAllPaths(songs: PathValidationRequest[]): Promise<PathValidationResult> {
    return this.api.validateAllPaths(songs);
  }

  async saveCoverThumbnail(payload: { id: string; data: string; mime: string }): Promise<{ success: boolean; coverUrl?: string; filePath?: string; error?: string }> {
    if (typeof this.api.saveCoverThumbnail === 'function') {
      return this.api.saveCoverThumbnail(payload);
    }
    return { success: false, error: 'saveCoverThumbnail not available' };
  }

  async deleteCoverThumbnail(trackId: string): Promise<{ success: boolean; deleted?: boolean; error?: string }> {
    if (typeof this.api.deleteCoverThumbnail === 'function') {
      return this.api.deleteCoverThumbnail(trackId);
    }
    return { success: false, error: 'deleteCoverThumbnail not available' };
  }

  async getAppDataPath(): Promise<string | null> {
    return this.api.getAppDataPath();
  }

  async loadMetadataCache(): Promise<{ entries: Record<string, any> }> {
    // Return in-memory cache
    return { entries: this.metadataCache };
  }

  async saveMetadataCache(cache: { entries: Record<string, unknown> }): Promise<{ success: boolean; error?: string }> {
    // Update local cache only (persistence is handled by metadataCacheService via IndexedDB)
    this.metadataCache = validateMetadataMap(cache.entries);
    return { success: true };
  }

  async parseAudioMetadata(filePath: string): Promise<{ success: boolean; metadata?: unknown; error?: string }> {
    // Prefer music-tag-native IPC (main process), fall back to legacy worker
    if (this.api.readAudioMetadata) {
      const result = await this.api.readAudioMetadata(filePath);
      if (result.success) {
        logger.debug('[ElectronAdapter] ✓ Metadata from main process:', filePath);
        return result;
      }
      logger.warn('[ElectronAdapter] Main-process metadata failed, falling back to worker:', result.error);
    }

    // Legacy: renderer-side parsing via web worker
    try {
      const readResult = await this.readFile(filePath);
      if (readResult.success && readResult.data) {
        const fileData = new Uint8Array(readResult.data);
        const fileName = filePath.split(/[/\\]/).pop() || 'audio.mp3';

        const lowerName = fileName.toLowerCase();
        let mimeType = 'audio/mpeg';
        if (lowerName.endsWith('.flac')) mimeType = 'audio/flac';
        else if (lowerName.endsWith('.m4a') || lowerName.endsWith('.mp4')) mimeType = 'audio/mp4';

        const file = new File([fileData], fileName, { type: mimeType });
        const metadata = await parseAudioFileSync(file);

        let coverData: string | undefined;
        let coverMime: string | undefined;
        if (metadata.coverUrl && !metadata.coverUrl.startsWith('http')) {
          try {
            const response = await fetch(metadata.coverUrl);
            const blob = await response.blob();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
            const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
            if (mimeMatch) {
              coverMime = mimeMatch[1];
              const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
              if (base64Match) coverData = base64Match[1];
            }
          } catch (e) {
            logger.warn('[ElectronAdapter] Failed to convert cover to base64:', e);
          }
        }

        return {
          success: true,
          metadata: {
            title: metadata.title, artist: metadata.artist, album: metadata.album,
            duration: metadata.duration, lyrics: metadata.lyrics,
            syncedLyrics: metadata.syncedLyrics,
            coverData, coverMime, fileSize: fileData.length,
          }
        };
      }
      return { success: false, error: 'Failed to read file' };
    } catch (error) {
      logger.error('[ElectronAdapter] parseAudioMetadata error:', error);
      return { success: false, error: String(error) };
    }
  }

  async selectDownloadFolder(): ReturnType<Bridge['selectDownloadFolder']> {
    if (typeof this.api.selectDownloadFolder === 'function') {
      return this.api.selectDownloadFolder();
    }
    return { success: false, error: 'selectDownloadFolder not available' };
  }

  async writeAudioMetadata(filePath: string, metadata: { title?: string | undefined; artist?: string | undefined; album?: string | undefined; lyrics?: string | undefined; coverUrl?: string | undefined }): Promise<{ success: boolean; error?: string }> {
    if (typeof this.api.writeAudioMetadata === 'function') {
      return this.api.writeAudioMetadata(filePath, metadata);
    }
    return { success: false, error: 'writeAudioMetadata not available' };
  }

  // Window control methods
  async minimizeWindow(): Promise<void> {
    return this.api.minimizeWindow();
  }

  async maximizeWindow(): Promise<void> {
    return this.api.maximizeWindow();
  }

  async closeWindow(alreadyFlushed = false): Promise<void> {
    return this.api.closeWindow(alreadyFlushed);
  }

  async isMaximized(): Promise<boolean> {
    return this.api.isMaximized();
  }

  async isFullScreen(): Promise<boolean> {
    return this.api.isFullScreen();
  }

  async setWindowChromeAppearance(appearance: WindowChromeAppearance): Promise<void> {
    return this.api.setWindowChromeAppearance(appearance);
  }

  onFullScreenChange(callback: (isFullScreen: boolean) => void): () => void {
    return this.api.onFullScreenChange(callback);
  }

  onWindowVisibilityChange(callback: (visible: boolean) => void): () => void {
    return this.api.onWindowVisibilityChange(callback);
  }

  onBeforeWindowClose(callback: () => Promise<boolean> | boolean): () => void {
    return this.api.onBeforeWindowClose(callback);
  }

  getPathForFile(file: File): string {
    if (typeof this.api.getPathForFile === 'function') {
      return this.api.getPathForFile(file);
    }
    throw new Error('getPathForFile not available');
  }

  async webdavPropfind(url: string, credentials: WebdavCredentialMode, depth: string): Promise<{ success: boolean; xml?: string; error?: string }> {
    const result = await this.api.ipc!.webdav.propfind({ url, credentials, depth });
    return result.ok ? { success: true, xml: result.data.xml } : { success: false, error: result.error };
  }

  async webdavGetRedirect(url: string, credentials: WebdavCredentialMode): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
    const result = await this.api.ipc!.webdav.getRedirect({ url, credentials });
    if (!result.ok) return { success: false, error: result.error };
    const data: { success: boolean; redirectUrl?: string } = { success: true };
    if (result.data.redirectUrl) data.redirectUrl = result.data.redirectUrl;
    return data;
  }

  async webdavGetRange(url: string, credentials: WebdavCredentialMode, start: number, end: number): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
    const result = await this.api.ipc!.webdav.getRange({ url, credentials, start, end });
    return result.ok ? { success: true, data: result.data.data } : { success: false, error: result.error };
  }

  async webdavPut(url: string, credentials: WebdavCredentialMode, data: ArrayBuffer, contentType: string): Promise<{ success: boolean; error?: string }> {
    const result = await this.api.ipc!.webdav.put({ url, credentials, data, contentType });
    return result.ok ? { success: true } : { success: false, error: result.error };
  }

  async webdavDelete(url: string, credentials: WebdavCredentialMode): Promise<{ success: boolean; error?: string }> {
    const result = await this.api.ipc!.webdav.delete({ url, credentials });
    return result.ok ? { success: true } : { success: false, error: result.error };
  }

  async webdavMkcol(url: string, credentials: WebdavCredentialMode): Promise<{ success: boolean; status?: number; error?: string }> {
    const result = await this.api.ipc!.webdav.mkcol({ url, credentials });
    return result.ok ? { success: true, status: result.data.status } : { success: false, error: result.error };
  }

  async webdavTest(account: WebdavAccountProbe): Promise<{ success: boolean; error?: string }> {
    const result = await this.api.ipc.webdav.test(account);
    return result.ok ? { success: true } : { success: false, error: result.error };
  }

  async runStartupCleanup(activeTrackIds: string[]): Promise<{ success: boolean; message?: string; error?: string }> {
    if (typeof this.api.runStartupCleanup === 'function') {
      return this.api.runStartupCleanup(activeTrackIds);
    }
    logger.warn('[DesktopAPI] runStartupCleanup not available');
    return { success: false, error: 'Not available' };
  }

  async checkForUpdates(): Promise<{ ok: boolean; reason?: string }> {
    if (typeof this.api.checkForUpdates === 'function') {
      return this.api.checkForUpdates();
    }
    // 浏览器 / 不可用环境：返回不可用，reason 供渲染层决定是否提示
    return { ok: false, reason: 'browser' };
  }

  async quitAndInstall(): Promise<{ ok: boolean }> {
    if (typeof this.api.quitAndInstall === 'function') {
      return this.api.quitAndInstall();
    }
    return { ok: false };
  }

  async getUpdaterState(): Promise<UpdaterState> {
    if (typeof this.api.getUpdaterState === 'function') {
      return this.api.getUpdaterState();
    }
    return { status: 'idle' };
  }

  async getAppVersion(): Promise<string> {
    if (typeof this.api.getAppVersion === 'function') {
      return this.api.getAppVersion();
    }
    // 浏览器 fallback：使用打包期已知的版本常量
    return APP.VERSION;
  }

  async coverCacheInfo(): Promise<CoverCacheInfo> {
    if (typeof this.api.coverCacheInfo === 'function') return this.api.coverCacheInfo();
    return { entries: 0, bytes: 0 };
  }

  async clearCoverCache(): Promise<CoverCacheInfo> {
    if (typeof this.api.clearCoverCache !== 'function') throw new Error('Cover cache is unavailable');
    return this.api.clearCoverCache();
  }

  onUpdaterEvent(cb: (state: UpdaterState) => void): void {
    if (typeof this.api.onUpdaterEvent === 'function') {
      this.api.onUpdaterEvent(cb);
    }
  }

  offUpdaterEvent(cb: (state: UpdaterState) => void): void {
    if (typeof this.api.offUpdaterEvent === 'function') {
      this.api.offUpdaterEvent(cb);
    }
  }

  async showNotification(title: string, body: string, options?: AppNotificationOptions): Promise<{ ok: boolean; reason?: string }> {
    if (typeof this.api.showNotification === 'function') {
      return this.api.showNotification(title, body, options);
    }
    logger.warn('[DesktopAPI] showNotification not available');
    return { ok: false, reason: 'not available' };
  }

  async setOnlineCookie(source: string, cookie: string): Promise<void> {
    // Optional on the underlying API; no-op when unavailable (e.g. browser mode).
    if (typeof this.api.setOnlineCookie === 'function') {
      return this.api.setOnlineCookie(source, cookie);
    }
  }

  // ---- Settings store (typed IPC to the main-process SQLite facade) ----
  private typed<K extends keyof TypedElectronIPC>(namespace: K, operation: string): NonNullable<TypedElectronIPC[K]> {
    const surface = this.api.ipc?.[namespace];
    if (!surface) throw new Error(`Desktop ${String(namespace)}.${operation} API is unavailable`);
    return surface as NonNullable<TypedElectronIPC[K]>;
  }

  async settingsGet(key: string): Promise<string | undefined> {
    const value = unwrapIpcResult(await this.typed('settings', 'get').get(key), 'settings.get failed');
    return typeof value === 'string' ? value : undefined;
  }

  async settingsGetAll(): Promise<Record<string, string>> {
    const value: unknown = unwrapIpcResult(await this.typed('settings', 'getAll').getAll(), 'settings.getAll failed');
    if (!isStringRecord(value)) throw new Error('Invalid settings.getAll response');
    return value;
  }

  async settingsSet(key: string, value: string): Promise<void> {
    unwrapIpcResult(await this.typed('settings', 'set').set(key, value), 'settings.set failed');
  }

  async settingsDelete(key: string): Promise<void> {
    unwrapIpcResult(await this.typed('settings', 'delete').delete(key), 'settings.delete failed');
  }

  async settingsSetMany(entries: Record<string, string>): Promise<void> {
    unwrapIpcResult(await this.typed('settings', 'setMany').setMany(entries), 'settings.setMany failed');
  }

  async settingsReplaceAll(entries: Record<string, string>): Promise<void> {
    unwrapIpcResult(await this.typed('settings', 'replaceAll').replaceAll(entries), 'settings.replaceAll failed');
  }

  async persistenceLoadBootstrap(): Promise<PersistenceBootstrap> {
    return unwrapIpcResult(await this.typed('persistence', 'loadBootstrap').loadBootstrap(), 'persistence.loadBootstrap failed');
  }

  async persistenceCommitClose(
    request: PersistenceCloseCommitRequest,
  ): Promise<PersistenceCloseCommitResult> {
    return unwrapIpcResult(await this.typed('persistence', 'commitClose').commitClose(request), 'persistence.commitClose failed');
  }

  // ---- User Data Store (~/.la/state.sqlite3) ----

  async userDataLoad(): Promise<UserDataSnapshot> {
    const value: unknown = unwrapIpcResult(await this.typed('userData', 'load').load(), 'userData.load failed');
    const normalized = normalizeStoredUserDataSnapshot(value);
    if (!normalized) throw new Error('Invalid userData.load response');
    return normalized;
  }

  async userDataSaveLibraryState(tracks: unknown[], playback: Record<string, string>): Promise<void> {
    unwrapIpcResult(
      await this.typed('userData', 'saveLibraryState').saveLibraryState(tracks, playback),
      'userData.saveLibraryState failed',
    );
  }

  async musicPluginCall(id: string, method: string, args: unknown[]): Promise<unknown> {
    if (!this.api.musicPluginCall) throw new Error('Music plugin host is unavailable');
    return this.api.musicPluginCall(id, method, args);
  }
  async pluginHostInfo(): Promise<PluginHostInfo> {
    if (!this.api.pluginHostInfo) throw new Error('Plugin platform is unavailable');
    return this.api.pluginHostInfo();
  }
  async pluginUpdateList(): Promise<PluginUpdateInfo[]> { return this.api.pluginUpdateList?.() ?? []; }
  async pluginCheckUpdates(): Promise<PluginUpdateInfo[]> { return this.api.pluginCheckUpdates?.() ?? []; }
  async pluginUpdate(id: string): Promise<MusicPluginInfo[]> {
    if (!this.api.pluginUpdate) throw new Error('Plugin updater is unavailable');
    return this.api.pluginUpdate(id);
  }
  async pluginSetUpdateSource(id: string, source: PluginUpdateSource | null): Promise<PluginUpdateInfo[]> {
    if (!this.api.pluginSetUpdateSource) throw new Error('Plugin updater is unavailable');
    return this.api.pluginSetUpdateSource(id, source);
  }
  onPluginUpdatesChanged(callback: (updates: PluginUpdateInfo[]) => void): () => void { return this.api.onPluginUpdatesChanged?.(callback) ?? (() => {}); }
  async pluginProviders(type: ExtensionType): Promise<PluginProviderInfo[]> { return this.api.pluginProviders?.(type) ?? []; }
  async pluginTranslate(call: PluginTranslationCall): Promise<TranslationResult> {
    if (!this.api.pluginTranslate) throw new Error('Plugin platform is unavailable');
    return this.api.pluginTranslate(call);
  }
  async pluginClearTranslation(call: PluginTranslationCall): Promise<void> {
    if (!this.api.pluginClearTranslation) throw new Error('Plugin platform is unavailable');
    return this.api.pluginClearTranslation(call);
  }
  pluginCancel(requestId: string): void { this.api.pluginCancel?.(requestId); }
  async pluginConfiguration(id: string): Promise<Record<string, string | boolean | number>> { return this.api.pluginConfiguration?.(id) ?? {}; }
  async pluginSetConfiguration(id: string, key: string, value: string | boolean | number): Promise<void> {
    if (!this.api.pluginSetConfiguration) throw new Error('Plugin platform is unavailable');
    return this.api.pluginSetConfiguration(id, key, value);
  }
  async pluginDataInfo(id: string): Promise<PluginDataInfo> {
    return this.api.pluginDataInfo?.(id) ?? { configuredSecrets: [], cacheEntries: 0, cacheBytes: 0 };
  }
  async pluginClearCache(id: string): Promise<void> {
    if (!this.api.pluginClearCache) throw new Error('Plugin platform is unavailable');
    return this.api.pluginClearCache(id);
  }
  async musicPluginList(): Promise<MusicPluginInfo[]> { return this.api.musicPluginList?.() ?? []; }
  async musicPluginCatalog(): Promise<MusicPluginCatalogEntry[]> { return this.api.musicPluginCatalog?.() ?? []; }
  async musicPluginDirectory(): Promise<string> { return this.api.musicPluginDirectory?.() ?? ''; }
  async musicPluginOpenDirectory(): Promise<void> { return this.api.musicPluginOpenDirectory?.(); }
  async musicPluginDownload(id: string): Promise<MusicPluginInfo[]> {
    if (!this.api.musicPluginDownload) throw new Error('Music plugin host is unavailable');
    return this.api.musicPluginDownload(id);
  }
  onMusicPluginsChanged(callback: (plugins: MusicPluginInfo[]) => void): () => void {
    return this.api.onMusicPluginsChanged?.(callback) ?? (() => {});
  }
  async musicPluginInstall(): Promise<MusicPluginInfo[] | null> { return this.api.musicPluginInstall?.() ?? null; }
  async musicPluginUninstall(id: string): Promise<MusicPluginInfo[]> {
    if (!this.api.musicPluginUninstall) throw new Error('Music plugin host is unavailable');
    return this.api.musicPluginUninstall(id);
  }
  async musicPluginSetEnabled(id: string, enabled: boolean): Promise<MusicPluginInfo[]> {
    if (!this.api.musicPluginSetEnabled) throw new Error('Music plugin host is unavailable');
    return this.api.musicPluginSetEnabled(id, enabled);
  }
  onMusicPluginSecretsChanged(callback: (id: string) => void): () => void {
    return this.api.onMusicPluginSecretsChanged?.(callback) ?? (() => {});
  }

  // ---- Online music channels (OnlineMusicElectronAPI) ----
  // Thin passthroughs to the underlying window.electron proxy. The adapter only
  // exists in Electron mode (getDesktopAPI() returns null in the browser), so
  // these channels are guaranteed present on this.api — hence the non-null
  // assertions. Moving these through the adapter lets renderer code stop
  // touching window.electron directly (RF-008).

  async downloadAndSave(url: string, cookie: string, filePath: string, requestId?: string) {
    return this.api.downloadAndSave!(url, cookie, filePath, requestId);
  }
  async fetchCoverBase64(coverUrl: string) {
    return this.api.fetchCoverBase64!(coverUrl);
  }
  onDownloadProgress(callback: (progress: DownloadProgressEvent) => void): void {
    this.api.onDownloadProgress!(callback);
  }
  offDownloadProgress(callback: (progress: DownloadProgressEvent) => void): void {
    this.api.offDownloadProgress!(callback);
  }
  async qqLoginQrStart() {
    return this.api.qqLoginQrStart!();
  }
  async qqLoginQrPoll(token: string) {
    return this.api.qqLoginQrPoll!(token);
  }
  async qqLoginRefresh(credential: QQCredential, cookie: string) {
    return this.api.qqLoginRefresh!(credential, cookie);
  }
  async neteaseQrKey() {
    return this.api.neteaseQrKey!();
  }
  async neteaseQrCreate(key: string) {
    return this.api.neteaseQrCreate!(key);
  }
  async neteaseQrCheck(key: string) {
    return this.api.neteaseQrCheck!(key);
  }

}

let desktopAPI: FullDesktopAPI | null = null;

function createElectronAdapter(): ElectronAdapter | null {
  if (typeof window !== 'undefined' && window.electron) {
    return new ElectronAdapter(window.electron);
  }
  return null;
}

export function getDesktopAPI(): FullDesktopAPI | null {
  if (desktopAPI) {
    // 缓存命中是常态，不打日志 —— 此前每次命中都打 debug，被高频调用
    //（isDesktop / TitleBar / FocusMode 等）刷屏控制台。
    return desktopAPI;
  }

  const electronAdapter = createElectronAdapter();
  if (electronAdapter) {
    logger.debug('[DesktopAdapter] ✓ Electron adapter created');
    desktopAPI = electronAdapter;
    return desktopAPI;
  }

  logger.debug('[DesktopAdapter] No desktop adapter available (running in browser)');
  return null;
}

// Async version for when you need to wait for initialization
export async function getDesktopAPIAsync(): Promise<FullDesktopAPI | null> {
  return getDesktopAPI();
}

export function isDesktop(): boolean {
  return getDesktopAPI() !== null;
}
