import { app, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';
import { typedIpcSchemas } from './typedSchemas';
import { doLoadLibraryIndex, doSaveLibraryIndex } from '../services/libraryIndexFiles';
import { fail, ok, parsePayload } from './typedResult';
import {
  doWebdavDelete,
  doWebdavGetRange,
  doWebdavGetRedirect,
  doWebdavMkcol,
  doWebdavPropfind,
  doWebdavPut,
} from './core/webdavCore';
import { handleIpc } from './ipcMainTyped';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac']);
const selectedAudioPaths = new Set<string>();

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

export function registerTypedIpcHandlers(): void {
  handleIpc('ipc:file:selectAudio', async () => {
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

  handleIpc('ipc:file:readAudio', async (_event, payload: unknown) => {
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

  handleIpc('ipc:file:allowAudioPath', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.filePath, payload);
    if (!parsed.ok) return parsed;

    if (!isAudioPath(parsed.data.filePath)) {
      return fail('Only audio paths can be added to the file allowlist');
    }
    allowAudioPath(parsed.data.filePath);
    return ok(undefined);
  });

  handleIpc('ipc:library:loadIndex', async () => {
    return doLoadLibraryIndex();
  });

  handleIpc('ipc:library:saveIndex', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.library, payload);
    if (!parsed.ok) return parsed;
    return doSaveLibraryIndex(parsed.data);
  });

  handleIpc('ipc:webdav:propfind', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.webdavPropfind, payload);
    if (!parsed.ok) return parsed;
    return doWebdavPropfind(parsed.data.url, parsed.data.authHeader, parsed.data.depth);
  });

  handleIpc('ipc:webdav:getRange', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.webdavRange, payload);
    if (!parsed.ok) return parsed;
    return doWebdavGetRange(parsed.data.url, parsed.data.authHeader, parsed.data.start, parsed.data.end);
  });

  handleIpc('ipc:webdav:put', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.webdavPut, payload);
    if (!parsed.ok) return parsed;
    return doWebdavPut(parsed.data.url, parsed.data.authHeader, parsed.data.data, parsed.data.contentType);
  });

  handleIpc('ipc:webdav:delete', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.webdavDelete, payload);
    if (!parsed.ok) return parsed;
    return doWebdavDelete(parsed.data.url, parsed.data.authHeader);
  });

  handleIpc('ipc:webdav:getRedirect', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.webdavGetRedirect, payload);
    if (!parsed.ok) return parsed;
    return doWebdavGetRedirect(parsed.data.url, parsed.data.authHeader);
  });

  handleIpc('ipc:webdav:mkcol', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.webdavMkcol, payload);
    if (!parsed.ok) return parsed;
    return doWebdavMkcol(parsed.data.url, parsed.data.authHeader);
  });

  logger.info('[TypedIPC] handlers registered');
}
