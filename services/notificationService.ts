import { getDesktopAPI } from './desktopAdapter';
import { logger } from './logger';

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
  options?: { silent?: boolean }
): Promise<void> {
  try {
    const api = getDesktopAPI();
    if (api?.showNotification) {
      await api.showNotification(title, body, options);
      return;
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
    });
    n.onclick = () => {
      n.close();
    };
  } catch (e) {
    logger.warn('[Notification] Failed to send notification:', e);
  }
}
