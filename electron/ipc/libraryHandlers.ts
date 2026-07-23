import { ipcMain } from "electron";
import {
  doLoadLocalBackup,
  doSaveLocalBackup,
} from "./core/libraryCore";

// Legacy positional library IPC channels still in use. load/save index moved
// to the typed `ipc:library:*` layer; only the local-backup channels remain
// here (no typed equivalent yet).

export function registerLibraryHandlers(): void {
  ipcMain.handle('save-local-library-backup', async (_event, library) => {
    const r = await doSaveLocalBackup(library);
    return r.ok ? { success: true } : { success: false, error: r.error };
  });

  ipcMain.handle('load-local-library-backup', async () => {
    const r = await doLoadLocalBackup();
    return r.ok ? { success: true, library: r.data } : { success: false, error: r.error };
  });
}
