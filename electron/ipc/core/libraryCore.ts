import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { logger } from '../../logger';
import { writeJsonAtomic } from '../../utils/atomicWrite';
import type { IpcResult } from '../../../src/types/typedIpc';

// Shared library persistence logic. Both the typed (`ipc:library:*`) and the
// legacy positional (`load-library*` / `save-library*`) IPC layers delegate
// here, so the on-disk format and the legacy `library.json` → `library-index.json`
// migration are defined exactly once.

export function resolveUserDataPath(...segments: string[]): string {
  return path.resolve(app.getPath('userData'), ...segments);
}

export function libraryIndexPath(): string {
  return resolveUserDataPath('library-index.json');
}

export function legacyLibraryPath(): string {
  return resolveUserDataPath('library.json');
}

export function localBackupPath(): string {
  return resolveUserDataPath('library-local-backup.json');
}

// Migrate the legacy `library.json` shape into the `library-index.json` shape:
// normalises each song record, drops blob:/data: cover URLs, and ensures
// settings exist. Defined once here so both IPC layers agree on the mapping.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toLibraryIndex(library: any): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export async function doLoadLibraryIndex(): Promise<IpcResult<unknown>> {
  try {
    const indexPath = libraryIndexPath();
    const legacyPath = legacyLibraryPath();

    if (fs.existsSync(indexPath)) {
      return { ok: true, data: JSON.parse(fs.readFileSync(indexPath, 'utf-8')) };
    }
    if (fs.existsSync(legacyPath)) {
      return { ok: true, data: toLibraryIndex(JSON.parse(fs.readFileSync(legacyPath, 'utf-8'))) };
    }
    return { ok: true, data: { songs: [], settings: {} } };
  } catch (error) {
    logger.error('[Library] load library index failed:', error);
    return { ok: false, error: (error as Error).message };
  }
}

export async function doSaveLibraryIndex(library: unknown): Promise<IpcResult<void>> {
  try {
    writeJsonAtomic(libraryIndexPath(), library);
    return { ok: true, data: undefined };
  } catch (error) {
    logger.error('[Library] save library index failed:', error);
    return { ok: false, error: (error as Error).message };
  }
}

export async function doSaveLocalBackup(library: unknown): Promise<IpcResult<void>> {
  try {
    writeJsonAtomic(localBackupPath(), library);
    logger.info('[IPC] Local library backup saved');
    return { ok: true, data: undefined };
  } catch (error) {
    logger.error('[Library] save local backup failed:', error);
    return { ok: false, error: (error as Error).message };
  }
}

export async function doLoadLocalBackup(): Promise<IpcResult<unknown>> {
  try {
    const backupPath = localBackupPath();
    if (fs.existsSync(backupPath)) {
      const library = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
      logger.info('[IPC] Local library backup loaded');
      return { ok: true, data: library };
    }
    return { ok: true, data: null };
  } catch (error) {
    logger.error('[Library] load local backup failed:', error);
    return { ok: false, error: (error as Error).message };
  }
}
