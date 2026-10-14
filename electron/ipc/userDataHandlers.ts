/**
 * IPC handlers for the user-owned portion of ~/.la/state.sqlite3.
 *
 * Separates non-rebuildable user data (track membership, play count, settings)
 * from rebuildable cache (metadata from audio file headers).
 */
import { ipcMain } from 'electron';
import { userDataStore } from '../services/userDataStore';
import { logger } from '../logger';
import { typedIpcSchemas, userDataSnapshotSchema } from './typedSchemas';
import { errorMessage, fail, ok, parsePayload } from './typedResult';

export function registerUserDataHandlers(): void {
  // Idempotently ensure the SQLite store and its one-time legacy import exist.
  userDataStore.migrateFromLegacy();

  ipcMain.handle('ipc:userData:load', () => {
    try {
      const parsed = userDataSnapshotSchema.safeParse(userDataStore.load());
      return parsed.success ? ok(parsed.data) : fail(parsed.error.message);
    } catch (error) {
      return fail(errorMessage(error));
    }
  });

  ipcMain.handle('ipc:userData:saveLibraryState', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.userDataLibraryState, payload);
    if (!parsed.ok) return parsed;
    try {
      return userDataStore.saveLibraryState(parsed.data.tracks, parsed.data.playback)
        ? ok(undefined)
        : fail('Failed to persist user library state');
    } catch (error) {
      return fail(errorMessage(error));
    }
  });

  logger.info('[UserDataHandlers] Registered typed channels, path:', userDataStore.getFilePath());
}
