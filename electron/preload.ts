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
  }
};
