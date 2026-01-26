// Simple preload script - contextIsolation is disabled, so we can use global
const { contextBridge, ipcRenderer } = require('electron');

globalThis.electron = {
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
  // Save library to disk
  saveLibrary: async (library: any) => {
    return ipcRenderer.invoke('save-library', library);
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
  }
};
