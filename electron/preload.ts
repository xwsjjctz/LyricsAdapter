// Secure preload script using contextBridge
import type { TypedElectronIPC } from '../src/types/typedIpc';

const { contextBridge, ipcRenderer, webUtils } = require('electron');
const downloadProgressListenerMap = new Map();
const updaterEventListenerMap = new Map();

const typedIpc = {
  file: {
    selectAudio: async () => ipcRenderer.invoke('ipc:file:selectAudio'),
    readAudio: async (filePath: string) => ipcRenderer.invoke('ipc:file:readAudio', { filePath }),
    allowAudioPath: async (filePath: string) => ipcRenderer.invoke('ipc:file:allowAudioPath', { filePath }),
  },
  library: {
    loadIndex: async () => ipcRenderer.invoke('ipc:library:loadIndex'),
    saveIndex: async (library: unknown) => ipcRenderer.invoke('ipc:library:saveIndex', library),
  },
  webdav: {
    propfind: async (payload: { url: string; authHeader: string; depth: string }) => ipcRenderer.invoke('ipc:webdav:propfind', payload),
    getRange: async (payload: { url: string; authHeader: string; start: number; end: number }) => ipcRenderer.invoke('ipc:webdav:getRange', payload),
    put: async (payload: { url: string; authHeader: string; data: ArrayBuffer; contentType: string }) => ipcRenderer.invoke('ipc:webdav:put', payload),
    delete: async (payload: { url: string; authHeader: string }) => ipcRenderer.invoke('ipc:webdav:delete', payload),
    getRedirect: async (payload: { url: string; authHeader: string }) => ipcRenderer.invoke('ipc:webdav:getRedirect', payload),
    mkcol: async (payload: { url: string; authHeader: string }) => ipcRenderer.invoke('ipc:webdav:mkcol', payload),
  },
  download: {
    audio: async (payload: { url: string; cookieString: string }) => ipcRenderer.invoke('ipc:download:audio', payload),
  },
  settings: {
    get: async (key: string) => ipcRenderer.invoke('ipc:settings:get', { key }),
    getAll: async () => ipcRenderer.invoke('ipc:settings:getAll'),
    set: async (key: string, value: string) => ipcRenderer.invoke('ipc:settings:set', { key, value }),
    setMany: async (entries: Record<string, string>) => ipcRenderer.invoke('ipc:settings:setMany', { entries }),
    delete: async (key: string) => ipcRenderer.invoke('ipc:settings:delete', { key }),
    replaceAll: async (entries: Record<string, string>) => ipcRenderer.invoke('ipc:settings:replaceAll', { entries }),
  },
  userData: {
    load: async () => ipcRenderer.invoke('ipc:userData:load'),
    save: async (data) => ipcRenderer.invoke('ipc:userData:save', { data }),
    saveTracks: async (tracks: unknown[]) => ipcRenderer.invoke('ipc:userData:saveTracks', { tracks }),
    saveLibraryState: async (tracks: unknown[], playback: Record<string, string>) => (
      ipcRenderer.invoke('ipc:userData:saveLibraryState', { tracks, playback })
    ),
    getFilePath: async () => ipcRenderer.invoke('ipc:userData:getFilePath'),
  },
  persistence: {
    loadBootstrap: async () => ipcRenderer.invoke('ipc:persistence:loadBootstrap'),
    commitClose: async (request) => ipcRenderer.invoke('ipc:persistence:commitClose', request),
  },
} satisfies TypedElectronIPC;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // Listen for download progress updates
  onDownloadProgress: (callback: (data: { downloaded: number; total: number; progress: number }) => void) => {
    const existing = downloadProgressListenerMap.get(callback);
    if (existing) {
      ipcRenderer.removeListener('download-progress', existing);
    }
    const wrapped = (_event: unknown, data: { downloaded: number; total: number; progress: number }) => callback(data);
    downloadProgressListenerMap.set(callback, wrapped);
    ipcRenderer.on('download-progress', wrapped);
  },
  
  // Remove download progress listener
  offDownloadProgress: (callback: (data: { downloaded: number; total: number; progress: number }) => void) => {
    const wrapped = downloadProgressListenerMap.get(callback);
    if (wrapped) {
      ipcRenderer.removeListener('download-progress', wrapped);
      downloadProgressListenerMap.delete(callback);
    }
  },
  platform: process.platform,

  ipc: typedIpc,

  // Check if file exists
  checkFileExists: async (filePath: string) => {
    return ipcRenderer.invoke('check-file-exists', filePath);
  },

  // Get app data directory path
  getAppDataPath: async () => {
    return ipcRenderer.invoke('get-app-data-path');
  },

  // Save local library backup (before switching to cloud)
  saveLocalLibraryBackup: async (library: any) => {
    return ipcRenderer.invoke('save-local-library-backup', library);
  },

  // Load local library backup (when switching back to local)
  loadLocalLibraryBackup: async () => {
    return ipcRenderer.invoke('load-local-library-backup');
  },

  // Validate single file path
  validateFilePath: async (filePath: string) => {
    return ipcRenderer.invoke('validate-file-path', filePath);
  },

  // Validate all file paths
  validateAllPaths: async (songs: any[]) => {
    return ipcRenderer.invoke('validate-all-paths', songs);
  },

  // Save audio file to userData directory (using hard link)
  saveAudioFile: async (sourcePath: string, fileName: string) => {
    return ipcRenderer.invoke('save-audio-file', sourcePath, fileName);
  },

  // Save audio file from buffer (for web input imports)
  saveAudioFileFromBuffer: async (fileName: string, fileData: ArrayBuffer) => {
    return ipcRenderer.invoke('save-audio-file-from-buffer', fileName, fileData);
  },

  // Delete audio file (symlink) from userData directory
  deleteAudioFile: async (filePath: string) => {
    return ipcRenderer.invoke('delete-audio-file', filePath);
  },

  // Cleanup orphaned audio files (Electron only)
  cleanupOrphanAudio: async (keepPaths: string[]) => {
    return ipcRenderer.invoke('cleanup-orphan-audio', keepPaths);
  },

  // Save cover thumbnail to disk
  saveCoverThumbnail: async (payload: { id: string; data: string; mime: string }) => {
    return ipcRenderer.invoke('save-cover-thumbnail', payload);
  },

  // Delete cover thumbnail from disk
  deleteCoverThumbnail: async (trackId: string) => {
    return ipcRenderer.invoke('delete-cover-thumbnail', trackId);
  },

  // Window control APIs - using IPC
  minimizeWindow: async () => {
    return ipcRenderer.invoke('window-minimize');
  },

  maximizeWindow: async () => {
    return ipcRenderer.invoke('window-maximize');
  },

  closeWindow: async (alreadyFlushed = false) => {
    return ipcRenderer.invoke('window-close', alreadyFlushed);
  },

  isMaximized: async () => {
    return ipcRenderer.invoke('window-is-maximized');
  },

  isFullScreen: async () => {
    return ipcRenderer.invoke('window-is-fullscreen');
  },

  onFullScreenChange: (callback: (isFullScreen: boolean) => void) => {
    const handler = (_event: unknown, isFullScreen: boolean) => callback(isFullScreen);
    ipcRenderer.on('fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('fullscreen-changed', handler);
  },

  onBeforeWindowClose: (callback: () => Promise<boolean> | boolean) => {
    const handler = async () => {
      let saved = false;
      try {
        saved = await callback();
      } catch {
        saved = false;
      }
      ipcRenderer.send('window-before-close-flush-done', saved);
    };
    ipcRenderer.on('window-before-close-flush', handler);
    return () => ipcRenderer.removeListener('window-before-close-flush', handler);
  },

  // Get real file path from File object (for drag-and-drop)
  getPathForFile: (file: File) => {
    const filePath = webUtils.getPathForFile(file);
    ipcRenderer.invoke('ipc:file:allowAudioPath', { filePath }).catch(() => {});
    return filePath;
  },

  // Download audio file from URL with cookies (for QQ Music download)
  downloadAudioFile: async (url: string, cookieString: string) => {
    return ipcRenderer.invoke('download-audio-file', url, cookieString);
  },

  // Get music URL from QQ Music API (via main process)
  getQQMusicUrl: async (requestData: any, cookieString: string) => {
    return ipcRenderer.invoke('get-qq-music-url', requestData, cookieString);
  },

  // Generic QQ Music API request (via main process, avoids renderer CORS/cookie limits)
  qqMusicRequest: async (options: {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    cookie?: string;
  }) => {
    return ipcRenderer.invoke('qq-music-request', options);
  },

  // Get lyrics from QQ Music API (via main process, avoids CORS)
  getQQMusicLyrics: async (songmid: string, cookieString: string) => {
    return ipcRenderer.invoke('get-qq-music-lyrics', songmid, cookieString);
  },

  // NetEase Cloud Music generic weapi request (encryption runs in main process)
  neteaseRequest: async (channel: string, params: any, cookieString?: string) => {
    return ipcRenderer.invoke('netease-request', channel, params, cookieString);
  },

  // Soda Music request bridge and encrypted-audio download (main process only).
  sodaRequest: async (route: string, params: Record<string, unknown>, cookieString?: string) => {
    return ipcRenderer.invoke('soda-request', route, params, cookieString);
  },
  downloadSodaAudio: async (trackId: string, cookieString: string, filePath: string) => {
    return ipcRenderer.invoke('download-soda-audio', trackId, cookieString, filePath);
  },

  // QQ Music QR scan login (start session + poll)
  qqLoginQrStart: async () => {
    return ipcRenderer.invoke('qq-login-qr-start');
  },
  qqLoginQrPoll: async (token: string) => {
    return ipcRenderer.invoke('qq-login-qr-poll', token);
  },

  // NetEase Cloud Music QR scan login (key → create → check)
  neteaseQrKey: async () => {
    return ipcRenderer.invoke('netease-qr-key');
  },
  neteaseQrCreate: async (key: string) => {
    return ipcRenderer.invoke('netease-qr-create', key);
  },
  neteaseQrCheck: async (key: string) => {
    return ipcRenderer.invoke('netease-qr-check', key);
  },

  // Sync an online-source cookie to the main process for the stream:// protocol
  setOnlineCookie: async (source: string, cookie: string) => {
    return ipcRenderer.invoke('set-online-cookie', source, cookie);
  },

  fetchCoverBase64: async (coverUrl: string) => {
    return ipcRenderer.invoke('fetch-cover-base64', coverUrl);
  },

  // Select download folder
  selectDownloadFolder: async () => {
    return ipcRenderer.invoke('select-download-folder');
  },

  // Download and save audio file directly to path (non-blocking)
  downloadAndSave: async (url: string, cookieString: string, filePath: string) => {
    return ipcRenderer.invoke('download-and-save', url, cookieString, filePath);
  },

  // Save file to specified path
  saveFileToPath: async (dirPath: string, fileName: string, fileData: ArrayBuffer) => {
    return ipcRenderer.invoke('save-file-to-path', dirPath, fileName, fileData);
  },

  // Read audio file metadata (music-tag-native)
  readAudioMetadata: async (filePath: string) => {
    return ipcRenderer.invoke('read-audio-metadata', filePath);
  },

  // Write metadata to audio file (music-tag-native + custom QRC/YRC fields)
  writeAudioMetadata: async (filePath: string, metadata: {
    title?: string;
    artist?: string;
    album?: string;
    lyrics?: string;
    coverUrl?: string;
    wordLyrics?: string;
    wordLyricsFormat?: 'qrc' | 'yrc';
  }) => {
    return ipcRenderer.invoke('write-audio-metadata', filePath, metadata);
  },

  // Refresh metadata for a single track (legacy, use readAudioMetadata instead)
  refreshTrackMetadata: async (filePath: string) => {
    return ipcRenderer.invoke('refresh-track-metadata', filePath);
  },

  // Shortcut events - listen for shortcuts from main process
  onShortcut: (callback: (event: { accelerator: string; key: string; code: string; control: boolean; meta: boolean; alt: boolean; shift: boolean }) => void) => {
    const wrapped = (_event: unknown, data: { accelerator: string; key: string; code: string; control: boolean; meta: boolean; alt: boolean; shift: boolean }) => callback(data);
    ipcRenderer.on('shortcut-triggered', wrapped);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('shortcut-triggered', wrapped);
    };
  },

  // Run startup resource cleanup
  runStartupCleanup: async (activeTrackIds: string[]) => {
    return ipcRenderer.invoke('run-startup-cleanup', activeTrackIds);
  },

  // Cleanup orphan cover files (covers for tracks no longer in library)
  cleanupOrphanCovers: async (activeTrackIds: string[]) => {
    return ipcRenderer.invoke('cleanup-orphan-covers', activeTrackIds);
  },

  // ---- Settings store (IPC to main process settings.json) ----
  settingsGet: async (key: string) => {
    return ipcRenderer.invoke('settings:get', key);
  },
  settingsGetAll: async () => {
    return ipcRenderer.invoke('settings:getAll');
  },
  settingsSet: async (key: string, value: string) => {
    return ipcRenderer.invoke('settings:set', key, value);
  },
  settingsSetMany: async (entries: Record<string, string>) => {
    return ipcRenderer.invoke('settings:setMany', entries);
  },
  settingsDelete: async (key: string) => {
    return ipcRenderer.invoke('settings:delete', key);
  },
  settingsReplaceAll: async (entries: Record<string, string>) => {
    return ipcRenderer.invoke('settings:replaceAll', entries);
  },

  // ---- User Data Store (IPC to ~/.la/users.json) ----
  userDataLoad: async () => {
    return ipcRenderer.invoke('userData:load');
  },
  userDataSave: async (data: unknown) => {
    return ipcRenderer.invoke('userData:save', data);
  },
  userDataSaveTracks: async (tracks: unknown[]) => {
    return ipcRenderer.invoke('userData:saveTracks', tracks);
  },
  userDataGetFilePath: async () => {
    return ipcRenderer.invoke('userData:getFilePath');
  },

  // ---- Auto-updater (electron-updater) ----
  // Check for updates manually
  checkForUpdates: async () => {
    return ipcRenderer.invoke('updater:check');
  },

  // Quit and install a downloaded update
  quitAndInstall: async () => {
    return ipcRenderer.invoke('updater:quit-and-install');
  },

  // Get current app version
  getAppVersion: async () => {
    return ipcRenderer.invoke('app:get-version');
  },

  // Show a system notification via main process (Notification API)
  showNotification: async (title: string, body: string, options?: { silent?: boolean }) => {
    return ipcRenderer.invoke('notification:show', { title, body, silent: options?.silent });
  },

  // Listen for updater state changes
  onUpdaterEvent: (callback: (state: unknown) => void) => {
    const existing = updaterEventListenerMap.get(callback);
    if (existing) {
      ipcRenderer.removeListener('updater-event', existing);
    }
    const wrapped = (_event: unknown, state: unknown) => callback(state);
    updaterEventListenerMap.set(callback, wrapped);
    ipcRenderer.on('updater-event', wrapped);
  },

  // Remove updater state listener
  offUpdaterEvent: (callback: (state: unknown) => void) => {
    const wrapped = updaterEventListenerMap.get(callback);
    if (wrapped) {
      ipcRenderer.removeListener('updater-event', wrapped);
      updaterEventListenerMap.delete(callback);
    }
  }
});
