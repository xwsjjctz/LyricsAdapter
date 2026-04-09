import { ipcMain } from 'electron';
import { logger } from '../logger';

export function registerWebDAVHandlers(): void {

  ipcMain.handle('webdav-propfind', async (_event, url: string, authHeader: string, depth: string) => {
    try {
      const response = await fetch(url, {
        method: 'PROPFIND',
        headers: {
          'Authorization': authHeader,
          'Depth': depth,
          'Content-Type': 'application/xml; charset=utf-8',
        },
      });

      if (!response.ok && response.status !== 207) {
        return { success: false, error: `PROPFIND failed: ${response.status} ${response.statusText}` };
      }

      const xml = await response.text();
      return { success: true, xml };
    } catch (e: any) {
      logger.error('[WebDAV] PROPFIND error:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('webdav-get-redirect', async (_event, url: string, authHeader: string) => {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
        },
        redirect: 'manual',
      });

      if (response.status === 302 || response.status === 301) {
        const redirectUrl = response.headers.get('location');
        return { success: true, redirectUrl };
      }

      if (response.status >= 200 && response.status < 300) {
        return { success: false, error: 'No redirect, direct response received' };
      }

      return { success: false, error: `Unexpected status: ${response.status}` };
    } catch (e: any) {
      logger.error('[WebDAV] GET redirect error:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('webdav-get-range', async (_event, url: string, authHeader: string, start: number, end: number) => {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Range': `bytes=${start}-${end}`,
        },
        redirect: 'follow',
      });

      if (!response.ok && response.status !== 206) {
        return { success: false, error: `Range fetch failed: ${response.status}` };
      }

      const arrayBuffer = await response.arrayBuffer();
      return { success: true, data: arrayBuffer };
    } catch (e: any) {
      logger.error('[WebDAV] Range fetch error:', e);
      return { success: false, error: e.message };
    }
  });

  logger.info('[WebDAV] IPC handlers registered');
}
