import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { app } from "electron";
import { logger } from "../logger";
import { sanitizeTrackId, coverExtFromMime } from "../utils/fileUtils";
import { computeWebdavCoverId } from "../utils/webdavCoverId";
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

  // 清理孤儿封面文件：删除 covers/ 目录中不属于 activeTrackIds 的文件。
  // WebDAV 封面文件名是 `${pathHash}-${webdavPath}`（见 computeWebdavCoverId），与 trackId 的
  // `webdav-` 字面前缀不同，活跃集必须把这两种命名都纳入，否则会把所有 WebDAV 封面误判为孤儿删除。
  // 删除后返回剩余封面的 stem（existingCoverIds），供渲染端校验 coverUrl 是否仍指向真实文件。
  ipcMain.handle('cleanup-orphan-covers', async (_event, activeTrackIds: string[]) => {
    try {
      const userDataPath = app.getPath('userData');
      const coverDir = path.join(userDataPath, 'covers');

      if (!fs.existsSync(coverDir)) {
        return { success: true, removed: 0, errors: 0, existingCoverIds: [] as string[] };
      }

      // 活跃集同时收录两种命名：local track 的 trackId，以及 cloud track 的封面文件 id。
      const activeSet = new Set<string>();
      for (const id of activeTrackIds) {
        activeSet.add(sanitizeTrackId(id));
        const coverId = computeWebdavCoverId(id);
        if (coverId) activeSet.add(coverId);
      }

      const exts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
      let removed = 0;
      let errors = 0;
      const existingCoverIds: string[] = [];

      const files = fs.readdirSync(coverDir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!exts.has(ext)) continue;

        const trackId = path.basename(file, ext);
        if (!activeSet.has(trackId)) {
          try {
            fs.unlinkSync(path.join(coverDir, file));
            removed++;
          } catch (e) {
            errors++;
            logger.warn(`[Cleanup] Failed to delete orphan cover: ${file}`, e);
          }
        } else {
          // 保留的封面：暴露 stem，供渲染端校验 IndexedDB 里的 coverUrl 是否仍指向真实文件
          existingCoverIds.push(trackId);
        }
      }

      logger.info(`[Cleanup] Orphan covers cleanup: ${removed} removed, ${errors} errors, ${existingCoverIds.length} kept`);
      return { success: true, removed, errors, existingCoverIds };
    } catch (error) {
      logger.error('[Cleanup] Failed to cleanup orphan covers:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}

