import { app } from 'electron';
import { logger } from './logger';
import { createWindow, setupAppLifecycle, getWindow } from './windowManager';
import { registerCoverProtocol } from './protocols/coverProtocol';
import { registerAudioProtocol } from './protocols/audioProtocol';
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
import { registerCleanupHandlers } from './cleanup-handler';
import { initUpdater, scheduleStartupCheck, registerVersionIpc } from './updater';

app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('log-level', '3');

registerCoverProtocol();
registerAudioProtocol();

app.whenReady().then(async () => {
  await createWindow();

  const win = getWindow();
  registerFileHandlers();
  registerLibraryHandlers();
  registerCoverHandlers();
  registerWindowControls(win);
  registerDownloadHandlers();
  registerMetadataHandlers();
  registerQQMusicHandlers();
  registerNetEaseHandlers();
  registerWebDAVHandlers();
  registerCleanupHandlers();
  registerNotificationHandlers();

  initUpdater();
  registerVersionIpc();
  scheduleStartupCheck(5000);

  logger.info('[Main] All IPC handlers registered');
});

setupAppLifecycle();