import { ipcMain } from 'electron';
import { logger } from '../logger';
import { readArrayBufferWithLimit, validateWebDAVRangeResponse } from '../utils/webdavRange';

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
      const headers: Record<string, string> = {};
      if (authHeader) {
        headers['Authorization'] = authHeader;
      }
      if (start >= 0 && end >= 0) {
        headers['Range'] = `bytes=${start}-${end}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
      });

      const validation = validateWebDAVRangeResponse(
        response.status,
        response.headers.get('content-range'),
        response.headers.get('content-length'),
        start,
        end,
      );
      if (!validation.success) {
        logger.error('[WebDAV IPC] Range fetch rejected:', validation.error, 'URL:', url.substring(0, 100));
        return { success: false, error: validation.error };
      }

      const arrayBuffer = await readArrayBufferWithLimit(response, validation.maxBytes);
      logger.info('[WebDAV IPC] Range fetch success:', url.substring(0, 80), 'range:', `${start}-${end}`, 'got', arrayBuffer.byteLength, 'bytes');
      return { success: true, data: arrayBuffer };
    } catch (e: any) {
      logger.error('[WebDAV IPC] Range fetch error:', e.message, 'URL:', url.substring(0, 100));
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('webdav-put', async (_event, url: string, authHeader: string, data: ArrayBuffer, contentType: string) => {
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': authHeader,
          'Content-Type': contentType,
        },
        body: new Uint8Array(data),
      });

      if (!response.ok) {
        return { success: false, error: `PUT failed: ${response.status} ${response.statusText}` };
      }

      return { success: true };
    } catch (e: any) {
      logger.error('[WebDAV] PUT error:', e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('webdav-delete', async (_event, url: string, authHeader: string) => {
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': authHeader,
        },
      });

      if (!response.ok) {
        return { success: false, error: `DELETE failed: ${response.status} ${response.statusText}` };
      }

      return { success: true };
    } catch (e: any) {
      logger.error('[WebDAV] DELETE error:', e);
      return { success: false, error: e.message };
    }
  });

  logger.info('[WebDAV] IPC handlers registered');
}
