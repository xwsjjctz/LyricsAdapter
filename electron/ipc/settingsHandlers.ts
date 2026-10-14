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

export function registerSettingsHandlers(onChanged?: (keys: string[] | null, senderId: number) => void): void {
  settingsStore.initialize();

  const persist = (operation: () => boolean, keys: string[] | null, senderId: number) => {
    try {
      if (!operation()) return fail('Failed to persist settings');
      onChanged?.(keys, senderId);
      return ok(undefined);
    } catch (error) {
      return fail(errorMessage(error));
    }
  };

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
    return persist(() => settingsStore.set(parsed.data.key, parsed.data.value), [parsed.data.key], _event.sender.id);
  });

  ipcMain.handle('ipc:settings:setMany', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.settingsEntries, payload);
    if (!parsed.ok) return parsed;
    return persist(() => settingsStore.setMany(parsed.data.entries), Object.keys(parsed.data.entries), _event.sender.id);
  });

  ipcMain.handle('ipc:settings:delete', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.settingsGet, payload);
    if (!parsed.ok) return parsed;
    return persist(() => settingsStore.delete(parsed.data.key), [parsed.data.key], _event.sender.id);
  });

  ipcMain.handle('ipc:settings:replaceAll', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.settingsEntries, payload);
    if (!parsed.ok) return parsed;
    return persist(() => settingsStore.replaceAll(parsed.data.entries), null, _event.sender.id);
  });

  logger.info('[SettingsHandlers] Registered typed channels (store path: ' + settingsStore.getDirectoryPath() + ')');
}
