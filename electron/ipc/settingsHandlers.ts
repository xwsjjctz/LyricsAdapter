/**
 * IPC handlers for the file‑based settings store.
 *
 * Exposes get/set/getAll/delete operations on the main‑process settings.json
 * so the renderer can persist UI settings, WebDAV credentials, theme,
 * language, shortcuts etc. without relying on localStorage (which is per‑origin
 * and can be cleared by the user).
 *
 * Compatible with the unified origin (app://localhost) from Plan A.
 */
import { ipcMain } from 'electron';
import { settingsStore } from '../services/settingsStore';
import { logger } from '../logger';

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', (_event, key: string): string | undefined => {
    return settingsStore.get(key);
  });

  ipcMain.handle('settings:getAll', (): Record<string, string> => {
    return settingsStore.getAll();
  });

  ipcMain.handle('settings:set', (_event, key: string, value: string): void => {
    settingsStore.set(key, value);
  });

  ipcMain.handle('settings:delete', (_event, key: string): void => {
    settingsStore.delete(key);
  });

  ipcMain.handle('settings:replaceAll', (_event, entries: Record<string, string>): void => {
    settingsStore.replaceAll(entries);
  });

  logger.info('[SettingsHandlers] Registered');
}
