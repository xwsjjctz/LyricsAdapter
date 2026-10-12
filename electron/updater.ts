import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { logger } from './logger';
import { getUpdaterUnavailableReason, type UpdaterUnavailableReason } from './services/updaterAvailability';

/**
 * 主进程自动更新模块（electron-updater + GitHub Releases）。
 *
 * 支持 Windows NSIS 和 Developer ID 签名的 macOS 包。
 * 开发版、未签名/临时签名包及没有更新配置的包均不检查更新。
 * 注意：electron-updater 仅在真打包构建里工作（npm run electron:dev 下会被跳过）。
 */

// 镜像渲染侧 services/desktopAdapter.ts 的 UpdaterState。
// 主进程发送、渲染进程接收，两边结构需手动保持一致。
export type UpdaterState =
  | { status: 'unavailable'; reason: UpdaterUnavailableReason }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'not-available' }
  | { status: 'available'; info: UpdateInfo }
  | { status: 'downloading'; info: UpdateInfo; progress: ProgressInfo | null }
  | { status: 'downloaded'; info: UpdateInfo }
  | { status: 'error'; message: string };

const UPDATER_CHANNEL = 'updater-event';
let unavailableReason: UpdaterUnavailableReason | null = 'dev';

let startupCheckDone = false;
// 设置页晚于启动检查挂载，需要能读到已经发生的状态。
let currentState: UpdaterState = { status: 'unavailable', reason: 'dev' };
// download-progress 事件 payload 不含 UpdateInfo，需在 update-available 时缓存。
let lastInfo: UpdateInfo | null = null;
let pendingMacInfo: UpdateInfo | null = null;
let installInProgress = false;

function send(state: UpdaterState): void {
  currentState = state;
  // macOS settings live in a separate renderer, which needs the same live progress.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(UPDATER_CHANNEL, state);
    }
  }
  logger.info(`[Updater] status=${state.status}`);
}

function registerUpdaterIpc(prepareToInstall: () => Promise<boolean>, cancelInstall: () => void): void {
  ipcMain.handle('updater:state', (): UpdaterState => currentState);

  ipcMain.handle('updater:check', async (): Promise<{ ok: boolean; reason?: string }> => {
    if (unavailableReason || installInProgress) {
      return { ok: false, reason: unavailableReason ?? 'installing' };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (e) {
      logger.error('[Updater] check failed:', e);
      const message = e instanceof Error ? e.message : String(e);
      send({ status: 'error', message });
      return { ok: false, reason: message };
    }
  });

  ipcMain.handle('updater:quit-and-install', async (): Promise<{ ok: boolean }> => {
    if (unavailableReason || currentState.status !== 'downloaded' || installInProgress) {
      return { ok: false };
    }
    installInProgress = true;
    try {
      // Squirrel closes windows before before-quit. Finish the renderer save handshake first.
      if (!await prepareToInstall()) {
        throw new Error('Could not save application state before installing the update. Please retry.');
      }
      if (!installInProgress || currentState.status !== 'downloaded') {
        installInProgress = false;
        cancelInstall();
        return { ok: false };
      }
      // These arguments apply to NSIS; macOS uses Squirrel's relaunch flow.
      autoUpdater.quitAndInstall(true, true);
      return { ok: true };
    } catch (e) {
      installInProgress = false;
      cancelInstall();
      logger.error('[Updater] quitAndInstall failed:', e);
      send({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      return { ok: false };
    }
  });
}

/** 暴露当前应用版本号给渲染层（用于设置页显示）。 */
export function registerVersionIpc(): void {
  ipcMain.handle('app:get-version', (): string => app.getVersion());
}

/** 初始化 autoUpdater 并注册事件转发 / IPC。不可用时只注册 IPC。 */
export function initUpdater(prepareToInstall: () => Promise<boolean>, cancelInstall: () => void): void {
  unavailableReason = getUpdaterUnavailableReason({
    platform: process.platform,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    executablePath: process.execPath,
  });
  currentState = unavailableReason ? { status: 'unavailable', reason: unavailableReason } : { status: 'idle' };
  registerUpdaterIpc(prepareToInstall, cancelInstall);
  if (unavailableReason) {
    logger.info(`[Updater] Skipped (${unavailableReason}).`);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = app.getVersion().startsWith('0.') || app.getVersion().includes('-');
  // Windows 按 blockmap 增量下载，失败时 electron-updater 自动退回全量；macOS 仍用全量。
  autoUpdater.disableDifferentialDownload = process.platform !== 'win32';
  autoUpdater.logger = logger;
  // Read the provider from electron-builder's app-update.yml, including isolated test feeds.

  autoUpdater.on('checking-for-update', () => {
    send({ status: 'checking' });
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    lastInfo = info;
    send({ status: 'available', info });
  });
  autoUpdater.on('update-not-available', () => {
    send({ status: 'not-available' });
  });
  autoUpdater.on('error', (err: Error) => {
    pendingMacInfo = null;
    if (installInProgress) {
      installInProgress = false;
      cancelInstall();
    }
    send({ status: 'error', message: err.message });
  });
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    if (lastInfo) {
      send({ status: 'downloading', info: lastInfo, progress });
    }
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    lastInfo = info;
    if (process.platform === 'darwin') {
      // electron-updater has the ZIP, but Squirrel still needs to unpack and verify it.
      // Do not prepare the final save until native quitAndInstall can quit immediately.
      pendingMacInfo = info;
      send({ status: 'downloading', info, progress: null });
    } else {
      send({ status: 'downloaded', info });
    }
  });
  if (process.platform === 'darwin') {
    nativeAutoUpdater.on('update-downloaded', () => {
      if (!pendingMacInfo) return;
      const info = pendingMacInfo;
      pendingMacInfo = null;
      send({ status: 'downloaded', info });
    });
  }

  logger.info('[Updater] Initialized.');
}

/** 启动静默检查：窗口 ready 后延迟几秒检查一次，错误静默吞掉（不打扰用户）。 */
export function scheduleStartupCheck(delayMs = 5000): void {
  if (unavailableReason || startupCheckDone) {
    return;
  }
  startupCheckDone = true;
  setTimeout(async () => {
    // A manual check may already have started or finished while this timer was pending.
    if (currentState.status !== 'idle' || installInProgress) return;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      logger.warn('[Updater] startup check failed (silent):', e);
    }
  }, delayMs);
}
