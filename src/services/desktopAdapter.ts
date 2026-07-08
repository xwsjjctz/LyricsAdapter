/**
 * Desktop API adapter for Electron.
 */

// Import parseAudioFile for Electron compatibility
import { parseAudioFile as parseAudioFileSync } from './metadataService';
import { validateMetadataMap, type ValidatedMetadata } from './dataValidator';
import { logger } from './logger';
import { APP } from '../constants/config';
import type { TypedElectronIPC } from '../types/typedIpc';
import type { OnlineMusicElectronAPI } from './onlineMusicProvider';

/** The full Electron surface the renderer may use: core DesktopAPI + online-music channels. */
export type FullDesktopAPI = DesktopAPI & OnlineMusicElectronAPI;

/** 更新信息（渲染侧宽松版，仅取必要字段；主进程发送完整 UpdateInfo）。 */
export interface UpdateInfo {
  version: string;
  releaseName?: string;
  releaseDate?: string;
}

/** 下载进度信息。 */
export interface UpdateProgress {
  total: number;
  delta: number;
  transferred: number;
  percent: number;
  bytesPerSecond: number;
}

/** 自动更新状态机（与 electron/updater.ts 保持一致）。 */
export type UpdaterState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'not-available' }
  | { status: 'available'; info: UpdateInfo }
  | { status: 'downloading'; info: UpdateInfo; progress: UpdateProgress | null }
  | { status: 'downloaded'; info: UpdateInfo }
  | { status: 'error'; message: string };

export interface DesktopAPI {
  platform: string;
  ipc?: TypedElectronIPC;
  readFile: (filePath: string) => Promise<{ success: boolean; data: ArrayBuffer; error?: string }>;
  selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  loadLibrary: () => Promise<{ success: boolean; library: unknown; error?: string }>;
  saveLibrary: (library: unknown) => Promise<{ success: boolean; error?: string }>;
  loadLibraryIndex?: () => Promise<{ success: boolean; library: unknown; error?: string }>;
  saveLibraryIndex?: (library: unknown) => Promise<{ success: boolean; error?: string }>;
  saveLocalLibraryBackup?: (library: unknown) => Promise<{ success: boolean; error?: string }>;
  loadLocalLibraryBackup?: () => Promise<{ success: boolean; library: unknown | null; error?: string }>;
  validateFilePath: (filePath: string) => Promise<boolean>;
  validateAllPaths: (songs: unknown[]) => Promise<{ success: boolean; results: unknown[]; error?: string }>;
  saveAudioFile: (sourcePath: string, fileName: string) => Promise<{ success: boolean; filePath?: string; method?: string; error?: string }>;
  saveAudioFileFromBuffer: (fileName: string, fileData: ArrayBuffer) => Promise<{ success: boolean; filePath?: string; method?: string; error?: string }>;
  deleteAudioFile: (filePath: string) => Promise<{ success: boolean; deleted?: boolean; error?: string }>;
  cleanupOrphanAudio: (keepPaths: string[]) => Promise<{ success: boolean; removed?: number; error?: string }>;
  saveCoverThumbnail?: (payload: { id: string; data: string; mime: string }) => Promise<{ success: boolean; coverUrl?: string; filePath?: string; error?: string }>;
  deleteCoverThumbnail?: (trackId: string) => Promise<{ success: boolean; deleted?: boolean; error?: string }>;
  getAppDataPath: () => Promise<string | null>;
  loadMetadataCache: () => Promise<{ entries: Record<string, unknown> }>;
  saveMetadataCache: (cache: { entries: Record<string, unknown> }) => Promise<{ success: boolean; error?: string }>;
  getMetadataForSong: (songId: string) => Promise<unknown>;
  parseAudioMetadata: (filePath: string) => Promise<{ success: boolean; metadata?: unknown; error?: string }>;
  writeAudioMetadata?: (filePath: string, metadata: { title?: string | undefined; artist?: string | undefined; album?: string | undefined; lyrics?: string | undefined; coverUrl?: string | undefined }) => Promise<{ success: boolean; error?: string }>;
  refreshTrackMetadata?: (filePath: string) => Promise<{ success: boolean; data?: { fileName: string; mimeType: string; buffer: ArrayBuffer }; error?: string }>;
  getPathForFile?: (file: File) => string;
  // Window control APIs
  minimizeWindow?: () => void;
  maximizeWindow?: () => void;
  closeWindow?: () => void;
  isMaximized?: () => Promise<boolean>;
  isFullScreen?: () => Promise<boolean>;
  onFullScreenChange?: (callback: (isFullScreen: boolean) => void) => () => void;
  onBeforeWindowClose?: (callback: () => Promise<boolean> | boolean) => () => void;
  // Settings APIs
  selectDownloadFolder?: () => Promise<{ success: boolean; path?: string; error?: string }>;
  // Shortcut API
  onShortcut?: (callback: (event: { accelerator: string; key: string; code: string; control: boolean; meta: boolean; alt: boolean; shift: boolean }) => void) => (() => void) | void;
  // WebDAV APIs
  webdavPropfind: (url: string, authHeader: string, depth: string) => Promise<{ success: boolean; xml?: string; error?: string }>;
  webdavGetRedirect: (url: string, authHeader: string) => Promise<{ success: boolean; redirectUrl?: string; error?: string }>;
  webdavGetRange: (url: string, authHeader: string, start: number, end: number) => Promise<{ success: boolean; data?: ArrayBuffer; error?: string }>;
  webdavPut: (url: string, authHeader: string, data: ArrayBuffer, contentType: string) => Promise<{ success: boolean; error?: string }>;
  webdavDelete: (url: string, authHeader: string) => Promise<{ success: boolean; error?: string }>;
  /** MKCOL 创建集合（目录），幂等。返回 success 与 HTTP status（201/2xx/405 视为已就绪）。 */
  webdavMkcol: (url: string, authHeader: string) => Promise<{ success: boolean; status?: number; error?: string }>;
  runStartupCleanup?: (activeTrackIds: string[]) => Promise<{ success: boolean; message?: string; error?: string }>;
  cleanupOrphanCovers?: (activeTrackIds: string[]) => Promise<{ success: boolean; removed?: number; errors?: number; existingCoverIds?: string[]; error?: string }>;
  // Auto-updater APIs
  checkForUpdates?: () => Promise<{ ok: boolean; reason?: string }>;
  quitAndInstall?: () => Promise<{ ok: boolean }>;
  getAppVersion?: () => Promise<string>;
  onUpdaterEvent?: (cb: (state: UpdaterState) => void) => void;
  offUpdaterEvent?: (cb: (state: UpdaterState) => void) => void;
  // System notification API (main process Notification)
  showNotification?: (title: string, body: string, options?: { silent?: boolean }) => Promise<{ ok: boolean; reason?: string }>;
  // Online music: push a QQ/NetEase cookie to the main-process stream:// proxy.
  setOnlineCookie?: (source: string, cookie: string) => Promise<void>;
  // Settings store (Electron Store–style JSON file in main process)
  settingsGet?: (key: string) => Promise<string | undefined>;
  settingsGetAll?: () => Promise<Record<string, string>>;
  settingsSet?: (key: string, value: string) => Promise<void>;
  settingsDelete?: (key: string) => Promise<void>;
  settingsReplaceAll?: (entries: Record<string, string>) => Promise<void>;
}

