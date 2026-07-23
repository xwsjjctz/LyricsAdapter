import { ipcMain } from "electron";
import {
  doLoadLegacyLibrary,
  doLoadLibraryIndex,
  doLoadLocalBackup,
  doSaveLegacyLibrary,
  doSaveLibraryIndex,
  doSaveLocalBackup,
} from "./core/libraryCore";

// Legacy positional library IPC channels. The business logic lives in
// ./core/libraryCore (shared with the typed `ipc:library:*` layer); this module
// only reshapes each IpcResult into the legacy `{ success, ... }` envelope.

export function registerLibraryHandlers(): void {
  ipcMain.handle('load-library', async () => {
    const r = await doLoadLegacyLibrary();
    return r.ok ? { success: true, library: r.data } : { success: false, error: r.error };
  });

  ipcMain.handle('load-library-index', async () => {
    const r = await doLoadLibraryIndex();
    return r.ok ? { success: true, library: r.data } : { success: false, error: r.error };
  });

  ipcMain.handle('save-library', async (_event, library) => {
    const r = await doSaveLegacyLibrary(library);
    return r.ok ? { success: true } : { success: false, error: r.error };
  });

  ipcMain.handle('save-library-index', async (_event, library) => {
    const r = await doSaveLibraryIndex(library);
    return r.ok ? { success: true } : { success: false, error: r.error };
  });

  ipcMain.handle('save-local-library-backup', async (_event, library) => {
    const r = await doSaveLocalBackup(library);
    return r.ok ? { success: true } : { success: false, error: r.error };
  });

  ipcMain.handle('load-local-library-backup', async () => {
    const r = await doLoadLocalBackup();
    return r.ok ? { success: true, library: r.data } : { success: false, error: r.error };
  });
}
