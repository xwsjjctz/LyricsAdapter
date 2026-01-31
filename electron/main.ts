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
  // Log user data directory on startup
  const userDataPath = app.getPath('userData');
  console.log('=== LYRICS ADAPTER STARTUP ===');
  console.log('Platform:', process.platform);
  console.log('User Data Directory:', userDataPath);
  console.log('===============================');

  // macOS 使用原生标题栏，Windows/Linux 使用自定义标题栏
  const isMacOS = process.platform === 'darwin';

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1080,
    minHeight: 720,
    title: 'LyricsAdapter',
    frame: !isMacOS, // macOS 保留原生标题栏，其他平台移除
    titleBarStyle: isMacOS ? 'hiddenInset' : 'hidden', // macOS 使用 hiddenInset 让背景延伸
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      sandbox: true
    },
  });

  // Set session permissions - only apply CSP in production
  const session = win.webContents.session;
  if (app.isPackaged) {
    // Production: apply CSP that allows the app to function properly
    // Need to allow:
    // - 'unsafe-inline' for scripts/styles in index.html (importmap, inline styles)
    // - blob: for audio blob URLs and metadata parsing
    // - esm.sh for React CDN imports
    // - worker-src for Workers
    session.webRequest.onHeadersReceived((details, callback) => {
      const csp = `default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://esm.sh; style-src 'self' 'unsafe-inline' blob: data: https://esm.sh; img-src 'self' blob: data: https: http:; media-src 'self' blob: data:; connect-src 'self' blob: data: ws://localhost:* http://localhost:* https://esm.sh; worker-src 'self' blob:; frame-src 'self' blob:; font-src 'self' blob: data: https://esm.sh;`;
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp]
        }
      });
    });
  }
  // Development: no CSP to allow Vite HMR and inline scripts

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

  // Get user data directory path
  ipcMain.handle('get-app-data-path', async () => {
    return app.getPath('userData');
  });

  // Load library from JSON file
  ipcMain.handle('load-library', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const libraryPath = path.join(userDataPath, 'library.json');

      if (fs.existsSync(libraryPath)) {
        const data = fs.readFileSync(libraryPath, 'utf-8');
        const library = JSON.parse(data);
        return { success: true, library };
      } else {
        // Return empty library if file doesn't exist
        return { success: true, library: { songs: [], settings: {} } };
      }
    } catch (error) {
      console.error('Failed to load library:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Save library to JSON file
  ipcMain.handle('save-library', async (event, library) => {
    try {
      const userDataPath = app.getPath('userData');
      const libraryPath = path.join(userDataPath, 'library.json');

      console.log('=== SAVE LIBRARY DEBUG ===');
      console.log('User data path:', userDataPath);
      console.log('Library path:', libraryPath);
      console.log('Library data:', JSON.stringify(library).substring(0, 200) + '...');

      // Ensure directory exists
      if (!fs.existsSync(userDataPath)) {
        console.log('Creating directory:', userDataPath);
        fs.mkdirSync(userDataPath, { recursive: true });
      }

      // Write library to file
      fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), 'utf-8');

      console.log('Library saved successfully!');
      console.log('File exists after save:', fs.existsSync(libraryPath));
      return { success: true };
    } catch (error) {
      console.error('Failed to save library:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Validate single file path
  ipcMain.handle('validate-file-path', async (event, filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch (error) {
      return false;
    }
  });

  // Helper: Sanitize file name to prevent path traversal
  function sanitizeFileName(fileName: string): string {
    // Remove path separators and dangerous sequences
    const sanitized = fileName.replace(/[\/\\]/g, '').replace(/\.\./g, '').replace(/[<>:"|?*]/g, '');
    if (sanitized !== fileName || sanitized.length === 0) {
      throw new Error('Invalid file name');
    }
    return sanitized;
  }

  // Helper: Validate source path is within allowed directories
  function validateSourcePath(sourcePath: string): boolean {
    try {
      const resolved = path.resolve(sourcePath);
      // Get user home directories
      const homeDirs = [
        app.getPath('home'),
        path.join('/Users'),  // macOS
        path.join('/home'),   // Linux
      ];

      // Check if path is within a user directory
      return homeDirs.some(dir => {
        try {
          return fs.existsSync(dir) && resolved.startsWith(dir);
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }

  // Save audio file to userData directory (using hard link if possible)
  ipcMain.handle('save-audio-file', async (event, sourcePath: string, fileName: string) => {
    try {
      // Validate and sanitize inputs
      const sanitizedFileName = sanitizeFileName(fileName);
      if (!validateSourcePath(sourcePath)) {
        console.error('❌ Invalid source path:', sourcePath);
        return { success: false, error: 'Invalid source path' };
      }

      // Verify source file exists and is accessible
      if (!fs.existsSync(sourcePath)) {
        console.error('❌ Source file does not exist:', sourcePath);
        return { success: false, error: 'Source file not found' };
      }

      const userDataPath = app.getPath('userData');
      const audioDir = path.join(userDataPath, 'audio');

      // Ensure audio directory exists
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      // Generate unique filename to avoid conflicts
      // Use Date.now() + random suffix to ensure uniqueness during parallel processing
      const uniqueFileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${sanitizedFileName}`;
      const audioFilePath = path.join(audioDir, uniqueFileName);

      // Try to create symbolic link (symlink) first (saves disk space)
      try {
        fs.symlinkSync(sourcePath, audioFilePath);
        console.log('✅ Symlink created:', audioFilePath, '→', sourcePath);
        return { success: true, filePath: audioFilePath, method: 'symlink' };
      } catch (linkError) {
        // Symlink failed, fall back to copy
        console.warn('⚠️ Symlink failed, copying file instead:', (linkError as Error).message);
        fs.copyFileSync(sourcePath, audioFilePath);
        console.log('✅ File copied:', audioFilePath);
        return { success: true, filePath: audioFilePath, method: 'copy' };
      }
    } catch (error) {
      console.error('Failed to save audio file:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Save audio file from buffer (for web input imports)
  ipcMain.handle('save-audio-file-from-buffer', async (event, fileName: string, fileData: ArrayBuffer) => {
    try {
      const userDataPath = app.getPath('userData');
      const audioDir = path.join(userDataPath, 'audio');

      // Ensure audio directory exists
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      // Generate unique filename to avoid conflicts
      const uniqueFileName = `${Date.now()}-${fileName}`;
      const audioFilePath = path.join(audioDir, uniqueFileName);

      // Write file
      const buffer = Buffer.from(fileData);
      fs.writeFileSync(audioFilePath, buffer);

      console.log('✅ File saved from buffer:', audioFilePath);
      return { success: true, filePath: audioFilePath, method: 'copy' };
    } catch (error) {
      console.error('Failed to save audio file from buffer:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Validate all file paths in library
  ipcMain.handle('validate-all-paths', async (event, songs) => {
    try {
      const results = songs.map((song: any) => ({
        id: song.id,
        exists: song.filePath ? fs.existsSync(song.filePath) : false
      }));
      return { success: true, results };
    } catch (error) {
      console.error('Failed to validate paths:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Delete audio file (symlink) from userData directory
  ipcMain.handle('delete-audio-file', async (event, filePath: string) => {
    try {
      if (!filePath) {
        return { success: false, error: 'File path is empty' };
      }

      // Check if file exists before deleting
      if (!fs.existsSync(filePath)) {
        console.warn('⚠️ File does not exist, skipping deletion:', filePath);
        return { success: true, deleted: false };
      }

      // Delete the file/symlink
      fs.unlinkSync(filePath);
      console.log('✅ File/symlink deleted:', filePath);
      return { success: true, deleted: true };
    } catch (error) {
      console.error('Failed to delete audio file:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Window control handlers
  ipcMain.handle('window-minimize', async () => {
    if (win) {
      win.minimize();
    }
  });

  ipcMain.handle('window-maximize', async () => {
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.handle('window-close', async () => {
    if (win) {
      win.close();
    }
  });

  ipcMain.handle('window-is-maximized', async () => {
    if (win) {
      return win.isMaximized();
    }
    return false;
  });
});