class ElectronAdapter implements FullDesktopAPI {
  private metadataCache: Record<string, ValidatedMetadata> = {};

  // Return actual OS platform from underlying API
  get platform(): string {
    return this.api.platform;
  }

  constructor(private api: FullDesktopAPI) {
    // Initialize with empty cache, will be loaded from IndexedDB if needed
    this.metadataCache = {};
  }

  async readFile(filePath: string): Promise<{ success: boolean; data: ArrayBuffer; error?: string }> {
    if (this.api.ipc?.file.readAudio) {
      const result = await this.api.ipc.file.readAudio(filePath);
      if (result.ok) {
        return { success: true, data: result.data.data };
      }
      logger.warn('[DesktopAPI] typed readAudio rejected, falling back to legacy read-file:', result.error);
    }
    return this.api.readFile(filePath);
  }

  async selectFiles(): Promise<{ canceled: boolean; filePaths: string[] }> {
    if (this.api.ipc?.file.selectAudio) {
      const result = await this.api.ipc.file.selectAudio();
      if (result.ok) return result.data;
      logger.warn('[DesktopAPI] typed selectAudio failed, falling back to legacy select-folder:', result.error);
    }
    return this.api.selectFiles();
  }

  async loadLibrary(): Promise<{ success: boolean; library: any; error?: string }> {
    return this.api.loadLibrary();
  }

  async saveLibrary(library: any): Promise<{ success: boolean; error?: string }> {
    return this.api.saveLibrary(library);
  }

  async loadLibraryIndex(): Promise<{ success: boolean; library: any; error?: string }> {
    if (this.api.ipc?.library.loadIndex) {
      const result = await this.api.ipc.library.loadIndex();
      return result.ok
        ? { success: true, library: result.data }
        : { success: false, library: null, error: result.error };
    }
    if (typeof this.api.loadLibraryIndex === 'function') {
      return this.api.loadLibraryIndex();
    }
    return this.api.loadLibrary();
  }

