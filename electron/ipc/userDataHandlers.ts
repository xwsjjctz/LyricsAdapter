/**
 * IPC handlers for ~/.la/users.json (pure user data store).
 *
 * Separates non-rebuildable user data (track membership, play count, settings)
 * from rebuildable cache (metadata from audio file headers).
 */
import { ipcMain } from 'electron';
import { userDataStore, UserDataFile, UserTrackRecord } from '../services/userDataStore';
import { logger } from '../logger';

export function registerUserDataHandlers(): void {
  // 首次迁移：从 settings.json / library-index.json 汇入 users.json
  userDataStore.migrateFromLegacy();

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

  logger.info('[UserDataHandlers] Registered, path:', userDataStore.getFilePath());
}
