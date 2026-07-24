import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { app } from "electron";
import { logger } from "../logger";
import { sanitizeFileName, expandHomeDir, validateSourcePath } from "../utils/fileUtils";
import { allowAudioPath, canReadAudioPath } from "./typedHandlers";
export function registerFileHandlers(): void {
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
        allowAudioPath(audioFilePath);
        logger.info('✅ Symlink created:', audioFilePath, '→', sourcePath);
        return { success: true, filePath: audioFilePath, method: 'symlink' };
      } catch (linkError) {
        logger.warn('⚠️ Symlink failed, copying file instead:', (linkError as Error).message);
        fs.copyFileSync(sourcePath, audioFilePath);
        allowAudioPath(audioFilePath);
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
      allowAudioPath(audioFilePath);

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
      const expandedPath = expandHomeDir(filePath);

      if (!canReadAudioPath(expandedPath)) {
        return { success: false, error: 'Audio path is outside the selected or app-managed allowlist' };
      }

      if (!fs.existsSync(expandedPath)) {
        logger.warn('⚠️ File does not exist, skipping deletion:', expandedPath);
        return { success: true, deleted: false };
      }

      fs.unlinkSync(expandedPath);
      logger.info('✅ File/symlink deleted:', expandedPath);
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

