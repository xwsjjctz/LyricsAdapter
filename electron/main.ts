import { app } from 'electron';
import { logger } from './logger';
import { createWindow, setupAppLifecycle, getWindow } from './windowManager';
import { registerCoverProtocol } from './protocols/coverProtocol';
import { registerAudioProtocol } from './protocols/audioProtocol';
import { registerStreamProtocol } from './protocols/streamProtocol';
import { registerAllSchemes, registerAppProtocolHandler } from './protocols/appProtocol';
import {
  registerFileHandlers,
  registerLibraryHandlers,
  registerCoverHandlers,
  registerWindowControls,
  registerDownloadHandlers,
  registerMetadataHandlers,
  registerQQMusicHandlers
} from './ipc/handlers';
import { registerNotificationHandlers } from './ipc/notificationHandlers';
import { registerWebDAVHandlers } from './ipc/webdavHandlers';
import { registerNetEaseHandlers } from './ipc/neteaseHandlers';
import { registerQQLoginHandlers } from './ipc/qqLoginHandlers';
import { registerTypedIpcHandlers } from './ipc/typedHandlers';
import { registerCleanupHandlers } from './cleanup-handler';
import { initUpdater, scheduleStartupCheck, registerVersionIpc } from './updater';

app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('log-level', '3');

// Force the custom schemes to be treated as secure contexts at the Chromium
// level. `registerSchemesAsPrivileged({ secure: true })` does not always
// propagate to the renderer's `--secure-schemes` switch in packaged builds
// (observed on Electron 42: only schemes that also carry `stream: true`
// survive into `--secure-schemes`). Without a secure context, Chromium
// silently ignores `backdrop-filter`, which is exactly why all New UI
// frosted-glass surfaces render flat in the packaged app but work in dev
// (localhost is a "potentially trustworthy" secure context).
//
// Appending this switch explicitly is belt-and-braces: it guarantees the
// renderer sees `app,cover,audio,stream` in its secure-schemes list
// regardless of how Electron relays the privileged-scheme registration.
app.commandLine.appendSwitch('secure-schemes', 'app,cover,audio,stream');

// Register all custom schemes in one call (Electron only honours the first call).
registerAllSchemes();

app.whenReady().then(async () => {
  // Register protocol handlers (must be after app is ready)
  await registerAppProtocolHandler();
  registerCoverProtocol();
  registerAudioProtocol();
  registerStreamProtocol();

  await createWindow();

  const win = getWindow();
  registerTypedIpcHandlers();
  registerFileHandlers();
  registerLibraryHandlers();
  registerCoverHandlers();
  registerWindowControls(win);
  registerDownloadHandlers();
  registerMetadataHandlers();
  registerQQMusicHandlers();
  registerNetEaseHandlers();
  registerQQLoginHandlers();
  registerWebDAVHandlers();
  registerCleanupHandlers();
  registerNotificationHandlers();

  initUpdater();
  registerVersionIpc();
  scheduleStartupCheck(5000);

  logger.info('[Main] All IPC handlers registered');
});

setupAppLifecycle();
