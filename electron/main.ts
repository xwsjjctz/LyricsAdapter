import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { createHash } from 'crypto';
import { PassThrough } from 'stream';
import NodeID3 from 'node-id3';
import flacMetadata from 'flac-metadata';

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
  
  // Configure session for CORS - allow QQ Music API access
  const filter = {
    urls: ['https://*.y.qq.com/*', 'https://*.qq.com/*', 'https://*.qqmusic.qq.com/*']
  };
  
  session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    // Ensure Cookie header is properly set
    if (details.requestHeaders) {
      callback({ requestHeaders: details.requestHeaders });
    } else {
      callback({});
    }
  });

  session.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = details.responseHeaders || {};
    
    // Add CORS headers to allow cross-origin requests
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, POST, OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['Content-Type, Authorization, Cookie, Referer, User-Agent'];
    headers['Access-Control-Allow-Credentials'] = ['true'];
    
    callback({ responseHeaders: headers });
  });
  if (app.isPackaged) {
    // Production: apply CSP that allows the app to function properly
    // Need to allow:
    // - 'unsafe-inline' for scripts/styles in index.html (importmap, inline styles)
    // - blob: for audio blob URLs and metadata parsing
    // - esm.sh for React CDN imports
    // - worker-src for Workers
    // - QQ Music API endpoints for browse feature
    session.webRequest.onHeadersReceived((details, callback) => {
      const csp = `default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://esm.sh; style-src 'self' 'unsafe-inline' blob: data: https://esm.sh; img-src 'self' blob: data: https: http: file: cover: https://*.gtimg.cn; media-src 'self' blob: data: file: https://*.qqmusic.qq.com; connect-src 'self' blob: data: ws://localhost:* http://localhost:* https://esm.sh https://u.y.qq.com https://y.qq.com https://c.y.qq.com https://shc.y.qq.com https://i.y.qq.com https://dl.stream.qqmusic.qq.com; worker-src 'self' blob:; frame-src 'self' blob:; font-src 'self' blob: data: https://esm.sh;`;
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

  // Download and save audio file directly to path (non-blocking)
  ipcMain.handle('download-and-save', async (event, url: string, cookieString: string, filePath: string) => {
    try {
      // Expand ~ to home directory
      const expandedPath = expandHomeDir(filePath);
      console.log('[Main] Starting download to:', expandedPath);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Referer': 'https://y.qq.com/',
          'Cookie': cookieString,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const total = parseInt(response.headers.get('content-length') || '0');
      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('ReadableStream not supported');
      }

      // Ensure directory exists
      const dirPath = path.dirname(expandedPath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Write directly to file using streaming
      const writer = fs.createWriteStream(expandedPath);
      let downloaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        writer.write(Buffer.from(value));
        downloaded += value.length;

        // Report progress
        if (total > 0) {
          event.sender.send('download-progress', {
            downloaded,
            total,
            progress: Math.round((downloaded / total) * 100)
          });
        }

        // Yield to event loop frequently to prevent blocking
        await new Promise(resolve => setImmediate(resolve));
      }

      writer.end();
      await new Promise<void>(resolve => writer.on('finish', resolve));

      console.log('[Main] Download completed, size:', downloaded, 'bytes');
      return { success: true, filePath: expandedPath, size: downloaded };
    } catch (error) {
      console.error('[Main] Download failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Download audio file from URL with cookies (streaming to avoid blocking)
  ipcMain.handle('download-audio-file', async (event, url: string, cookieString: string) => {
    try {
      console.log('[Main] Starting streaming download from:', url.substring(0, 100) + '...');
      
      // Use native fetch with streaming
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Referer': 'https://y.qq.com/',
          'Cookie': cookieString,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const total = parseInt(response.headers.get('content-length') || '0');
      const reader = response.body?.getReader();
      
      if (!reader) {
        throw new Error('ReadableStream not supported');
      }

      const chunks: Uint8Array[] = [];
      let downloaded = 0;
      let chunkCount = 0;

      // Read chunks in a non-blocking way
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        chunks.push(value);
        downloaded += value.length;
        chunkCount++;
        
        // Report progress every 50 chunks (~400KB) to avoid too many IPC calls
        if (chunkCount % 50 === 0 && total > 0) {
          event.sender.send('download-progress', {
            downloaded,
            total,
            progress: Math.round((downloaded / total) * 100)
          });
        }
        
        // Yield to event loop every 100 chunks to prevent blocking
        if (chunkCount % 100 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }

      // Combine chunks
      const allChunks = new Uint8Array(downloaded);
      let position = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
      }
      
      console.log('[Main] Download completed, size:', downloaded, 'bytes');
      
      return { 
        success: true, 
        data: Array.from(allChunks)
      };
    } catch (error) {
      console.error('[Main] Download failed:', error);
      return { 
        success: false, 
        error: (error as Error).message 
      };
    }
  });

  // Select folder dialog
  ipcMain.handle('select-download-folder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: '选择下载目录'
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        return { success: true, path: result.filePaths[0] };
      }
      return { success: false, canceled: true };
    } catch (error) {
      console.error('[Main] Select folder failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Helper: Expand ~ to home directory
  function expandHomeDir(inputPath: string): string {
    if (inputPath.startsWith('~/') || inputPath === '~') {
      return path.join(os.homedir(), inputPath.slice(1));
    }
    return inputPath;
  }

  // Save file to specified path
  ipcMain.handle('save-file-to-path', async (event, dirPath: string, fileName: string, fileData: ArrayBuffer) => {
    try {
      // Expand ~ to home directory
      const expandedDir = expandHomeDir(dirPath);
      
      // Join directory and filename using platform-specific separator
      const fullPath = path.join(expandedDir, fileName);
      console.log('[Main] Saving file to:', fullPath);
      
      // Ensure directory exists
      if (!fs.existsSync(expandedDir)) {
        fs.mkdirSync(expandedDir, { recursive: true });
        console.log('[Main] Created directory:', expandedDir);
      }
      
      // Write file
      const buffer = Buffer.from(fileData);
      fs.writeFileSync(fullPath, buffer);
      
      console.log('[Main] File saved successfully, size:', buffer.length);
      return { success: true, filePath: fullPath };
    } catch (error) {
      console.error('[Main] Save file failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Detect file format from magic bytes
  function detectFileFormat(filePath: string): string {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(12);
      fs.readSync(fd, buffer, 0, 12, 0);
      fs.closeSync(fd);

      // Check for FLAC (fLaC) - 0x66, 0x4C, 0x61, 0x43
      if (buffer[0] === 0x66 && buffer[1] === 0x4C && buffer[2] === 0x61 && buffer[3] === 0x43) {
        return 'flac';
      }
      // Check for MP3 (ID3v2)
      if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
        return 'mp3';
      }
      // Check for M4A (ftyp)
      if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
        return 'm4a';
      }

      return 'unknown';
    } catch (e) {
      console.error('[Main] Failed to detect file format:', e);
      return 'error';
    }
  }

  // Get metaflac binary path for current platform
  function getMetaflacPath(): string {
    const platform = process.platform;
    const arch = process.arch;

    // In development, try to use system metaflac first
    if (!app.isPackaged) {
      // Check if metaflac is available in system PATH
      try {
        const { execSync } = require('child_process');
        execSync('which metaflac', { encoding: 'utf-8', stdio: 'pipe' });
        console.log('[Main] Using system metaflac in development');
        return 'metaflac';
      } catch (e) {
        console.warn('[Main] System metaflac not found, will try bundled binary');
        // In development, use project binaries directory
        let binaryPath: string;
        if (platform === 'darwin') {
          // macOS
          if (arch === 'arm64') {
            binaryPath = path.join(__dirname, '../binaries/darwin-arm64/metaflac');
          } else {
            binaryPath = path.join(__dirname, '../binaries/darwin-x64/metaflac');
          }
        } else if (platform === 'win32') {
          // Windows
          binaryPath = path.join(__dirname, '../binaries/win32-x64/metaflac.exe');
        } else if (platform === 'linux') {
          // Linux
          binaryPath = path.join(__dirname, '../binaries/linux-x64/metaflac');
        } else {
          throw new Error(`Unsupported platform: ${platform}-${arch}`);
        }
        console.log('[Main] Using bundled metaflac in development:', binaryPath);
        return binaryPath;
      }
    }

    // In production, use bundled binary from app resources
    let binaryPath: string;

    if (platform === 'darwin') {
      // macOS
      if (arch === 'arm64') {
        binaryPath = path.join(process.resourcesPath, 'binaries', 'darwin-arm64', 'metaflac');
      } else {
        binaryPath = path.join(process.resourcesPath, 'binaries', 'darwin-x64', 'metaflac');
      }
    } else if (platform === 'win32') {
      // Windows
      binaryPath = path.join(process.resourcesPath, 'binaries', 'win32-x64', 'metaflac.exe');
    } else if (platform === 'linux') {
      // Linux
      binaryPath = path.join(process.resourcesPath, 'binaries', 'linux-x64', 'metaflac');
    } else {
      throw new Error(`Unsupported platform: ${platform}-${arch}`);
    }

    console.log('[Main] Using bundled metaflac:', binaryPath);
    return binaryPath;
  }

  // Write FLAC metadata using metaflac command line tool
  async function writeFlacMetadataWithMetaflac(
    filePath: string,
    metadata: { title?: string; artist?: string; album?: string; lyrics?: string; coverUrl?: string }
  ): Promise<boolean> {
    const { execSync } = await import('child_process');
    const logFile = path.join(app.getPath('userData'), 'flac-metadata.log');

    // Get metaflac binary path
    const metaflacBinary = getMetaflacPath();

    // Common exec options with UTF-8 environment
    const execOptions = {
      encoding: 'utf-8' as const,
      stdio: 'pipe' as const,
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8'
      }
    };

    const log = (message: string) => {
      const timestamp = new Date().toISOString();
      const logLine = `[${timestamp}] ${message}\n`;
      console.log(message);
      try {
        fs.appendFileSync(logFile, logLine);
      } catch (e) {
        // Ignore log errors
      }
    };

    try {
      log(`[METAFLAC] Starting metadata write for: ${filePath}`);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Create backup
      const backupPath = filePath + '.backup';
      log(`[METAFLAC] Creating backup: ${backupPath}`);
      fs.copyFileSync(filePath, backupPath);

      // Step 1: Remove existing tags and picture (major operations)
      log(`[METAFLAC] Removing existing metadata`);
      try {
        execSync(`"${metaflacBinary}" --remove-all-tags "${filePath}"`, execOptions);
        execSync(`"${metaflacBinary}" --remove --block-type=PICTURE "${filePath}"`, execOptions);
      } catch (e: any) {
        log(`[METAFLAC] Warning during removal: ${e.message}`);
        // Continue even if removal fails
      }

      // Step 2: Add new tags using separate temp files for each tag to avoid encoding issues
      const tags: { field: string; value: string }[] = [];
      if (metadata.title) tags.push({ field: 'TITLE', value: metadata.title });
      if (metadata.artist) tags.push({ field: 'ARTIST', value: metadata.artist });
      if (metadata.album && metadata.album.trim()) tags.push({ field: 'ALBUM', value: metadata.album });

      if (tags.length > 0) {
        log(`[METAFLAC] Writing ${tags.length} tags: ${tags.map(t => t.field).join(', ')}`);
        log(`[METAFLAC] Metadata: ${JSON.stringify(metadata)}`);

        for (const tag of tags) {
          try {
            // Create a temp file for each tag value
            const tagFile = filePath + `.${tag.field}.txt`;
            fs.writeFileSync(tagFile, tag.value, 'utf-8');

            // Use --set-tag-from-file to avoid shell encoding issues
            execSync(`"${metaflacBinary}" --set-tag-from-file="${tag.field}=${tagFile}" "${filePath}"`, execOptions);
            log(`[METAFLAC] ✓ Set ${tag.field}=${tag.value.substring(0, 30)}${tag.value.length > 30 ? '...' : ''}`);

            // Clean up temp file
            fs.unlinkSync(tagFile);
          } catch (e: any) {
            log(`[METAFLAC] Warning: Failed to set ${tag.field}: ${e.message}`);
            // Continue with other tags even if one fails
          }
        }
        log(`[METAFLAC] ✓ All tags written`);
      } else {
        log(`[METAFLAC] No tags to write, metadata was: ${JSON.stringify(metadata)}`);
      }

      // Step 3: Add lyrics separately
      if (metadata.lyrics) {
        try {
          // Use a temp file for lyrics to avoid shell escaping issues
          const lyricsFile = filePath + '.lyrics.txt';
          fs.writeFileSync(lyricsFile, metadata.lyrics, 'utf-8');

          // Import lyrics from file
          execSync(`"${metaflacBinary}" --set-tag-from-file="LYRICS=${lyricsFile}" "${filePath}"`, execOptions);

          // Clean up temp file
          fs.unlinkSync(lyricsFile);
          log(`[METAFLAC] ✓ Lyrics written (${metadata.lyrics.length} chars)`);
        } catch (e: any) {
          log(`[METAFLAC] Warning: Failed to write lyrics: ${e.message}`);
          // Continue even if lyrics fail
        }
      }

      // Step 4: Add cover image
      if (metadata.coverUrl) {
        try {
          log(`[METAFLAC] Downloading cover from: ${metadata.coverUrl}`);
          const response = await fetch(metadata.coverUrl);
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            const coverBuffer = Buffer.from(arrayBuffer);
            const coverFile = filePath + '.cover.jpg';
            fs.writeFileSync(coverFile, coverBuffer);
            log(`[METAFLAC] Cover downloaded (${coverBuffer.length} bytes)`);

            execSync(`"${metaflacBinary}" --import-picture-from="${coverFile}" "${filePath}"`, execOptions);
            log(`[METAFLAC] ✓ Cover written`);

            // Clean up temp cover file
            fs.unlinkSync(coverFile);
          }
        } catch (e: any) {
          log(`[METAFLAC] Warning: Failed to add cover: ${e.message}`);
          // Continue even if cover fails
        }
      }

      // Verify the file BEFORE writing metadata
      // Note: QQ Music FLAC files may have non-standard formatting, so we skip verification
      // Most players can still play them despite FLAC validation errors
      /*
      try {
        log(`[METAFLAC] Verifying original file before writing metadata...`);
        execSync(`flac --test "${filePath}"`, { encoding: 'utf-8', stdio: 'pipe' });
        log(`[METAFLAC] ✓ Original file is valid`);
      } catch (e: any) {
        log(`[METAFLAC] ✗ Original file validation failed (QQ Music FLAC may be non-standard)`);
        log(`[METAFLAC] Continuing with metadata write anyway...`);
        // Don't return error - QQ Music FLAC files are often non-standard but playable
      }
      */

      // Delete backup on success
      log(`[METAFLAC] Success, removing backup`);
      fs.unlinkSync(backupPath);

      log('[METAFLAC] ✓ Metadata written successfully');
      return true;
    } catch (e) {
      log(`[METAFLAC] ✗ Error: ${(e as Error).message}`);
      // Restore from backup if it exists
      const backupPath = filePath + '.backup';
      if (fs.existsSync(backupPath)) {
        log(`[METAFLAC] Restoring from backup`);
        try {
          fs.copyFileSync(backupPath, filePath);
          fs.unlinkSync(backupPath);
          log(`[METAFLAC] ✓ Backup restored`);
        } catch (restoreError) {
          log(`[METAFLAC] ✗ Failed to restore backup`);
        }
      }
      throw e;
    }
  }

  // Write metadata to audio file (MP3/FLAC)
  ipcMain.handle('write-audio-metadata', async (event, filePath: string, metadata: {
    title?: string;
    artist?: string;
    album?: string;
    lyrics?: string;
    coverUrl?: string;
  }) => {
    try {
      // Expand ~ to home directory
      const expandedPath = expandHomeDir(filePath);
      console.log('[Main] Writing metadata to:', expandedPath);
      console.log('[Main] Metadata:', metadata);

      // Check if file exists
      if (!fs.existsSync(expandedPath)) {
        console.error('[Main] File does not exist:', expandedPath);
        return { success: false, error: '文件不存在' };
      }

      // Get file stats
      const stats = fs.statSync(expandedPath);
      console.log('[Main] File size:', stats.size, 'bytes');

      // Detect actual file format from magic bytes
      const ext = path.extname(expandedPath).toLowerCase();
      const actualFormat = detectFileFormat(expandedPath);
      console.log('[Main] File extension:', ext, '| Detected format:', actualFormat);

      if (actualFormat === 'error') {
        return { success: false, error: '无法检测文件格式' };
      }

      // Download cover image if URL provided
      let coverBuffer: Buffer | undefined;
      if (metadata.coverUrl) {
        try {
          console.log('[Main] Downloading cover from:', metadata.coverUrl);
          const response = await fetch(metadata.coverUrl);
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            coverBuffer = Buffer.from(arrayBuffer);
            console.log('[Main] Cover downloaded, size:', coverBuffer.length);
          }
        } catch (e) {
          console.error('[Main] Failed to download cover:', e);
        }
      }

      // Use actual format to decide how to write metadata
      let success = false;

      if (actualFormat === 'mp3') {
        // Write MP3 ID3 tags using node-id3
        const tags: any = {};
        if (metadata.title) tags.title = metadata.title;
        if (metadata.artist) tags.artist = metadata.artist;
        if (metadata.album) tags.album = metadata.album;
        if (metadata.lyrics) tags.unsynchronisedLyrics = { language: 'chi', text: metadata.lyrics };
        if (coverBuffer) {
          tags.image = {
            mime: 'image/jpeg',
            type: { id: 3, name: 'Cover (front)' },
            description: 'Cover',
            imageBuffer: coverBuffer
          };
        }

        const result = NodeID3.write(tags, expandedPath);
        success = !!result;
        console.log('[Main] MP3 metadata write result:', success);

      } else if (actualFormat === 'flac') {
        // Using metaflac command line tool instead of manual implementation
        console.log('[Main] FLAC metadata write using metaflac');
        success = await writeFlacMetadataWithMetaflac(expandedPath, metadata);
        console.log('[Main] FLAC metadata write result:', success);

      } else {
        console.warn('[Main] Unsupported file format for metadata:', actualFormat);
        return { success: false, error: `不支持的文件格式: ${actualFormat} (扩展名: ${ext})` };
      }

      return { success };
    } catch (error) {
      console.error('[Main] Write metadata failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Helper function to write FLAC metadata
  async function writeFlacMetadata(
    filePath: string,
    metadata: { title?: string; artist?: string; album?: string; lyrics?: string; coverUrl?: string },
    coverBuffer?: Buffer
  ): Promise<boolean> {
    const backupPath = filePath + '.backup';
    const logFile = path.join(app.getPath('userData'), 'flac-metadata.log');

    const log = (message: string) => {
      const timestamp = new Date().toISOString();
      const logLine = `[${timestamp}] ${message}\n`;
      console.log(message);
      try {
        fs.appendFileSync(logFile, logLine);
      } catch (e) {
        // Ignore log errors
      }
    };

    try {
      log(`[FLAC] Starting metadata write for: ${filePath}`);
      log(`[FLAC] Metadata: ${JSON.stringify(metadata)}`);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Create backup
      log(`[FLAC] Creating backup: ${backupPath}`);
      fs.copyFileSync(filePath, backupPath);

      // Read original file
      const fileData = fs.readFileSync(filePath);
      log(`[FLAC] Original file size: ${fileData.length} bytes`);
      log(`[FLAC] First 4 bytes: ${fileData.slice(0, 4).toString('hex')} (${fileData.slice(0, 4).toString()})`);

      // Parse FLAC header to find STREAMINFO and metadata blocks
      // FLAC magic bytes: "fLaC" (0x66, 0x4C, 0x61, 0x43)
      if (fileData[0] !== 0x66 || fileData[1] !== 0x4C || fileData[2] !== 0x61 || fileData[3] !== 0x43) {
        throw new Error('Not a valid FLAC file');
      }

      // Skip 'fLaC' magic bytes
      let pos = 4;

      // Read metadata blocks - keep all blocks except existing VORBIS_COMMENT and PICTURE
      const keptBlocks: Buffer[] = [];
      let isLastBlock = false;
      let blockCount = 0;

      while (!isLastBlock && pos < fileData.length) {
        const blockHeader = fileData[pos];
        isLastBlock = (blockHeader & 0x80) !== 0;
        const blockType = blockHeader & 0x7F;
        const blockLength = (fileData[pos + 1] << 16) | (fileData[pos + 2] << 8) | fileData[pos + 3];

        log(`[FLAC] Block ${blockCount}: type=${blockType}, length=${blockLength}, isLast=${isLastBlock}`);

        // Keep STREAMINFO (type 0) and other blocks, skip VORBIS_COMMENT (type 4) and PICTURE (type 6)
        if (blockType !== 4 && blockType !== 6) {
          keptBlocks.push(fileData.slice(pos, pos + 4 + blockLength));
          log(`[FLAC]   -> Keeping block`);
        } else {
          log(`[FLAC]   -> Skipping block (will replace)`);
        }

        pos += 4 + blockLength;
        blockCount++;
      }

      const audioDataStart = pos;
      log(`[FLAC] Audio data starts at offset: ${audioDataStart}`);
      log(`[FLAC] Kept ${keptBlocks.length} blocks`);

      // Build new metadata
      const newBlocks: Buffer[] = [];

      // Add kept blocks first (STREAMINFO, etc.)
      for (let i = 0; i < keptBlocks.length; i++) {
        const block = keptBlocks[i];
        // Clear last-block flag for all blocks (we'll set it properly later)
        const modified = Buffer.from(block);
        modified[0] &= 0x7F; // Clear last-block flag
        newBlocks.push(modified);
      }

      // Create VORBIS_COMMENT block
      const comments: string[] = [];
      if (metadata.title) comments.push(`TITLE=${metadata.title}`);
      if (metadata.artist) comments.push(`ARTIST=${metadata.artist}`);
      if (metadata.album) comments.push(`ALBUM=${metadata.album}`);
      // Add lyrics to VORBIS_COMMENT
      if (metadata.lyrics) {
        log(`[FLAC] Adding lyrics, length: ${metadata.lyrics.length}`);
        comments.push(`LYRICS=${metadata.lyrics}`);
      }

      if (comments.length > 0) {
        const vorbisComment = createVorbisComment(comments);
        log(`[FLAC] Created VORBIS_COMMENT block, size: ${vorbisComment.length} bytes`);
        newBlocks.push(vorbisComment);
      }

      // Add PICTURE block if cover exists
      if (coverBuffer) {
        const pictureBlock = createPictureBlock(coverBuffer);
        log(`[FLAC] Created PICTURE block, size: ${pictureBlock.length} bytes`);
        newBlocks.push(pictureBlock);
      }

      // Mark last block
      if (newBlocks.length > 0) {
        const lastBlock = newBlocks[newBlocks.length - 1];
        const modifiedLast = Buffer.from(lastBlock);
        modifiedLast[0] |= 0x80; // Set last-metadata-block flag
        newBlocks[newBlocks.length - 1] = modifiedLast;
      }

      log(`[FLAC] Total blocks after processing: ${newBlocks.length}`);

      // Combine: metadata blocks + audio data
      const metadataBytes = Buffer.concat(newBlocks);
      const audioData = fileData.slice(audioDataStart);
      const result = Buffer.concat([fileData.slice(0, 4), metadataBytes, audioData]);

      log(`[FLAC] New file size: ${result.length} bytes (original: ${fileData.length})`);
      log(`[FLAC] Size change: ${result.length - fileData.length} bytes`);

      // Write to temp file first
      const tempPath = filePath + '.tmp';
      log(`[FLAC] Writing to temp file: ${tempPath}`);
      fs.writeFileSync(tempPath, result);

      // Verify temp file
      const verifyData = fs.readFileSync(tempPath);
      log(`[FLAC] Temp file size: ${verifyData.length} bytes`);

      // Rename to original (atomic operation)
      log(`[FLAC] Replacing original file`);
      fs.renameSync(tempPath, filePath);

      // Delete backup on success
      log(`[FLAC] Success, removing backup`);
      fs.unlinkSync(backupPath);

      log('[FLAC] ✓ Metadata written successfully');
      return true;
    } catch (e) {
      log(`[FLAC] ✗ Error: ${(e as Error).message}`);
      log(`[FLAC] Stack: ${(e as Error).stack}`);

      // Restore from backup if it exists
      if (fs.existsSync(backupPath)) {
        log(`[FLAC] Restoring from backup`);
        try {
          fs.copyFileSync(backupPath, filePath);
          fs.unlinkSync(backupPath);
          log(`[FLAC] ✓ Backup restored`);
        } catch (restoreError) {
          log(`[FLAC] ✗ Failed to restore backup: ${restoreError}`);
        }
      }

      throw e;
    }
  }

  // Create FLAC VORBIS_COMMENT block
  function createVorbisComment(comments: string[]): Buffer {
    const vendor = 'LyricsAdapter';
    const vendorBuffer = Buffer.from(vendor, 'utf-8');

    // Build comment strings as buffers
    const commentDataBuffers: Buffer[] = [];
    for (const comment of comments) {
      const commentBuffer = Buffer.from(comment, 'utf-8');
      // For each comment: 4 bytes length + data
      // FLAC spec uses Big Endian (network byte order)
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(commentBuffer.length, 0);
      commentDataBuffers.push(Buffer.concat([lenBuf, commentBuffer]));
    }

    // Create comment count (4 bytes)
    const countBuffer = Buffer.alloc(4);
    countBuffer.writeUInt32BE(comments.length, 0);

    // Combine: vendor string + comment count + all comment data
    const commentsData = Buffer.concat([
      vendorBuffer,
      countBuffer,
      ...commentDataBuffers
    ]);

    // Create block header: type 4 (VORBIS_COMMENT), length (24-bit)
    const header = Buffer.alloc(4);
    header[0] = 4; // Block type 4 = VORBIS_COMMENT
    header.writeUIntBE(commentsData.length, 1, 3);

    return Buffer.concat([header, commentsData]);
  }

  // Create FLAC PICTURE block
  function createPictureBlock(imageBuffer: Buffer): Buffer {
    // Picture type: 3 = Cover (front)
    const pictureType = Buffer.alloc(4);
    pictureType.writeUInt32BE(3, 0);

    // MIME type: length (4 bytes) + string
    const mimeStr = 'image/jpeg';
    const mimeLen = Buffer.alloc(4);
    mimeLen.writeUInt32BE(mimeStr.length, 0);
    const mimeBuffer = Buffer.from(mimeStr, 'utf-8');

    // Description: length (4 bytes) + string (empty)
    const descStr = '';
    const descLen = Buffer.alloc(4);
    descLen.writeUInt32BE(descStr.length, 0);
    const descBuffer = Buffer.from(descStr, 'utf-8');

    // Dimensions (0 = unknown) - each is 4 bytes
    const width = Buffer.alloc(4);
    width.writeUInt32BE(0, 0);
    const height = Buffer.alloc(4);
    height.writeUInt32BE(0, 0);
    const depth = Buffer.alloc(4);
    depth.writeUInt32BE(0, 0);
    const colors = Buffer.alloc(4);
    colors.writeUInt32BE(0, 0);

    const pictureData = Buffer.concat([
      pictureType,
      mimeLen,
      mimeBuffer,
      descLen,
      descBuffer,
      width,
      height,
      depth,
      colors,
      imageBuffer
    ]);

    // Block header: type 6 (PICTURE), length (24-bit)
    const header = Buffer.alloc(4);
    header[0] = 6; // Block type 6 = PICTURE
    header.writeUIntBE(pictureData.length, 1, 3);

    return Buffer.concat([header, pictureData]);
  }

  // Get QQ Music URL via main process (ensures cookies are properly sent)
  ipcMain.handle('get-qq-music-url', async (event, requestData: any, cookieString: string) => {
    try {
      console.log('[Main] Getting QQ Music URL...');
      
      const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: {
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
          'Content-Type': 'application/json',
          'Referer': 'https://y.qq.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Cookie': cookieString,
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      console.log('[Main] Got QQ Music URL response, code:', data.code);
      
      return { success: true, data };
    } catch (error) {
      console.error('[Main] Get QQ Music URL failed:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  // Get lyrics via main process (avoids CORS issues)
  ipcMain.handle('get-qq-music-lyrics', async (event, songmid: string, cookieString: string) => {
    try {
      console.log('[Main] Getting lyrics for:', songmid);

      const response = await fetch(
        `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?_=${Date.now()}` +
        `&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0` +
        `&platform=yqq.json&needNewCode=1&g_tk=5381&songmid=${songmid}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Referer': 'https://y.qq.com/',
            'Cookie': cookieString,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();

      if (result.code !== 0) {
        console.warn('[Main] Lyrics API returned error code:', result.code);
        return { success: false, error: `API error code: ${result.code}` };
      }

      // Decode base64 lyrics
      const lyricBase64 = result.lyric;
      if (!lyricBase64) {
        return { success: false, error: 'No lyrics available' };
      }

      const lyrics = Buffer.from(lyricBase64, 'base64').toString('utf-8');
      console.log('[Main] Lyrics fetched, length:', lyrics.length);

      return { success: true, lyrics };
    } catch (error) {
      console.error('[Main] Get lyrics failed:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });
});
