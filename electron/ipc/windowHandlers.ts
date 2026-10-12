import { ipcMain, BrowserWindow, type IpcMainEvent } from "electron";
import { logger } from "../logger";

interface WindowControls {
  prepareForUpdate: () => Promise<boolean>;
  cancelUpdatePreparation: () => void;
}

export function registerWindowControls(win: BrowserWindow | null): WindowControls {
  let closeAllowed = false;
  let closeInProgress = false;
  let nextFlushId = 0;

  const requestRendererFlush = (closeAfterFlush: boolean): Promise<boolean> => {
    if (!win || win.isDestroyed() || closeInProgress) return Promise.resolve(false);
    if (closeAllowed) return Promise.resolve(true);
    closeInProgress = true;
    const targetWindow = win;
    const requestId = ++nextFlushId;
    return new Promise(resolve => {
      let settled = false;
      const finish = (saved: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ipcMain.removeListener('window-before-close-flush-done', onFlushed);
        closeInProgress = false;
        // Ordinary close retains its existing best-effort policy. Updates require a successful save.
        closeAllowed = saved || closeAfterFlush;
        if (closeAfterFlush && !targetWindow.isDestroyed()) targetWindow.close();
        resolve(saved && !targetWindow.isDestroyed());
      };
      const onFlushed = (event: IpcMainEvent, saved: boolean, responseId: number) => {
        if (event.sender !== targetWindow.webContents || responseId !== requestId) return;
        if (saved !== true) logger.warn('[Window] Renderer close flush reported failure');
        finish(saved === true);
      };
      const timeout = setTimeout(() => {
        logger.warn('[Window] Renderer close flush timed out');
        finish(false);
      }, 3000);
      ipcMain.on('window-before-close-flush-done', onFlushed);
      try {
        targetWindow.webContents.send('window-before-close-flush', requestId);
      } catch (error) {
        logger.warn('[Window] Failed to request renderer flush:', error);
        finish(false);
      }
    });
  };

  ipcMain.handle('window-minimize', async () => {
    if (win) {
      win.minimize();
    }
  });

  ipcMain.handle('window-maximize', async () => {
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.handle('window-close', async (_event, alreadyFlushed = false) => {
    if (win) {
      if (alreadyFlushed === true) {
        closeAllowed = true;
      }
      win.close();
    }
  });

  ipcMain.handle('window-is-maximized', async () => {
    if (win) {
      return win.isMaximized();
    }
    return false;
  });

  ipcMain.handle('window-is-fullscreen', async () => {
    if (win) {
      return win.isFullScreen();
    }
    return false;
  });

  if (win) {
    win.on('close', (event) => {
      if (closeAllowed) return;
      event.preventDefault();
      void requestRendererFlush(true);
    });

    win.on('closed', () => {
      closeAllowed = false;
      closeInProgress = false;
    });

    win.on('enter-full-screen', () => {
      win?.webContents.send('fullscreen-changed', true);
    });
    win.on('leave-full-screen', () => {
      win?.webContents.send('fullscreen-changed', false);
    });
  }

  return {
    prepareForUpdate: () => requestRendererFlush(false),
    cancelUpdatePreparation: () => { closeAllowed = false; },
  };
}
