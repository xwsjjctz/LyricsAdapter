import fs from "fs";
import { app } from "electron";
import { logger } from "../logger";
import { handleIpc } from './ipcMainTyped';
export function registerFileHandlers(): void {
  handleIpc('get-app-data-path', async () => {
    return app.getPath('userData');
  });

  handleIpc('validate-file-path', async (_event, filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  });

  handleIpc('validate-all-paths', async (_event, songs) => {
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

