import { logger } from './logger';

export function notify(title: string, body: string, options?: { silent?: boolean }): void {
  try {
    if (typeof Notification === 'undefined') {
      logger.debug('[Notification] Notification API not available');
      return;
    }
    const n = new Notification(title, { body, ...(options?.silent !== undefined && { silent: options.silent }) });
    n.onclick = () => {
      n.close();
    };
  } catch (e) {
    logger.warn('[Notification] Failed to send notification:', e);
  }
}
