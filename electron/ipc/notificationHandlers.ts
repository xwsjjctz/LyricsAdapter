import { ipcMain, Notification } from 'electron';
import { getWindow } from '../windowManager';
import { logger } from '../logger';

/**
 * 系统通知：通过 Electron 主进程的 Notification 模块发送。
 *
 * 主进程 Notification 不依赖渲染进程的 notifications 权限授权，
 * 直接走系统通知中心（跨平台一致、官方推荐），点击可聚焦主窗口。
 */

export interface NotificationPayload {
  title: string;
  body: string;
  silent?: boolean;
}

export function registerNotificationHandlers(): void {
  ipcMain.handle('notification:show', async (_event, payload: NotificationPayload) => {
    if (!Notification.isSupported()) {
      logger.warn('[Notification] System notifications not supported on this platform.');
      return { ok: false, reason: 'unsupported' };
    }

    try {
      const { title, body, silent } = payload;
      const n = new Notification({
        title,
        body,
        ...(silent !== undefined ? { silent } : {}),
      });

      n.on('click', () => {
        const win = getWindow();
        if (win && !win.isDestroyed()) {
          win.show();
          win.focus();
        }
      });

      n.show();
      return { ok: true };
    } catch (err) {
      logger.error('[Notification] Failed to show notification:', err);
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });
}
