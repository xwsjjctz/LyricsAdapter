import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(__dirname, '../../public');

let win: BrowserWindow | null;

const createWindow = async () => {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'LyricsAdapter',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      allowRunningInsecureContent: true
    },
  });

  // Set session permissions
  const session = win.webContents.session;
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' 'unsafe-eval' data: https: blob:;"]
      }
    });
  });

  // Log to both console and file
  const log = (...args: any[]) => {
    console.log(...args);
    if (win) {
      win.webContents.executeJavaScript(`console.log(${args.map(a => JSON.stringify(a)).join(', ')})`);
    }
  };

  // Load the app
  if (app.isPackaged) {
    // In production, the structure is:
    // Resources/dist-electron/main.js (current file)
    // Resources/dist/index.html (target)
    const htmlPath = path.join(__dirname, '../../dist/index.html');
    log('Loading HTML from:', htmlPath);
    log('__dirname:', __dirname);

    // Check if file exists
    const fs = await import('fs');
    log('HTML file exists:', fs.existsSync(htmlPath));

    win.webContents.on('did-finish-load', () => {
      log('Page loaded successfully');
      win?.webContents.executeJavaScript('console.log("React render check:", document.getElementById("root"))');
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      log('Failed to load:', errorCode, errorDescription);
    });

    // DevTools are disabled by default
    // To enable, uncomment the line below:
    // win.webContents.openDevTools();

    // Try loading with file:// protocol
    const fileUrl = `file://${htmlPath}`;
    log('Loading URL:', fileUrl);
    await win.loadURL(fileUrl);
  } else {
    win.loadURL('http://localhost:3000');
    // DevTools for development - uncomment if needed
    // win.webContents.openDevTools();
  }

  win.on('closed', () => {
    win = null;
  });
};

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (win === null) {
    createWindow();
  }
});

app.whenReady().then(() => {
  createWindow();

  // IPC handler to read file from path
  ipcMain.handle('read-file', async (event, filePath) => {
    try {
      const data = fs.readFileSync(filePath);
      return {
        success: true,
        data: data.buffer
      };
    } catch (error) {
      console.error('Failed to read file:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  // IPC handler to check if file exists
  ipcMain.handle('check-file-exists', async (event, filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch (error) {
      return false;
    }
  });

  // IPC handler to select folder
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections']
    });
    return result;
  });
});
