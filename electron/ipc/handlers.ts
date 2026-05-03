import { ipcMain, BrowserWindow, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { logger } from '../logger';
import {
  sanitizeFileName,
  sanitizeTrackId,
  expandHomeDir,
  validateSourcePath,
  coverExtFromMime
} from '../utils/fileUtils';
import { writeAudioMetadata } from '../utils/metadataUtils';

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
    lastPlayed: song.lastPlayed ?? undefined,
    available: song.available ?? true
  })) : [];
  return { songs, settings: library?.settings || {} };
}

export function registerFileHandlers(): void {
  ipcMain.handle('read-file', async (_event, filePath) => {
    try {
      const data = fs.readFileSync(filePath);
      return { success: true, data: data.buffer };
    } catch (error) {
      logger.error('Failed to read file:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('check-file-exists', async (_event, filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  });

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections']
    });
    return result;
  });

  ipcMain.handle('get-app-data-path', async () => {
    return app.getPath('userData');
  });

  ipcMain.handle('validate-file-path', async (_event, filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  });

  ipcMain.handle('save-audio-file', async (_event, sourcePath: string, fileName: string) => {
    try {
      const sanitizedFileName = sanitizeFileName(fileName);
      if (!validateSourcePath(sourcePath)) {
        logger.error('❌ Invalid source path:', sourcePath);
        return { success: false, error: 'Invalid source path' };
      }

      if (!fs.existsSync(sourcePath)) {
        logger.error('❌ Source file does not exist:', sourcePath);
        return { success: false, error: 'Source file not found' };
      }

      const userDataPath = app.getPath('userData');
      const audioDir = path.join(userDataPath, 'audio');

      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      const uniqueFileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${sanitizedFileName}`;
      const audioFilePath = path.join(audioDir, uniqueFileName);

      try {
        fs.symlinkSync(sourcePath, audioFilePath);
        logger.info('✅ Symlink created:', audioFilePath, '→', sourcePath);
        return { success: true, filePath: audioFilePath, method: 'symlink' };
      } catch (linkError) {
        logger.warn('⚠️ Symlink failed, copying file instead:', (linkError as Error).message);
        fs.copyFileSync(sourcePath, audioFilePath);
        logger.info('✅ File copied:', audioFilePath);
        return { success: true, filePath: audioFilePath, method: 'copy' };
      }
    } catch (error) {
      logger.error('Failed to save audio file:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('save-audio-file-from-buffer', async (_event, fileName: string, fileData: ArrayBuffer) => {
    try {
      const userDataPath = app.getPath('userData');
      const audioDir = path.join(userDataPath, 'audio');

      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      const uniqueFileName = `${Date.now()}-${fileName}`;
      const audioFilePath = path.join(audioDir, uniqueFileName);

      const buffer = Buffer.from(fileData);
      fs.writeFileSync(audioFilePath, buffer);

      logger.info('✅ File saved from buffer:', audioFilePath);
      return { success: true, filePath: audioFilePath, method: 'copy' };
    } catch (error) {
      logger.error('Failed to save audio file from buffer:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('delete-audio-file', async (_event, filePath: string) => {
    try {
      if (!filePath) {
        return { success: false, error: 'File path is empty' };
      }

      if (!fs.existsSync(filePath)) {
        logger.warn('⚠️ File does not exist, skipping deletion:', filePath);
        return { success: true, deleted: false };
      }

      fs.unlinkSync(filePath);
      logger.info('✅ File/symlink deleted:', filePath);
      return { success: true, deleted: true };
    } catch (error) {
      logger.error('Failed to delete audio file:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('cleanup-orphan-audio', async (_event, keepPaths: string[]) => {
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
            logger.warn('Failed to remove orphan audio file:', resolved, e);
          }
        }
      }

      if (removed > 0) {
        logger.info(`🧹 Cleaned ${removed} orphan audio file(s)`);
      }
      return { success: true, removed };
    } catch (error) {
      logger.error('Failed to cleanup orphan audio files:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('validate-all-paths', async (_event, songs) => {
    try {
      const results = songs.map((song: any) => ({
        id: song.id,
        exists: song.filePath ? fs.existsSync(song.filePath) : false
      }));
      return { success: true, results };
    } catch (error) {
      logger.error('Failed to validate paths:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}

export function registerLibraryHandlers(): void {
  ipcMain.handle('load-library', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const libraryPath = path.join(userDataPath, 'library.json');

      if (fs.existsSync(libraryPath)) {
        const data = fs.readFileSync(libraryPath, 'utf-8');
        const library = JSON.parse(data);
        return { success: true, library };
      } else {
        return { success: true, library: { songs: [], settings: {} } };
      }
    } catch (error) {
      logger.error('Failed to load library:', error);
      return { success: false, error: (error as Error).message };
    }
  });

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
      logger.error('Failed to load library index:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('save-library', async (_event, library) => {
    try {
      const userDataPath = app.getPath('userData');
      const libraryPath = path.join(userDataPath, 'library.json');

      logger.info('=== SAVE LIBRARY DEBUG ===');
      logger.info('User data path:', userDataPath);
      logger.info('Library path:', libraryPath);
      logger.info('Library data:', JSON.stringify(library).substring(0, 200) + '...');

      if (!fs.existsSync(userDataPath)) {
        logger.info('Creating directory:', userDataPath);
        fs.mkdirSync(userDataPath, { recursive: true });
      }

      fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), 'utf-8');

      logger.info('Library saved successfully!');
      logger.info('File exists after save:', fs.existsSync(libraryPath));
      return { success: true };
    } catch (error) {
      logger.error('Failed to save library:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('save-library-index', async (_event, library) => {
    try {
      const userDataPath = app.getPath('userData');
      const indexPath = path.join(userDataPath, 'library-index.json');

      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }

      fs.writeFileSync(indexPath, JSON.stringify(library, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      logger.error('Failed to save library index:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('save-local-library-backup', async (_event, library) => {
    try {
      const userDataPath = app.getPath('userData');
      const backupPath = path.join(userDataPath, 'library-local-backup.json');

      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }

      fs.writeFileSync(backupPath, JSON.stringify(library, null, 2), 'utf-8');
      logger.info('[IPC] Local library backup saved');
      return { success: true };
    } catch (error) {
      logger.error('Failed to save local library backup:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('load-local-library-backup', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const backupPath = path.join(userDataPath, 'library-local-backup.json');

      if (fs.existsSync(backupPath)) {
        const data = fs.readFileSync(backupPath, 'utf-8');
        const library = JSON.parse(data);
        logger.info('[IPC] Local library backup loaded');
        return { success: true, library };
      }

      return { success: true, library: null };
    } catch (error) {
      logger.error('Failed to load local library backup:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}

export function registerCoverHandlers(): void {
  ipcMain.handle('save-cover-thumbnail', async (_event, payload: { id: string; data: string; mime: string }) => {
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

      const coverUrl = `cover://${safeId}.${ext}`;
      return { success: true, filePath: coverPath, coverUrl };
    } catch (error) {
      logger.error('Failed to save cover thumbnail:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('delete-cover-thumbnail', async (_event, trackId: string) => {
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
      logger.error('Failed to delete cover thumbnail:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}

export function registerWindowControls(win: BrowserWindow | null): void {
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

  ipcMain.handle('window-is-fullscreen', async () => {
    if (win) {
      return win.isFullScreen();
    }
    return false;
  });

  if (win) {
    win.on('enter-full-screen', () => {
      win?.webContents.send('fullscreen-changed', true);
    });
    win.on('leave-full-screen', () => {
      win?.webContents.send('fullscreen-changed', false);
    });
  }
}

export function registerDownloadHandlers(): void {
  ipcMain.handle('download-and-save', async (event, url: string, cookieString: string, filePath: string) => {
    try {
      const expandedPath = expandHomeDir(filePath);
      logger.info('[Main] Starting download to:', expandedPath);

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

      const dirPath = path.dirname(expandedPath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const writer = fs.createWriteStream(expandedPath);
      let downloaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        writer.write(Buffer.from(value));
        downloaded += value.length;

        if (total > 0) {
          event.sender.send('download-progress', {
            downloaded,
            total,
            progress: Math.round((downloaded / total) * 100)
          });
        }

        await new Promise(resolve => setImmediate(resolve));
      }

      writer.end();
      await new Promise<void>(resolve => writer.on('finish', resolve));

      logger.info('[Main] Download completed, size:', downloaded, 'bytes');
      return { success: true, filePath: expandedPath, size: downloaded };
    } catch (error) {
      logger.error('[Main] Download failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('download-audio-file', async (event, url: string, cookieString: string) => {
    try {
      logger.info('[Main] Starting streaming download from:', url.substring(0, 100) + '...');

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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        downloaded += value.length;
        chunkCount++;

        if (chunkCount % 50 === 0 && total > 0) {
          event.sender.send('download-progress', {
            downloaded,
            total,
            progress: Math.round((downloaded / total) * 100)
          });
        }

        if (chunkCount % 100 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }

      const allChunks = new Uint8Array(downloaded);
      let position = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
      }

      logger.info('[Main] Download completed, size:', downloaded, 'bytes');

      return {
        success: true,
        data: allChunks.buffer
      };
    } catch (error) {
      logger.error('[Main] Download failed:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

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
      logger.error('[Main] Select folder failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('save-file-to-path', async (_event, dirPath: string, fileName: string, fileData: ArrayBuffer) => {
    try {
      const expandedDir = expandHomeDir(dirPath);
      const fullPath = path.join(expandedDir, fileName);
      logger.info('[Main] Saving file to:', fullPath);

      if (!fs.existsSync(expandedDir)) {
        fs.mkdirSync(expandedDir, { recursive: true });
        logger.info('[Main] Created directory:', expandedDir);
      }

      const buffer = Buffer.from(fileData);
      fs.writeFileSync(fullPath, buffer);

      logger.info('[Main] File saved successfully, size:', buffer.length);
      return { success: true, filePath: fullPath };
    } catch (error) {
      logger.error('[Main] Save file failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}

export function registerMetadataHandlers(): void {
  ipcMain.handle('write-audio-metadata', async (_event, filePath: string, metadata: {
    title?: string;
    artist?: string;
    album?: string;
    lyrics?: string;
    coverUrl?: string;
  }) => {
    try {
      return await writeAudioMetadata(filePath, metadata);
    } catch (error) {
      logger.error('[Main] Write metadata failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('refresh-track-metadata', async (_event, filePath: string) => {
    try {
      const expandedPath = expandHomeDir(filePath);
      logger.info('[Main] Refreshing metadata for:', expandedPath);

      if (!fs.existsSync(expandedPath)) {
        return { success: false, error: '文件不存在' };
      }

      const fileData = fs.readFileSync(expandedPath);
      logger.info('[Main] File size:', fileData.length, 'bytes');

      const ext = path.extname(expandedPath).toLowerCase();
      const fileName = path.basename(expandedPath);
      let mimeType = 'audio/mpeg';
      if (ext === '.flac') {
        mimeType = 'audio/flac';
      } else if (ext === '.m4a' || ext === '.mp4') {
        mimeType = 'audio/mp4';
      }

      return {
        success: true,
        data: {
          fileName,
          mimeType,
          buffer: fileData.buffer
        }
      };
    } catch (error) {
      logger.error('[Main] Refresh metadata failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}

export function registerQQMusicHandlers(): void {
  ipcMain.handle('get-qq-music-url', async (_event, requestData: any, cookieString: string) => {
    try {
      logger.info('[Main] Getting QQ Music URL...');

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
      logger.info('[Main] Got QQ Music URL response, code:', data.code);

      return { success: true, data };
    } catch (error) {
      logger.error('[Main] Get QQ Music URL failed:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  ipcMain.handle('get-qq-music-lyrics', async (_event, songmid: string, cookieString: string) => {
    try {
      logger.info('[Main] Getting lyrics for:', songmid);

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
        logger.warn('[Main] Lyrics API returned error code:', result.code);
        return { success: false, error: `API error code: ${result.code}` };
      }

      const lyricBase64 = result.lyric;
      if (!lyricBase64) {
        return { success: false, error: 'No lyrics available' };
      }

      const lyrics = Buffer.from(lyricBase64, 'base64').toString('utf-8');
      logger.info('[Main] Lyrics fetched, length:', lyrics.length);

      return { success: true, lyrics };
    } catch (error) {
      logger.error('[Main] Get lyrics failed:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });
}