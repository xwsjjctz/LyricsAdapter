import { app, ipcMain } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { getWindow } from './windowManager';
import { logger } from './logger';

/**
 * 主进程自动更新模块（electron-updater + GitHub Releases）。
 *
 * 通过 latest*.yml + *.blockmap 实现差量增量下载。
 * 注意：electron-updater 仅在真打包构建里工作（npm run electron:dev 下会被跳过）。
 */

// 镜像渲染侧 services/desktopAdapter.ts 的 UpdaterState。
// 主进程发送、渲染进程接收，两边结构需手动保持一致。
export type UpdaterState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'not-available' }
  | { status: 'available'; info: UpdateInfo }
  | { status: 'downloading'; info: UpdateInfo; progress: ProgressInfo | null }
  | { status: 'downloaded'; info: UpdateInfo }
  | { status: 'error'; message: string };

const UPDATER_CHANNEL = 'updater-event';
const REPO_OWNER = 'xwsjjctz';
const REPO_NAME = 'LyricsAdapter';

let startupCheckDone = false;
// download-progress 事件 payload 不含 UpdateInfo，需在 update-available 时缓存。
let lastInfo: UpdateInfo | null = null;

function send(state: UpdaterState): void {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(UPDATER_CHANNEL, state);
  }
  logger.info(`[Updater] status=${state.status}`);
}

function registerUpdaterIpc(devMode: boolean): void {
  ipcMain.handle('updater:check', async (): Promise<{ ok: boolean; reason?: string }> => {
    if (devMode) {
      return { ok: false, reason: 'dev' };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (e) {
      logger.error('[Updater] check failed:', e);
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('updater:quit-and-install', async (): Promise<{ ok: boolean }> => {
    if (devMode) {
      return { ok: false };
    }
    try {
      // isSilent=false（用户已确认），isForceRunAfter=true（重启后重新打开）
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    } catch (e) {
      logger.error('[Updater] quitAndInstall failed:', e);
      return { ok: false };
    }
  });
}

/** 暴露当前应用版本号给渲染层（用于设置页显示）。 */
export function registerVersionIpc(): void {
  ipcMain.handle('app:get-version', (): string => app.getVersion());
}

/** 初始化 autoUpdater 并注册事件转发 / IPC。dev 模式下只注册 IPC。 */
export function initUpdater(): void {
  if (!app.isPackaged) {
    logger.info('[Updater] Skipped (dev mode — updater only runs in packaged builds).');
    registerUpdaterIpc(true);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = true; // 0.x 阶段所有 release 都是 pre-release
  // 差量（blockmap）更新默认开启，无需额外配置。

  try {
    // publish 配置已被 electron-builder 写入 app-update.yml，autoUpdater 会自动读取；
    // 这里显式 setFeedURL 锁定 owner/repo，确保与 app-update.yml 一致。
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: REPO_OWNER,
      repo: REPO_NAME,
    });
  } catch (e) {
    logger.error('[Updater] setFeedURL failed:', e);
  }

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
    send({ status: 'error', message: err.message });
  });
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    if (lastInfo) {
      send({ status: 'downloading', info: lastInfo, progress });
    }
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    lastInfo = info;
    send({ status: 'downloaded', info });
  });

  registerUpdaterIpc(false);
  logger.info('[Updater] Initialized.');
}

/** 启动静默检查：窗口 ready 后延迟几秒检查一次，错误静默吞掉（不打扰用户）。 */
export function scheduleStartupCheck(delayMs = 5000): void {
  if (!app.isPackaged || startupCheckDone) {
    return;
  }
  startupCheckDone = true;
  setTimeout(async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      logger.warn('[Updater] startup check failed (silent):', e);
    }
  }, delayMs);
}
