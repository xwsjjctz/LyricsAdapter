// Secure preload script using contextBridge
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const downloadProgressListenerMap = new Map();

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

  // Read file from path
  readFile: async (filePath: string) => {
    return ipcRenderer.invoke('read-file', filePath);
  },

  // Check if file exists
  checkFileExists: async (filePath: string) => {
    return ipcRenderer.invoke('check-file-exists', filePath);
  },

  // Select files dialog
  selectFiles: async () => {
    return ipcRenderer.invoke('select-folder');
  },

  // Get app data directory path
  getAppDataPath: async () => {
    return ipcRenderer.invoke('get-app-data-path');
  },

  // Load library from disk
  loadLibrary: async () => {
    return ipcRenderer.invoke('load-library');
  },

  // Load library index from disk
  loadLibraryIndex: async () => {
    return ipcRenderer.invoke('load-library-index');
  },

  // Save library to disk
  saveLibrary: async (library: any) => {
    return ipcRenderer.invoke('save-library', library);
  },

  // Save library index to disk
  saveLibraryIndex: async (library: any) => {
    return ipcRenderer.invoke('save-library-index', library);
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

  closeWindow: async () => {
    return ipcRenderer.invoke('window-close');
  },

  isMaximized: async () => {
    return ipcRenderer.invoke('window-is-maximized');
  },

  // Get real file path from File object (for drag-and-drop)
  getPathForFile: (file: File) => {
    return webUtils.getPathForFile(file);
  },

  // Download audio file from URL with cookies (for QQ Music download)
  downloadAudioFile: async (url: string, cookieString: string) => {
    return ipcRenderer.invoke('download-audio-file', url, cookieString);
  },

  // Get music URL from QQ Music API (via main process)
  getQQMusicUrl: async (requestData: any, cookieString: string) => {
    return ipcRenderer.invoke('get-qq-music-url', requestData, cookieString);
  },

  // Get lyrics from QQ Music API (via main process, avoids CORS)
  getQQMusicLyrics: async (songmid: string, cookieString: string) => {
    return ipcRenderer.invoke('get-qq-music-lyrics', songmid, cookieString);
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

  // Write metadata to audio file
  writeAudioMetadata: async (filePath: string, metadata: {
    title?: string;
    artist?: string;
    album?: string;
    lyrics?: string;
    coverUrl?: string;
  }) => {
    return ipcRenderer.invoke('write-audio-metadata', filePath, metadata);
  }
});
