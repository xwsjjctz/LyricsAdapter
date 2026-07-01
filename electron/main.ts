import { app } from 'electron';
import { logger } from './logger';
import { createWindow, setupAppLifecycle, getWindow } from './windowManager';
import { registerCoverProtocol } from './protocols/coverProtocol';
import { registerAudioProtocol } from './protocols/audioProtocol';
import { registerStreamProtocol } from './protocols/streamProtocol';
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

registerCoverProtocol();
registerAudioProtocol();
registerStreamProtocol();

app.whenReady().then(async () => {
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
