import { getDesktopAPI } from './desktopAdapter';
import { logger } from './logger';
import type { AppNotificationOptions } from '../types/notification';

/**
 * 显示系统通知。
 *
 * Electron 环境：走主进程 Notification 模块（IPC），不依赖渲染进程权限授权，
 * 跨平台一致且点击可聚焦窗口。
 * 浏览器环境（npm run dev）：fallback 到 Web Notification API。
 */
export async function notify(
  title: string,
  body: string,
  options?: AppNotificationOptions
): Promise<void> {
  try {
    const api = getDesktopAPI();
    if (api?.showNotification) {
      const result = await api.showNotification(title, body, options);
      if (result.ok) return;
      logger.warn('[Notification] Main-process notification failed, trying renderer fallback:', result.reason);
    }

    // 浏览器 fallback（无 Electron）
    if (typeof Notification === 'undefined') {
      logger.debug('[Notification] Notification API not available');
      return;
    }
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    const n = new Notification(title, {
      body,
      ...(options?.silent !== undefined && { silent: options.silent }),
      ...(options?.artworkUrls?.[0] ? { icon: options.artworkUrls[0] } : {}),
    });
    n.onclick = () => {
      n.close();
    };
  } catch (e) {
    logger.warn('[Notification] Failed to send notification:', e);
  }
}
