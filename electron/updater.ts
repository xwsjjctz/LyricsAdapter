import { app, ipcMain } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { getWindow } from './windowManager';
import { logger } from './logger';

/**
 * 主进程自动更新模块（electron-updater + GitHub Releases）。
 *
 * 目前只在 Windows 上启用：NSIS 安装包不签名也能更新，macOS 的 Squirrel
 * 需要一致的代码签名，未签名构建无法通过校验。
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

/** 不可用的原因；null 表示更新可用（Windows 打包构建）。 */
const unavailableReason: 'dev' | 'unsupported' | null =
  process.platform !== 'win32' ? 'unsupported' : app.isPackaged ? null : 'dev';

let startupCheckDone = false;
// 设置页晚于启动检查挂载，需要能读到已经发生的状态。
let currentState: UpdaterState = { status: 'idle' };
// download-progress 事件 payload 不含 UpdateInfo，需在 update-available 时缓存。
let lastInfo: UpdateInfo | null = null;

function send(state: UpdaterState): void {
  currentState = state;
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(UPDATER_CHANNEL, state);
  }
  logger.info(`[Updater] status=${state.status}`);
}

function registerUpdaterIpc(): void {
  ipcMain.handle('updater:state', (): UpdaterState => currentState);

  ipcMain.handle('updater:check', async (): Promise<{ ok: boolean; reason?: string }> => {
    if (unavailableReason) {
      return { ok: false, reason: unavailableReason };
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
    if (unavailableReason) {
      return { ok: false };
    }
    try {
      // isSilent=true（不弹安装向导），isForceRunAfter=true（装完重新打开）
      autoUpdater.quitAndInstall(true, true);
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

/** 初始化 autoUpdater 并注册事件转发 / IPC。不可用时只注册 IPC。 */
export function initUpdater(): void {
  registerUpdaterIpc();
  if (unavailableReason) {
    logger.info(`[Updater] Skipped (${unavailableReason}).`);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = true; // 0.x 阶段所有 release 都是 pre-release
  autoUpdater.disableDifferentialDownload = true; // 走全量下载，避免生成 blockmap 拖慢打包

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

  logger.info('[Updater] Initialized.');
}

/** 启动静默检查：窗口 ready 后延迟几秒检查一次，错误静默吞掉（不打扰用户）。 */
export function scheduleStartupCheck(delayMs = 5000): void {
  if (unavailableReason || startupCheckDone) {
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
