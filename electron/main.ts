import { app } from 'electron';
import { logger } from './logger';
import { createWindow, setupAppLifecycle, getWindow } from './windowManager';
import { registerCoverProtocol } from './protocols/coverProtocol';
import {
  registerFileHandlers,
  registerLibraryHandlers,
  registerCoverHandlers,
  registerWindowControls,
  registerDownloadHandlers,
  registerMetadataHandlers,
  registerQQMusicHandlers
} from './ipc/handlers';

app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('log-level', '3');

registerCoverProtocol();

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

  logger.info('[Main] All IPC handlers registered');
});

setupAppLifecycle();