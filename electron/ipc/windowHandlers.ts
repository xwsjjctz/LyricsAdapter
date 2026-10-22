import { BrowserWindow, nativeTheme, type IpcMainEvent } from "electron";
import { logger } from "../logger";
import { handleIpc, onIpc, sendIpc } from './ipcMainTyped';
import { getWindowsTitleBarOverlay, isWindowChromeAppearance } from '../../src/shared/windowsChrome';

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
      let unsubscribe = () => {};
      const finish = (saved: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
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
      unsubscribe = onIpc('window-before-close-flush-done', onFlushed);
      try {
        sendIpc(targetWindow.webContents, 'window-before-close-flush', requestId);
      } catch (error) {
        logger.warn('[Window] Failed to request renderer flush:', error);
        finish(false);
      }
    });
  };

  handleIpc('window-minimize', async () => {
    if (win) {
      win.minimize();
    }
  });

  handleIpc('window-maximize', async () => {
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  handleIpc('window-close', async (_event, alreadyFlushed = false) => {
    if (win) {
      if (alreadyFlushed === true) {
        closeAllowed = true;
      }
      win.close();
    }
  });

  handleIpc('window-is-maximized', async () => {
    if (win) {
      return win.isMaximized();
    }
    return false;
  });

  handleIpc('window-is-fullscreen', async () => {
    if (win) {
      return win.isFullScreen();
    }
    return false;
  });

  handleIpc('window-set-chrome-appearance', async (_event, appearance) => {
    if (process.platform !== 'win32' || !win || win.isDestroyed() || !isWindowChromeAppearance(appearance)) return;
    // Mica tints from the system light/dark mode; follow the app theme instead
    // so a dark theme on a light desktop does not sit on a pale backdrop.
    nativeTheme.themeSource = appearance.theme;
    try {
      win.setTitleBarOverlay(getWindowsTitleBarOverlay(appearance.captions));
    } catch (error) {
      logger.warn('[Window] Failed to update title bar overlay:', error);
    }
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
      if (win) sendIpc(win.webContents, 'fullscreen-changed', true);
    });
    win.on('leave-full-screen', () => {
      if (win) sendIpc(win.webContents, 'fullscreen-changed', false);
    });

    // macOS keeps backgroundThrottling off for the status-item lyric sampler,
    // so the page never sees itself hidden and its animations keep running.
    // Report minimize/hide directly so continuous animations can stop.
    let lastVisible = true;
    const reportVisibility = () => {
      if (!win || win.isDestroyed()) return;
      const visible = win.isVisible() && !win.isMinimized();
      if (visible === lastVisible) return;
      lastVisible = visible;
      sendIpc(win.webContents, 'window-visibility-changed', visible);
    };
    win.on('minimize', reportVisibility);
    win.on('restore', reportVisibility);
    win.on('hide', reportVisibility);
    win.on('show', reportVisibility);
  }

  return {
    prepareForUpdate: () => requestRendererFlush(false),
    cancelUpdatePreparation: () => { closeAllowed = false; },
  };
}
