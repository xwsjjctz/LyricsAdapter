import { ipcMain, BrowserWindow } from "electron";
import { logger } from "../logger";
export function registerWindowControls(win: BrowserWindow | null): void {
  let closeAllowed = false;
  let closeInProgress = false;

  const requestRendererFlushBeforeClose = () => {
    if (!win || closeAllowed || closeInProgress) return;
    closeInProgress = true;

    const targetWindow = win;
    const timeout = setTimeout(() => {
      logger.warn('[Window] Renderer close flush timed out; closing window');
      closeAllowed = true;
      closeInProgress = false;
      if (!targetWindow.isDestroyed()) {
        targetWindow.close();
      }
    }, 3000);

    ipcMain.once('window-before-close-flush-done', (_event, saved: boolean) => {
      clearTimeout(timeout);
      closeInProgress = false;

      if (saved === false) {
        logger.warn('[Window] Renderer close flush reported failure; closing anyway');
      }

      closeAllowed = true;
      if (!targetWindow.isDestroyed()) {
        targetWindow.close();
      }
    });

    targetWindow.webContents.send('window-before-close-flush');
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

  ipcMain.handle('window-close', async () => {
    if (win) {
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
      requestRendererFlushBeforeClose();
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
}

