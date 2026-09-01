import { app, dialog } from 'electron';
import { logger } from './logger';
import {
  createWindow,
  setupAppLifecycle,
  getWindow,
  resolveWindowsAppUserModelId,
} from './windowManager';
import { registerCoverProtocol } from './protocols/coverProtocol';
import { registerAudioProtocol } from './protocols/audioProtocol';
import { registerStreamProtocol } from './protocols/streamProtocol';
import { registerAllSchemes, registerAppProtocolHandler } from './protocols/appProtocol';
import { registerFileHandlers } from './ipc/fileHandlers';
import { registerLibraryHandlers } from './ipc/libraryHandlers';
import { registerCoverHandlers } from './ipc/coverHandlers';
import { registerWindowControls } from './ipc/windowHandlers';
import { registerDownloadHandlers } from './ipc/downloadHandlers';
import { registerMetadataHandlers } from './ipc/metadataHandlers';
import { registerQQMusicHandlers } from './ipc/qqMusicHandlers';
import { registerNotificationHandlers } from './ipc/notificationHandlers';
import { registerNetEaseHandlers } from './ipc/neteaseHandlers';
import { registerQQLoginHandlers } from './ipc/qqLoginHandlers';
import { registerTypedIpcHandlers } from './ipc/typedHandlers';
import { registerCleanupHandlers } from './cleanup-handler';
import { registerSettingsHandlers } from './ipc/settingsHandlers';
import { registerUserDataHandlers } from './ipc/userDataHandlers';
import { registerPersistenceHandlers } from './ipc/persistenceHandlers';
import { registerSystemLyricsHandlers } from './ipc/systemLyricsHandlers';
import { initUpdater, scheduleStartupCheck, registerVersionIpc } from './updater';
import { userStateRepository } from './services/userStateRepository';
import { SystemLyricsCoordinator } from './services/systemLyricsCoordinator';
import { configureDevelopmentProfile } from './developmentProfile';
import { repairWindowsShellIdentity } from './services/windowsShellIdentity';

const WINDOWS_SHELL_IDENTITY_SETTLE_MS = 1_000;

// Electron's single-instance lock and Chromium ProcessSingleton both live in
// userData. Isolate the development profile before either lock is acquired so
// an installed build can remain open while Vite launches Electron.
configureDevelopmentProfile(app);

app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('log-level', '3');

// Windows taskbar grouping and toast delivery are keyed by the AppUserModelID.
// Keep production identical to electron-builder's appId, but isolate development
// so electron.exe can never replace the installed app's icon in the shell cache.
if (process.platform === 'win32') {
  app.setAppUserModelId(resolveWindowsAppUserModelId(app.isPackaged));
}

// Force the custom schemes to be treated as secure contexts at the Chromium
// level. `registerSchemesAsPrivileged({ secure: true })` does not always
// propagate to the renderer's `--secure-schemes` switch in packaged builds
// (observed on Electron 42: only schemes that also carry `stream: true`
// survive into `--secure-schemes`). Without a secure context, Chromium
// silently ignores `backdrop-filter`, causing frosted-glass surfaces to render
// flat in the packaged app even though they work in dev
// (localhost is a "potentially trustworthy" secure context).
//
// Appending this switch explicitly is belt-and-braces: it guarantees the
// renderer sees `app,cover,audio,stream` in its secure-schemes list
// regardless of how Electron relays the privileged-scheme registration.
app.commandLine.appendSwitch('secure-schemes', 'app,cover,audio,stream');

// Register all custom schemes in one call (Electron only honours the first call).
registerAllSchemes();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  logger.warn(
    '[Main] Another instance already owns this profile; exiting this launch.',
  );
  app.quit();
}

const systemLyricsCoordinator = new SystemLyricsCoordinator(action => {
  const window = getWindow();
  if (!window || window.isDestroyed()) return;
  window.webContents.send('system-lyrics-action', action);
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  if (process.platform === 'win32' && app.isPackaged) {
    try {
      const shellIdentityRepair = repairWindowsShellIdentity();
      if (
        shellIdentityRepair.appShortcutUpdated
        || shellIdentityRepair.staleDevelopmentShortcutRemoved
      ) {
        logger.info('[WindowsIdentity] Start Menu shortcut identity is current.', {
          removedStaleDevelopmentShortcut:
            shellIdentityRepair.staleDevelopmentShortcutRemoved,
        });
        // Explorer updates AppUserModelID-to-icon associations asynchronously.
        // Let its Start Menu watcher observe the repair before the first HWND is
        // created; otherwise the first launch can retain electron.exe's icon.
        await new Promise<void>(resolve => {
          setTimeout(resolve, WINDOWS_SHELL_IDENTITY_SETTLE_MS);
        });
      }
    } catch (error) {
      logger.warn('[WindowsIdentity] Failed to repair Start Menu identity:', error);
    }
  }
  // User-owned settings/library membership live outside Chromium's replaceable
  // userData directory. Legacy JSON is imported transactionally on first run.
  userStateRepository.initialize();
  // Register the macOS status item eagerly so the music-note icon is visible
  // even before the first renderer update. A system lyrics failure must never
  // prevent the player itself from starting.
  try {
    systemLyricsCoordinator.initialize();
  } catch (error) {
    logger.warn('[SystemLyrics] Failed to initialize the system surface:', error);
  }
  // Register protocol handlers (must be after app is ready)
  await registerAppProtocolHandler();
  registerCoverProtocol();
  registerAudioProtocol();
  registerStreamProtocol();

  // Register ALL IPC handlers BEFORE creating the window,
  // so the renderer can call settings:getAll and other IPC
  // channels immediately on page load (appStorage.init() runs
  // at module import time in index.tsx).
  registerTypedIpcHandlers();
  registerFileHandlers();
  registerLibraryHandlers();
  registerCoverHandlers();
  registerDownloadHandlers();
  registerMetadataHandlers();
  registerQQMusicHandlers();
  registerNetEaseHandlers();
  registerQQLoginHandlers();
  registerCleanupHandlers();
  registerSettingsHandlers();
  registerUserDataHandlers();
  // Store initialization and legacy migrations above must finish before the
  // aggregate read facade can be called by the renderer.
  registerPersistenceHandlers();
  registerNotificationHandlers();
  registerSystemLyricsHandlers(systemLyricsCoordinator);

  await createWindow();

  const win = getWindow();
  registerWindowControls(win);  // needs window object

  initUpdater();
  registerVersionIpc();
  scheduleStartupCheck(5000);

  logger.info('[Main] All IPC handlers registered');
}).catch((error: unknown) => {
  // Never continue with an empty or half-migrated authority store. Legacy JSON
  // remains untouched, so the next launch can retry after the underlying
  // filesystem or safeStorage problem is resolved.
  const message = error instanceof Error ? error.message : String(error);
  logger.error('[Main] Failed to initialize user state:', error);
  dialog.showErrorBox(
    'LyricsAdapter could not start',
    `The user-state database could not be initialized. No legacy data was deleted.\n\n${message}`,
  );
  app.quit();
});

app.on('second-instance', () => {
  const window = getWindow();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

app.once('will-quit', () => {
  systemLyricsCoordinator.stop();
  userStateRepository.close();
});

setupAppLifecycle();
