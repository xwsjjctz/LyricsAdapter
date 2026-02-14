import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createHash } from 'crypto';

// Create __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Suppress macOS Electron warnings
// Disable GPU sandbox on macOS to avoid SetApplicationIsDaemon error
app.commandLine.appendSwitch('disable-gpu-sandbox');
// Disable quota database warnings
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
// Enable logging for storage but suppress quota errors
app.commandLine.appendSwitch('log-level', '3');

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

  // 所有平台都使用无边框窗口，通过 React 组件渲染自定义标题栏
  // macOS: hiddenInset 保留原生红黄绿按钮在左侧
  // Windows/Linux: 完全自定义标题栏和窗口控制按钮
  const isMacOS = process.platform === 'darwin';

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1080,
    minHeight: 720,
    title: 'LyricsAdapter',
    frame: false, // 所有平台都使用无边框窗口，自定义标题栏
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
      const csp = `default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://esm.sh; style-src 'self' 'unsafe-inline' blob: data: https://esm.sh; img-src 'self' blob: data: https: http: file: cover:; media-src 'self' blob: data: file:; connect-src 'self' blob: data: ws://localhost:* http://localhost:* https://esm.sh; worker-src 'self' blob:; frame-src 'self' blob:; font-src 'self' blob: data: https://esm.sh;`;
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

// Register custom protocol for cover images before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cover',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: false
    }
  }
]);

app.whenReady().then(() => {
  // Register cover:// protocol to serve cover images
  const coverDir = path.join(app.getPath('userData'), 'covers');
  protocol.handle('cover', (request) => {
    const url = request.url.slice('cover://'.length);
    // Decode URL encoding
    const decodedUrl = decodeURIComponent(url);
    // Construct the full path
    const coverPath = path.join(coverDir, decodedUrl);

    // Security check: ensure the path is within coverDir
    const resolvedPath = path.resolve(coverPath);
    const resolvedCoverDir = path.resolve(coverDir);
    if (!resolvedPath.startsWith(resolvedCoverDir)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return new Response('Not Found', { status: 404 });
    }

    // Read and return the file
    const fileData = fs.readFileSync(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp'
    };
    const mimeType = mimeTypes[ext] || 'image/jpeg';

    return new Response(fileData, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000'
      }
    });
  });

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

  // Helper: Convert full library to lightweight index
  function toLibraryIndex(library: any): any {
    const songs = Array.isArray(library?.songs) ? library.songs.map((song: any) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration || 0,
      coverUrl: (typeof song.coverUrl === 'string' && !song.coverUrl.startsWith('blob:') && !song.coverUrl.startsWith('data:'))
        ? song.coverUrl
        : '',
      filePath: song.filePath || '',
      fileName: song.fileName || '',
      fileSize: song.fileSize || 0,
      lastModified: song.lastModified || 0,
      addedAt: song.addedAt || '',
      playCount: song.playCount || 0,
      lastPlayed: song.lastPlayed || null,
      available: song.available ?? true
    })) : [];
    return { songs, settings: library?.settings || {} };
  }

  // Load library index (lightweight) from JSON file
  ipcMain.handle('load-library-index', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const indexPath = path.join(userDataPath, 'library-index.json');
      const legacyPath = path.join(userDataPath, 'library.json');

      if (fs.existsSync(indexPath)) {
        const data = fs.readFileSync(indexPath, 'utf-8');
        const library = JSON.parse(data);
        return { success: true, library };
      }

      if (fs.existsSync(legacyPath)) {
        const data = fs.readFileSync(legacyPath, 'utf-8');
        const library = JSON.parse(data);
        return { success: true, library: toLibraryIndex(library) };
      }

      return { success: true, library: { songs: [], settings: {} } };
    } catch (error) {
      console.error('Failed to load library index:', error);
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

  // Save library index to JSON file
  ipcMain.handle('save-library-index', async (event, library) => {
    try {
      const userDataPath = app.getPath('userData');
      const indexPath = path.join(userDataPath, 'library-index.json');

      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }

      fs.writeFileSync(indexPath, JSON.stringify(library, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('Failed to save library index:', error);
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

  // Helper: Sanitize track id for file names
  function sanitizeTrackId(trackId: string): string {
    const cleaned = trackId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    if (cleaned.length >= 6) {
      return cleaned;
    }
    return createHash('sha1').update(trackId).digest('hex');
  }

  function coverExtFromMime(mime?: string): string {
    if (!mime) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('jpeg')) return 'jpg';
    return 'jpg';
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

  // Save cover thumbnail to userData/covers
  ipcMain.handle('save-cover-thumbnail', async (event, payload: { id: string; data: string; mime: string }) => {
    try {
      if (!payload?.id || !payload?.data) {
        return { success: false, error: 'Missing cover data' };
      }

      const userDataPath = app.getPath('userData');
      const coverDir = path.join(userDataPath, 'covers');
      const safeId = sanitizeTrackId(payload.id);
      const ext = coverExtFromMime(payload.mime);

      if (!fs.existsSync(coverDir)) {
        fs.mkdirSync(coverDir, { recursive: true });
      }

      const coverPath = path.join(coverDir, `${safeId}.${ext}`);
      const buffer = Buffer.from(payload.data, 'base64');
      fs.writeFileSync(coverPath, buffer);

      // Use cover:// protocol instead of file:// protocol
      const coverUrl = `cover://${safeId}.${ext}`;
      return { success: true, filePath: coverPath, coverUrl };
    } catch (error) {
      console.error('Failed to save cover thumbnail:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Delete cover thumbnail from userData/covers
  ipcMain.handle('delete-cover-thumbnail', async (event, trackId: string) => {
    try {
      if (!trackId) {
        return { success: false, error: 'Missing trackId' };
      }

      const userDataPath = app.getPath('userData');
      const coverDir = path.join(userDataPath, 'covers');
      const safeId = sanitizeTrackId(trackId);
      const exts = ['jpg', 'jpeg', 'png', 'webp'];
      let deleted = false;

      for (const ext of exts) {
        const coverPath = path.join(coverDir, `${safeId}.${ext}`);
        if (fs.existsSync(coverPath)) {
          fs.unlinkSync(coverPath);
          deleted = true;
        }
      }

      return { success: true, deleted };
    } catch (error) {
      console.error('Failed to delete cover thumbnail:', error);
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

  // Cleanup orphaned audio files in userData/audio (Electron only)
  ipcMain.handle('cleanup-orphan-audio', async (event, keepPaths: string[]) => {
    try {
      const userDataPath = app.getPath('userData');
      const audioDir = path.join(userDataPath, 'audio');

      if (!fs.existsSync(audioDir)) {
        return { success: true, removed: 0 };
      }

      const keepSet = new Set(
        (keepPaths || [])
          .filter(p => typeof p === 'string' && p.length > 0)
          .map(p => path.resolve(p))
      );

      let removed = 0;
      const entries = fs.readdirSync(audioDir);
      for (const name of entries) {
        const fullPath = path.join(audioDir, name);
        const resolved = path.resolve(fullPath);
        if (!keepSet.has(resolved)) {
          try {
            fs.unlinkSync(resolved);
            removed++;
          } catch (e) {
            console.warn('Failed to remove orphan audio file:', resolved, e);
          }
        }
      }

      if (removed > 0) {
        console.log(`🧹 Cleaned ${removed} orphan audio file(s)`);
      }
      return { success: true, removed };
    } catch (error) {
      console.error('Failed to cleanup orphan audio files:', error);
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