  async saveLibraryIndex(library: any): Promise<{ success: boolean; error?: string }> {
    if (this.api.ipc?.library.saveIndex) {
      const result = await this.api.ipc.library.saveIndex(library);
      return result.ok ? { success: true } : { success: false, error: result.error };
    }
    if (typeof this.api.saveLibraryIndex === 'function') {
      return this.api.saveLibraryIndex(library);
    }
    return this.api.saveLibrary(library);
  }

  async saveLocalLibraryBackup(library: any): Promise<{ success: boolean; error?: string }> {
    if (typeof this.api.saveLocalLibraryBackup === 'function') {
      return this.api.saveLocalLibraryBackup(library);
    }
    logger.warn('[DesktopAPI] saveLocalLibraryBackup not available');
    return { success: false, error: 'Not available' };
  }

  async loadLocalLibraryBackup(): Promise<{ success: boolean; library: any; error?: string }> {
    if (typeof this.api.loadLocalLibraryBackup === 'function') {
      return this.api.loadLocalLibraryBackup();
    }
    logger.warn('[DesktopAPI] loadLocalLibraryBackup not available');
    return { success: false, library: null, error: 'Not available' };
  }

  async validateFilePath(filePath: string): Promise<boolean> {
    return this.api.validateFilePath(filePath);
  }

  async validateAllPaths(songs: any[]): Promise<{ success: boolean; results: any[]; error?: string }> {
    return this.api.validateAllPaths(songs);
  }

  async saveAudioFile(sourcePath: string, fileName: string): Promise<{ success: boolean; filePath?: string; method?: string; error?: string }> {
    return this.api.saveAudioFile(sourcePath, fileName);
  }

  async saveAudioFileFromBuffer(fileName: string, fileData: ArrayBuffer): Promise<{ success: boolean; filePath?: string; method?: string; error?: string }> {
    return this.api.saveAudioFileFromBuffer(fileName, fileData);
  }

  async deleteAudioFile(filePath: string): Promise<{ success: boolean; deleted?: boolean; error?: string }> {
    return this.api.deleteAudioFile(filePath);
  }

