// Secure preload script using contextBridge
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
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
  }
});
