import { logger } from '../../logger';
import type { IpcResult } from '../../../src/types/typedIpc';
import { readArrayBufferWithLimit, validateWebDAVRangeResponse } from '../../utils/webdavRange';

// Shared WebDAV business logic. Both the typed (`ipc:webdav:*`) and the legacy
// positional (`webdav-*`) IPC layers delegate here, so the fetch/validation/
// logging is defined exactly once. Each function returns an IpcResult; the
// legacy adapter merely reshapes it into `{ success, ... }` before returning
// to its callers.

/** Default timeout for metadata/listing requests (PROPFIND, GET-redirect). */
const WEBDAV_TIMEOUT_MS = 30_000;
/** Longer timeout for uploads — large FLAC files need room. */
const WEBDAV_UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Build an AbortSignal that fires after `ms`. Returns null when ms <= 0
 * (lets callers opt out per-request). Some WebDAV servers (notably 123pan)
 * hold a lock after an interrupted upload and never respond to subsequent
 * requests on that resource — without a timeout the fetch hangs forever
 * and the UI stays stuck on "importing".
 */
function timeoutSignal(ms: number): AbortSignal | null {
  if (ms <= 0) return null;
  return AbortSignal.timeout(ms);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export async function doWebdavPropfind(
  url: string,
  authHeader: string,
  depth: string,
): Promise<IpcResult<{ xml: string }>> {
  try {
    const response = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        Authorization: authHeader,
        Depth: depth,
        'Content-Type': 'application/xml; charset=utf-8',
      },
      signal: timeoutSignal(WEBDAV_TIMEOUT_MS),
    });

    if (!response.ok && response.status !== 207) {
      return { ok: false, error: `PROPFIND failed: ${response.status} ${response.statusText}` };
    }

    return { ok: true, data: { xml: await response.text() } };
  } catch (error) {
    if (isTimeoutError(error)) return { ok: false, error: 'PROPFIND timed out (server may have a stale lock)' };
    logger.error('[WebDAV] PROPFIND error:', error);
    return { ok: false, error: (error as Error).message };
  }
}

export async function doWebdavGetRedirect(
  url: string,
  authHeader: string,
): Promise<IpcResult<{ redirectUrl?: string; status: number }>> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader },
      redirect: 'manual',
      signal: timeoutSignal(WEBDAV_TIMEOUT_MS),
    });

    if (response.status === 302 || response.status === 301) {
      // Match the original legacy contract: a redirect status is "success"
      // even when the Location header is absent (redirectUrl then omitted).
      // Callers treat a missing redirectUrl as failure anyway, but preserving
      // the envelope avoids any downstream divergence.
      const location = response.headers.get('location');
      const data: { redirectUrl?: string; status: number } = { status: response.status };
      if (location) data.redirectUrl = location;
      return { ok: true, data };
    }

    if (response.status >= 200 && response.status < 300) {
      return { ok: false, error: 'No redirect, direct response received' };
    }

    return { ok: false, error: `Unexpected status: ${response.status}` };
  } catch (error) {
    if (isTimeoutError(error)) return { ok: false, error: 'GET redirect timed out' };
    logger.error('[WebDAV] GET redirect error:', error);
    return { ok: false, error: (error as Error).message };
  }
}

export async function doWebdavGetRange(
  url: string,
  authHeader: string,
  start: number,
  end: number,
): Promise<IpcResult<{ data: ArrayBuffer }>> {
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
      signal: timeoutSignal(WEBDAV_TIMEOUT_MS),
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
      return { ok: false, error: validation.error ?? 'Invalid range response' };
    }

    const arrayBuffer = await readArrayBufferWithLimit(response, validation.maxBytes);
    logger.info('[WebDAV IPC] Range fetch success:', url.substring(0, 80), 'range:', `${start}-${end}`, 'got', arrayBuffer.byteLength, 'bytes');
    return { ok: true, data: { data: arrayBuffer } };
  } catch (error) {
    if (isTimeoutError(error)) return { ok: false, error: 'Range fetch timed out' };
    logger.error('[WebDAV IPC] Range fetch error:', (error as Error).message, 'URL:', url.substring(0, 100));
    return { ok: false, error: (error as Error).message };
  }
}

export async function doWebdavPut(
  url: string,
  authHeader: string,
  data: ArrayBuffer,
  contentType: string,
): Promise<IpcResult<void>> {
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: authHeader,
        'Content-Type': contentType,
      },
      body: new Uint8Array(data),
      signal: timeoutSignal(WEBDAV_UPLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { ok: false, error: `PUT failed: ${response.status} ${response.statusText}` };
    }

    return { ok: true, data: undefined };
  } catch (error) {
    if (isTimeoutError(error)) return { ok: false, error: 'PUT timed out (server may have a stale lock — retry after a moment)' };
    logger.error('[WebDAV] PUT error:', error);
    return { ok: false, error: (error as Error).message };
  }
}

export async function doWebdavDelete(
  url: string,
  authHeader: string,
): Promise<IpcResult<void>> {
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: authHeader },
      signal: timeoutSignal(WEBDAV_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { ok: false, error: `DELETE failed: ${response.status} ${response.statusText}` };
    }

    return { ok: true, data: undefined };
  } catch (error) {
    if (isTimeoutError(error)) return { ok: false, error: 'DELETE timed out' };
    logger.error('[WebDAV] DELETE error:', error);
    return { ok: false, error: (error as Error).message };
  }
}

// MKCOL 创建集合（目录）。幂等：201 新建 / 2xx / 405(已存在) 均视为"目录就绪"。
// 用于上传前确保 /Metadata/ 存在——很多 WebDAV（含 123pan）在父目录缺失时 PUT 返回 409。
export async function doWebdavMkcol(
  url: string,
  authHeader: string,
): Promise<IpcResult<{ status: number }>> {
  try {
    const response = await fetch(url, {
      method: 'MKCOL',
      headers: { Authorization: authHeader },
      signal: timeoutSignal(WEBDAV_TIMEOUT_MS),
    });

    const status = response.status;
    if ((status >= 200 && status < 300) || status === 405) {
      return { ok: true, data: { status } };
    }
    return { ok: false, error: `MKCOL failed: ${status} ${response.statusText}` };
  } catch (error) {
    if (isTimeoutError(error)) return { ok: false, error: 'MKCOL timed out' };
    logger.error('[WebDAV] MKCOL error:', error);
    return { ok: false, error: (error as Error).message };
  }
}
