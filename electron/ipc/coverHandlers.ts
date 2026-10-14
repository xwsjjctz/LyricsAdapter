import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { app } from "electron";
import { logger } from "../logger";
import { sanitizeTrackId, coverExtFromMime } from "../utils/fileUtils";
import {
  invalidateCoverThumbnails,
  pruneOrphanCoverThumbnails,
  writeFileAtomically,
} from "../protocols/coverProtocol";
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
      if (buffer.length === 0) {
        return { success: false, error: 'Invalid cover data' };
      }

      // Invalidate first: a permission failure must leave the old source in
      // place instead of reporting failure after partially changing state.
      invalidateCoverThumbnails(coverPath);
      writeFileAtomically(coverPath, buffer);

      const version = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      const coverUrl = `cover://${safeId}.${ext}?v=${version}`;
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
        // Also remove stale derived files when the source has already gone.
        invalidateCoverThumbnails(coverPath);
        if (fs.existsSync(coverPath)) {
          fs.unlinkSync(coverPath);
          deleted = true;
        }
      }

      if (fs.existsSync(coverDir)) {
        pruneOrphanCoverThumbnails(coverDir);
      }

      return { success: true, deleted };
    } catch (error) {
      logger.error('Failed to delete cover thumbnail:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}