  async cleanupOrphanAudio(keepPaths: string[]): Promise<{ success: boolean; removed?: number; error?: string }> {
    return this.api.cleanupOrphanAudio(keepPaths);
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

  async getMetadataForSong(songId: string): Promise<unknown> {
    // Return from in-memory cache
    return this.metadataCache[songId] || null;
  }

  async parseAudioMetadata(filePath: string): Promise<{ success: boolean; metadata?: unknown; error?: string }> {
    // Electron: Use JS-side parsing with proper cover extraction
    try {
      const readResult = await this.api.readFile(filePath);
      if (readResult.success && readResult.data) {
        const fileData = new Uint8Array(readResult.data);
        const fileName = filePath.split(/[/\\]/).pop() || 'audio.mp3';
        
        // Determine MIME type based on file extension
        const lowerName = fileName.toLowerCase();
        let mimeType = 'audio/mpeg'; // default to MP3
        if (lowerName.endsWith('.flac')) {
          mimeType = 'audio/flac';
        } else if (lowerName.endsWith('.m4a') || lowerName.endsWith('.mp4')) {
          mimeType = 'audio/mp4';
        }
        
        const file = new File([fileData], fileName, { type: mimeType });

        // Parse metadata using JS parser
        const metadata = await parseAudioFileSync(file);

        // Convert cover URL to base64 if available
        let coverData: string | undefined;
        let coverMime: string | undefined;

        if (metadata.coverUrl && !metadata.coverUrl.startsWith('http')) {
          try {
            // Convert blob URL to base64 directly
            const response = await fetch(metadata.coverUrl);
            const blob = await response.blob();

            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });

            // Extract mime type from data URL (format: data:image/jpeg;base64,...)
            const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
            if (mimeMatch) {
              coverMime = mimeMatch[1];
              // Extract base64 data (remove the data:image/xxx;base64, prefix)
              const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
              if (base64Match) {
                coverData = base64Match[1];
              }
            }
          } catch (e) {
            logger.warn('[ElectronAdapter] Failed to convert cover to base64:', e);
          }
        }

        return {
          success: true,
          metadata: {
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            duration: metadata.duration,
            lyrics: metadata.lyrics,
            syncedLyrics: metadata.syncedLyrics,
            coverData: coverData,
            coverMime: coverMime,
            fileSize: fileData.length,
          }
        };
      }

      return { success: false, error: 'Failed to read file' };
    } catch (error) {
      logger.error('[ElectronAdapter] parseAudioMetadata error:', error);
      return { success: false, error: String(error) };
    }
  }

  async selectDownloadFolder(): Promise<{ success: boolean; path?: string; error?: string }> {
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

  async refreshTrackMetadata(filePath: string): Promise<{ success: boolean; data?: { fileName: string; mimeType: string; buffer: ArrayBuffer }; error?: string }> {
    if (typeof this.api.refreshTrackMetadata === 'function') {
      return this.api.refreshTrackMetadata(filePath);
    }
    return { success: false, error: 'refreshTrackMetadata not available' };
  }

  // Window control methods
  minimizeWindow(): void {
    if (typeof this.api.minimizeWindow === 'function') {
      this.api.minimizeWindow();
    }
  }

  maximizeWindow(): void {
    if (typeof this.api.maximizeWindow === 'function') {
      this.api.maximizeWindow();
    }
  }

  closeWindow(): void {
    if (typeof this.api.closeWindow === 'function') {
      this.api.closeWindow();
    }
  }

  async isMaximized(): Promise<boolean> {
    if (typeof this.api.isMaximized === 'function') {
      return this.api.isMaximized();
    }
    return false;
  }

  async isFullScreen(): Promise<boolean> {
    if (typeof this.api.isFullScreen === 'function') {
      return this.api.isFullScreen();
    }
    return false;
  }

  onFullScreenChange(callback: (isFullScreen: boolean) => void): () => void {
    if (typeof this.api.onFullScreenChange === 'function') {
      return this.api.onFullScreenChange(callback);
    }
    return () => {};
  }

  onBeforeWindowClose(callback: () => Promise<boolean> | boolean): () => void {
    if (typeof this.api.onBeforeWindowClose === 'function') {
      return this.api.onBeforeWindowClose(callback);
    }
    return () => {};
  }

  getPathForFile(file: File): string {
    if (typeof this.api.getPathForFile === 'function') {
      return this.api.getPathForFile(file);
    }
    throw new Error('getPathForFile not available');
  }

  async webdavPropfind(url: string, authHeader: string, depth: string): Promise<{ success: boolean; xml?: string; error?: string }> {
    if (this.api.ipc?.webdav.propfind) {
      const result = await this.api.ipc.webdav.propfind({ url, authHeader, depth });
      return result.ok ? { success: true, xml: result.data.xml } : { success: false, error: result.error };
    }
    return this.api.webdavPropfind(url, authHeader, depth);
  }

  async webdavGetRedirect(url: string, authHeader: string): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
    return this.api.webdavGetRedirect(url, authHeader);
  }

  async webdavGetRange(url: string, authHeader: string, start: number, end: number): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
    if (this.api.ipc?.webdav.getRange) {
      const result = await this.api.ipc.webdav.getRange({ url, authHeader, start, end });
      return result.ok ? { success: true, data: result.data.data } : { success: false, error: result.error };
    }
    return this.api.webdavGetRange(url, authHeader, start, end);
  }

  async webdavPut(url: string, authHeader: string, data: ArrayBuffer, contentType: string): Promise<{ success: boolean; error?: string }> {
    if (this.api.ipc?.webdav.put) {
      const result = await this.api.ipc.webdav.put({ url, authHeader, data, contentType });
      return result.ok ? { success: true } : { success: false, error: result.error };
    }
    return this.api.webdavPut(url, authHeader, data, contentType);
  }

  async webdavDelete(url: string, authHeader: string): Promise<{ success: boolean; error?: string }> {
    if (this.api.ipc?.webdav.delete) {
      const result = await this.api.ipc.webdav.delete({ url, authHeader });
      return result.ok ? { success: true } : { success: false, error: result.error };
    }
    return this.api.webdavDelete(url, authHeader);
  }

  async webdavMkcol(url: string, authHeader: string): Promise<{ success: boolean; status?: number; error?: string }> {
    if (typeof this.api.webdavMkcol === 'function') {
      return this.api.webdavMkcol(url, authHeader);
    }
    return { success: false, error: 'webdavMkcol not available' };
  }

  async runStartupCleanup(activeTrackIds: string[]): Promise<{ success: boolean; message?: string; error?: string }> {
    if (typeof this.api.runStartupCleanup === 'function') {
      return this.api.runStartupCleanup(activeTrackIds);
    }
    logger.warn('[DesktopAPI] runStartupCleanup not available');
    return { success: false, error: 'Not available' };
  }

  async cleanupOrphanCovers(activeTrackIds: string[]): Promise<{ success: boolean; removed?: number; errors?: number; existingCoverIds?: string[]; error?: string }> {
    if (typeof this.api.cleanupOrphanCovers === 'function') {
      return this.api.cleanupOrphanCovers(activeTrackIds);
    }
    logger.warn('[DesktopAPI] cleanupOrphanCovers not available');
    return { success: false, error: 'Not available', removed: 0, errors: 0, existingCoverIds: [] };
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

  async getAppVersion(): Promise<string> {
    if (typeof this.api.getAppVersion === 'function') {
      return this.api.getAppVersion();
    }
    // 浏览器 fallback：使用打包期已知的版本常量
    return APP.VERSION;
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

  async showNotification(title: string, body: string, options?: { silent?: boolean }): Promise<{ ok: boolean; reason?: string }> {
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

  // ---- Settings store (passthrough to main-process settings.json) ----
  async settingsGet(key: string): Promise<string | undefined> {
    // Prefer typed IPC path, fall back to legacy top-level method
    if (this.api.ipc?.settings.get) {
      const result = await this.api.ipc.settings.get(key);
      return result.ok ? result.data : undefined;
    }
    if (typeof this.api.settingsGet === 'function') {
      return this.api.settingsGet(key);
    }
    return undefined;
  }

  async settingsGetAll(): Promise<Record<string, string>> {
    if (this.api.ipc?.settings.getAll) {
      const result = await this.api.ipc.settings.getAll();
      return result.ok ? result.data : {};
    }
    if (typeof this.api.settingsGetAll === 'function') {
      return this.api.settingsGetAll();
    }
    return {};
  }

  async settingsSet(key: string, value: string): Promise<void> {
    if (this.api.ipc?.settings.set) {
      await this.api.ipc.settings.set(key, value);
      return;
    }
    if (typeof this.api.settingsSet === 'function') {
      return this.api.settingsSet(key, value);
    }
  }

  async settingsDelete(key: string): Promise<void> {
    if (this.api.ipc?.settings.delete) {
      await this.api.ipc.settings.delete(key);
      return;
    }
    if (typeof this.api.settingsDelete === 'function') {
      return this.api.settingsDelete(key);
    }
  }

  async settingsReplaceAll(entries: Record<string, string>): Promise<void> {
    if (this.api.ipc?.settings.replaceAll) {
      await this.api.ipc.settings.replaceAll(entries);
      return;
    }
    if (typeof this.api.settingsReplaceAll === 'function') {
      return this.api.settingsReplaceAll(entries);
    }
  }

  // ---- Online music channels (OnlineMusicElectronAPI) ----
  // Thin passthroughs to the underlying window.electron proxy. The adapter only
  // exists in Electron mode (getDesktopAPI() returns null in the browser), so
  // these channels are guaranteed present on this.api — hence the non-null
  // assertions. Moving these through the adapter lets renderer code stop
  // touching window.electron directly (RF-008).

  async getQQMusicUrl(reqData: Record<string, unknown>, cookie: string) {
    return this.api.getQQMusicUrl!(reqData, cookie);
  }
  async qqMusicRequest(options: {
    url: string; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; cookie?: string;
  }) {
    return this.api.qqMusicRequest!(options);
  }
  async getQQMusicLyrics(songmid: string, cookie: string) {
    return this.api.getQQMusicLyrics!(songmid, cookie);
  }
  async neteaseRequest(channel: string, params: Record<string, unknown>, cookie?: string) {
    return this.api.neteaseRequest!(channel, params, cookie);
  }
  async downloadAndSave(url: string, cookie: string, filePath: string) {
    return this.api.downloadAndSave!(url, cookie, filePath);
  }
  async downloadAudioFile(url: string, cookie: string) {
    return this.api.downloadAudioFile!(url, cookie);
  }
  async fetchCoverBase64(coverUrl: string) {
    return this.api.fetchCoverBase64!(coverUrl);
  }
  onDownloadProgress(callback: (progress: { downloaded: number; total: number; progress: number }) => void): void {
    this.api.onDownloadProgress!(callback);
  }
  offDownloadProgress(callback: (progress: { downloaded: number; total: number; progress: number }) => void): void {
    this.api.offDownloadProgress!(callback);
  }
  async qqLoginQrStart() {
    return this.api.qqLoginQrStart!();
  }
  async qqLoginQrPoll(token: string) {
    return this.api.qqLoginQrPoll!(token);
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
    logger.debug('[DesktopAdapter] Returning cached desktopAPI, platform:', desktopAPI.platform);
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
