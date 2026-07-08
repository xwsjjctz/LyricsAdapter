import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { app } from "electron";
import { logger } from "../logger";
import { writeJsonAtomic } from "../utils/atomicWrite";
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

      writeJsonAtomic(libraryPath, library);

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

      writeJsonAtomic(indexPath, library);
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

      writeJsonAtomic(backupPath, library);

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

