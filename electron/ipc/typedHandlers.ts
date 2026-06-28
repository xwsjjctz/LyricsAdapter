import { app, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';
import { readArrayBufferWithLimit, validateWebDAVRangeResponse } from '../utils/webdavRange';
import { typedIpcSchemas } from './typedSchemas';
import type { IpcResult } from '../../types/typedIpc';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac']);
const selectedAudioPaths = new Set<string>();

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

function fail<T = never>(error: string): IpcResult<T> {
  return { ok: false, error };
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export function isAudioPath(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function resolveUserDataPath(...segments: string[]): string {
  return path.resolve(app.getPath('userData'), ...segments);
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function allowAudioPath(filePath: string): void {
  const resolved = path.resolve(filePath);
  if (isAudioPath(resolved)) {
    selectedAudioPaths.add(resolved);
  }
}

export function canReadAudioPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return isAudioPath(resolved) && (selectedAudioPaths.has(resolved) || isInside(resolveUserDataPath('audio'), resolved));
}

function libraryIndexPath(): string {
  return resolveUserDataPath('library-index.json');
}

function legacyLibraryPath(): string {
  return resolveUserDataPath('library.json');
}

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
    available: song.available ?? true,
  })) : [];
  return { songs, settings: library?.settings || {} };
}

function parsePayload<T>(schema: { safeParse: (payload: unknown) => { success: true; data: T } | { success: false; error: { message: string } } }, payload: unknown): IpcResult<T> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return fail(parsed.error.message);
  }
  return ok(parsed.data);
}

export function registerTypedIpcHandlers(): void {
  ipcMain.handle('ipc:file:selectAudio', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'flac', 'm4a', 'wav', 'ogg', 'aac'] },
      ],
    });

    for (const filePath of result.filePaths) {
      if (isAudioPath(filePath)) {
        allowAudioPath(filePath);
      }
    }

    return ok({ canceled: result.canceled, filePaths: result.filePaths.filter(isAudioPath) });
  });

  ipcMain.handle('ipc:file:readAudio', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.filePath, payload);
    if (!parsed.ok) return parsed;

    const filePath = path.resolve(parsed.data.filePath);
    if (!canReadAudioPath(filePath)) {
      return fail('Audio path is outside the selected or app-managed allowlist');
    }
    if (!isAudioPath(filePath)) {
      return fail('Only audio files can be read through ipc.file.readAudio');
    }
    if (!fs.existsSync(filePath)) {
      return fail('Audio file not found');
    }

    try {
      return ok({ data: toArrayBuffer(fs.readFileSync(filePath)) });
    } catch (error) {
      logger.error('[TypedIPC] readAudio failed:', error);
      return fail((error as Error).message);
    }
  });

  ipcMain.handle('ipc:file:allowAudioPath', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.filePath, payload);
    if (!parsed.ok) return parsed;

    if (!isAudioPath(parsed.data.filePath)) {
      return fail('Only audio paths can be added to the file allowlist');
    }
    allowAudioPath(parsed.data.filePath);
    return ok(undefined);
  });

  ipcMain.handle('ipc:library:loadIndex', async () => {
    try {
      const indexPath = libraryIndexPath();
      const legacyPath = legacyLibraryPath();

      if (fs.existsSync(indexPath)) {
        return ok(JSON.parse(fs.readFileSync(indexPath, 'utf-8')));
      }
      if (fs.existsSync(legacyPath)) {
        return ok(toLibraryIndex(JSON.parse(fs.readFileSync(legacyPath, 'utf-8'))));
      }
      return ok({ songs: [], settings: {} });
    } catch (error) {
      logger.error('[TypedIPC] load library failed:', error);
      return fail((error as Error).message);
    }
  });

  ipcMain.handle('ipc:library:saveIndex', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.library, payload);
    if (!parsed.ok) return parsed;

    try {
      const userDataPath = app.getPath('userData');
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
      fs.writeFileSync(libraryIndexPath(), JSON.stringify(parsed.data, null, 2), 'utf-8');
      return ok(undefined);
    } catch (error) {
      logger.error('[TypedIPC] save library failed:', error);
      return fail((error as Error).message);
    }
  });

  ipcMain.handle('ipc:webdav:propfind', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.webdavPropfind, payload);
    if (!parsed.ok) return parsed;

    try {
      const response = await fetch(parsed.data.url, {
        method: 'PROPFIND',
        headers: {
          Authorization: parsed.data.authHeader,
          Depth: parsed.data.depth,
          'Content-Type': 'application/xml; charset=utf-8',
        },
      });
      if (!response.ok && response.status !== 207) {
        return fail(`PROPFIND failed: ${response.status} ${response.statusText}`);
      }
      return ok({ xml: await response.text() });
    } catch (error) {
      logger.error('[TypedIPC] WebDAV PROPFIND failed:', error);
      return fail((error as Error).message);
    }
  });

  ipcMain.handle('ipc:webdav:getRange', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.webdavRange, payload);
    if (!parsed.ok) return parsed;

    try {
      const headers: Record<string, string> = {};
      if (parsed.data.authHeader) headers['Authorization'] = parsed.data.authHeader;
      if (parsed.data.start >= 0 && parsed.data.end >= 0) {
        headers['Range'] = `bytes=${parsed.data.start}-${parsed.data.end}`;
      }

      const response = await fetch(parsed.data.url, { method: 'GET', headers, redirect: 'follow' });
      const validation = validateWebDAVRangeResponse(
        response.status,
        response.headers.get('content-range'),
        response.headers.get('content-length'),
        parsed.data.start,
        parsed.data.end,
      );
      if (!validation.success) return fail(validation.error ?? 'Invalid range response');
      return ok({ data: await readArrayBufferWithLimit(response, validation.maxBytes) });
    } catch (error) {
      logger.error('[TypedIPC] WebDAV range failed:', error);
      return fail((error as Error).message);
    }
  });

  ipcMain.handle('ipc:webdav:put', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.webdavPut, payload);
    if (!parsed.ok) return parsed;

    try {
      const response = await fetch(parsed.data.url, {
        method: 'PUT',
        headers: {
          Authorization: parsed.data.authHeader,
          'Content-Type': parsed.data.contentType,
        },
        body: new Uint8Array(parsed.data.data),
      });
      return response.ok ? ok(undefined) : fail(`PUT failed: ${response.status} ${response.statusText}`);
    } catch (error) {
      logger.error('[TypedIPC] WebDAV PUT failed:', error);
      return fail((error as Error).message);
    }
  });

  ipcMain.handle('ipc:webdav:delete', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.webdavDelete, payload);
    if (!parsed.ok) return parsed;

    try {
      const response = await fetch(parsed.data.url, {
        method: 'DELETE',
        headers: { Authorization: parsed.data.authHeader },
      });
      return response.ok ? ok(undefined) : fail(`DELETE failed: ${response.status} ${response.statusText}`);
    } catch (error) {
      logger.error('[TypedIPC] WebDAV DELETE failed:', error);
      return fail((error as Error).message);
    }
  });

  ipcMain.handle('ipc:download:audio', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.downloadAudio, payload);
    if (!parsed.ok) return parsed;

    try {
      const response = await fetch(parsed.data.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          Referer: 'https://y.qq.com/',
          Cookie: parsed.data.cookieString,
        },
      });
      if (!response.ok) return fail(`HTTP error: ${response.status}`);
      return ok({ data: await response.arrayBuffer() });
    } catch (error) {
      logger.error('[TypedIPC] download audio failed:', error);
      return fail((error as Error).message);
    }
  });

  logger.info('[TypedIPC] handlers registered');
}
