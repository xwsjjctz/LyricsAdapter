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

export function registerSettingsHandlers(onChanged?: (keys: string[] | null) => void): void {
  settingsStore.initialize();

  const persist = (operation: () => boolean, keys: string[] | null) => {
    try {
      if (!operation()) return fail('Failed to persist settings');
      onChanged?.(keys);
      return ok(undefined);
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
    return persist(() => settingsStore.set(parsed.data.key, parsed.data.value), [parsed.data.key]);
  });

  ipcMain.handle('ipc:settings:setMany', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.settingsEntries, payload);
    if (!parsed.ok) return parsed;
    return persist(() => settingsStore.setMany(parsed.data.entries), Object.keys(parsed.data.entries));
  });

  ipcMain.handle('ipc:settings:delete', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.settingsGet, payload);
    if (!parsed.ok) return parsed;
    return persist(() => settingsStore.delete(parsed.data.key), [parsed.data.key]);
  });

  ipcMain.handle('ipc:settings:replaceAll', (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.settingsEntries, payload);
    if (!parsed.ok) return parsed;
    return persist(() => settingsStore.replaceAll(parsed.data.entries), null);
  });

  ipcMain.handle('settings:get', (_event, key: string): string | undefined => {
    return settingsStore.get(key);
  });

  ipcMain.handle('settings:getAll', (): Record<string, string> => {
    return settingsStore.getAll();
  });

  ipcMain.handle('settings:set', (_event, key: string, value: string): void => {
    if (settingsStore.set(key, value)) onChanged?.([key]);
  });

  ipcMain.handle('settings:setMany', (_event, entries: Record<string, string>): void => {
    if (settingsStore.setMany(entries)) onChanged?.(Object.keys(entries));
  });

  ipcMain.handle('settings:delete', (_event, key: string): void => {
    if (settingsStore.delete(key)) onChanged?.([key]);
  });

  ipcMain.handle('settings:replaceAll', (_event, entries: Record<string, string>): void => {
    if (settingsStore.replaceAll(entries)) onChanged?.(null);
  });

  logger.info('[SettingsHandlers] Registered typed + legacy channels (store path: ' + settingsStore.getDirectoryPath() + ')');
}
