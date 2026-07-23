import { ipcMain } from 'electron';
import { logger } from '../logger';
import {
  doWebdavDelete,
  doWebdavGetRange,
  doWebdavGetRedirect,
  doWebdavMkcol,
  doWebdavPropfind,
  doWebdavPut,
} from './core/webdavCore';

// Legacy positional WebDAV IPC channels. The business logic lives in
// ./core/webdavCore (shared with the typed `ipc:webdav:*` layer); this module
// only reshapes each IpcResult into the legacy `{ success, ... }` envelope.

export function registerWebDAVHandlers(): void {

  ipcMain.handle('webdav-propfind', async (_event, url: string, authHeader: string, depth: string) => {
    const r = await doWebdavPropfind(url, authHeader, depth);
    return r.ok ? { success: true, xml: r.data.xml } : { success: false, error: r.error };
  });

  ipcMain.handle('webdav-get-redirect', async (_event, url: string, authHeader: string) => {
    const r = await doWebdavGetRedirect(url, authHeader);
    return r.ok ? { success: true, redirectUrl: r.data.redirectUrl } : { success: false, error: r.error };
  });

  ipcMain.handle('webdav-get-range', async (_event, url: string, authHeader: string, start: number, end: number) => {
    const r = await doWebdavGetRange(url, authHeader, start, end);
    return r.ok ? { success: true, data: r.data.data } : { success: false, error: r.error };
  });

  ipcMain.handle('webdav-put', async (_event, url: string, authHeader: string, data: ArrayBuffer, contentType: string) => {
    const r = await doWebdavPut(url, authHeader, data, contentType);
    return r.ok ? { success: true } : { success: false, error: r.error };
  });

  ipcMain.handle('webdav-delete', async (_event, url: string, authHeader: string) => {
    const r = await doWebdavDelete(url, authHeader);
    return r.ok ? { success: true } : { success: false, error: r.error };
  });

  // MKCOL 创建集合（目录）。幂等：201 新建 / 2xx / 405(已存在) 均视为"目录就绪"。
  // 用于上传前确保 /Metadata/ 存在——很多 WebDAV（含 123pan）在父目录缺失时 PUT 返回 409。
  ipcMain.handle('webdav-mkcol', async (_event, url: string, authHeader: string) => {
    const r = await doWebdavMkcol(url, authHeader);
    return r.ok ? { success: true, status: r.data.status } : { success: false, error: r.error };
  });

  logger.info('[WebDAV] IPC handlers registered');
}
