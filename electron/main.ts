import { app } from 'electron';
import { logger } from './logger';
import { createWindow, setupAppLifecycle, getWindow } from './windowManager';
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
import { registerWebDAVHandlers } from './ipc/webdavHandlers';
import { registerNetEaseHandlers } from './ipc/neteaseHandlers';
import { registerSodaHandlers } from './ipc/sodaHandlers';
import { registerQQLoginHandlers } from './ipc/qqLoginHandlers';
import { registerTypedIpcHandlers } from './ipc/typedHandlers';
import { registerCleanupHandlers } from './cleanup-handler';
import { registerSettingsHandlers } from './ipc/settingsHandlers';
import { registerUserDataHandlers } from './ipc/userDataHandlers';
import { initUpdater, scheduleStartupCheck, registerVersionIpc } from './updater';
import { registerCdnHeaderInjection } from './cdnHeaders';

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
  // 给已知 CDN（QQ gtimg.cn 等）的出站请求补 Referer，
  // 海外网络下浏览器发的 <img> 请求默认带 app:// origin 会导致 404。
  // 必须在 protocol handlers 之前，确保后续请求也走同一 session。
  registerCdnHeaderInjection();

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
  registerSodaHandlers();
  registerQQLoginHandlers();
  registerWebDAVHandlers();
  registerCleanupHandlers();
  registerSettingsHandlers();
  registerUserDataHandlers();
  registerNotificationHandlers();

  await createWindow();

  const win = getWindow();
  registerWindowControls(win);  // needs window object

  initUpdater();
  registerVersionIpc();
  scheduleStartupCheck(5000);

  logger.info('[Main] All IPC handlers registered');
});

setupAppLifecycle();
