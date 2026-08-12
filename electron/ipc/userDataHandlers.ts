/**
 * IPC handlers for ~/.la/users.json (pure user data store).
 *
 * Separates non-rebuildable user data (track membership, play count, settings)
 * from rebuildable cache (metadata from audio file headers).
 */
import { ipcMain } from 'electron';
import { userDataStore, UserDataFile, UserTrackRecord } from '../services/userDataStore';
import { logger } from '../logger';
import { typedIpcSchemas, userDataSnapshotSchema } from './typedSchemas';
import { errorMessage, fail, ok, parsePayload } from './typedResult';
import { settingsStore } from '../services/settingsStore';
import { filterPublicSettings } from '../../src/shared/persistencePolicy';

export function registerUserDataHandlers(): void {
  // 首次迁移：从 settings.json / library-index.json 汇入 users.json
  userDataStore.migrateFromLegacy();

  // Versioned typed surface. Legacy userData:* channels stay raw until all
  // external tooling and older preload bundles have migrated.
  ipcMain.handle('ipc:userData:load', () => {
    try {
      const parsed = userDataSnapshotSchema.safeParse(userDataStore.load());
      return parsed.success ? ok(parsed.data) : fail(parsed.error.message);
    } catch (error) {
      return fail(errorMessage(error));
    }
  });

  ipcMain.handle('ipc:userData:save', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.userDataSave, payload);
    if (!parsed.ok) return parsed;
    try {
      return userDataStore.save(parsed.data.data)
        ? ok(undefined)
        : fail('Failed to persist user data');
    } catch (error) {
      return fail(errorMessage(error));
    }
  });

  ipcMain.handle('ipc:userData:saveTracks', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.userDataTracks, payload);
    if (!parsed.ok) return parsed;
    try {
      return userDataStore.saveTracks(parsed.data.tracks)
        ? ok(undefined)
        : fail('Failed to persist user tracks');
    } catch (error) {
      return fail(errorMessage(error));
    }
  });

  ipcMain.handle('ipc:userData:saveLibraryState', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.userDataLibraryState, payload);
    if (!parsed.ok) return parsed;
    try {
      const settings = filterPublicSettings(settingsStore.getAll());
      return userDataStore.saveLibraryState(parsed.data.tracks, parsed.data.playback, settings)
        ? ok(undefined)
        : fail('Failed to persist user library state');
    } catch (error) {
      return fail(errorMessage(error));
    }
  });

  ipcMain.handle('ipc:userData:getFilePath', () => ok(userDataStore.getFilePath()));

  ipcMain.handle('userData:load', (): UserDataFile => {
    return userDataStore.load();
  });

  ipcMain.handle('userData:save', (_event, data: UserDataFile): void => {
    userDataStore.save(data);
  });

  ipcMain.handle('userData:saveTracks', (_event, tracks: UserTrackRecord[]): void => {
    userDataStore.saveTracks(tracks);
  });

  ipcMain.handle('userData:getFilePath', (): string => {
    return userDataStore.getFilePath();
  });

  logger.info('[UserDataHandlers] Registered typed + legacy channels, path:', userDataStore.getFilePath());
}
