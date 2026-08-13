/**
 * IPC handlers for the file‑based settings store.
 *
 * Exposes get/set/setMany/getAll/delete/replaceAll operations on the main‑process
 * SQLite user state (~/.la/state.sqlite3). Sensitive fields are transparently
 * encrypted/decrypted via Electron safeStorage.
 *
 * Compatible with the unified origin (app://localhost) from Plan A.
 */
import { ipcMain } from 'electron';
import { settingsStore } from '../services/settingsStore';
import { logger } from '../logger';
import { typedIpcSchemas } from './typedSchemas';
import { errorMessage, fail, ok, parsePayload } from './typedResult';

export function registerSettingsHandlers(): void {
  settingsStore.initialize();

  const persist = (operation: () => boolean) => {
    try {
      return operation() ? ok(undefined) : fail('Failed to persist settings');
    } catch (error) {
      return fail(errorMessage(error));
    }
  };

  // Versioned typed surface. Keep the raw settings:* channels below during the
  // preload migration so older renderer bundles and dev HMR remain compatible.
  ipcMain.handle('ipc:settings:get', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.settingsGet, payload);
    if (!parsed.ok) return parsed;
    try {
      return ok(settingsStore.get(parsed.data.key));
    } catch (error) {
      return fail(errorMessage(error));
    }
  });

  ipcMain.handle('ipc:settings:getAll', () => {
    try {
      return ok(settingsStore.getAll());
    } catch (error) {
      return fail(errorMessage(error));
    }
  });

  ipcMain.handle('ipc:settings:set', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.settingsSet, payload);
    if (!parsed.ok) return parsed;
    return persist(() => settingsStore.set(parsed.data.key, parsed.data.value));
  });

  ipcMain.handle('ipc:settings:setMany', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.settingsEntries, payload);
    if (!parsed.ok) return parsed;
    return persist(() => settingsStore.setMany(parsed.data.entries));
  });

  ipcMain.handle('ipc:settings:delete', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.settingsGet, payload);
    if (!parsed.ok) return parsed;
    return persist(() => settingsStore.delete(parsed.data.key));
  });

  ipcMain.handle('ipc:settings:replaceAll', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.settingsEntries, payload);
    if (!parsed.ok) return parsed;
    return persist(() => settingsStore.replaceAll(parsed.data.entries));
  });

  ipcMain.handle('settings:get', (_event, key: string): string | undefined => {
    return settingsStore.get(key);
  });

  ipcMain.handle('settings:getAll', (): Record<string, string> => {
    return settingsStore.getAll();
  });

  ipcMain.handle('settings:set', (_event, key: string, value: string): void => {
    settingsStore.set(key, value);
  });

  ipcMain.handle('settings:setMany', (_event, entries: Record<string, string>): void => {
    settingsStore.setMany(entries);
  });

  ipcMain.handle('settings:delete', (_event, key: string): void => {
    settingsStore.delete(key);
  });

  ipcMain.handle('settings:replaceAll', (_event, entries: Record<string, string>): void => {
    settingsStore.replaceAll(entries);
  });

  logger.info('[SettingsHandlers] Registered typed + legacy channels (store path: ' + settingsStore.getDirectoryPath() + ')');
}
