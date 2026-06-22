import { useEffect } from 'react';
import { getDesktopAPIAsync, getDesktopAPI } from '../services/desktopAdapter';
import { themeManager } from '../services/themeManager';
import { webdavClient } from '../services/webdavClient';
import { terminateMetadataWorker } from '../services/metadataService';
import { logger } from '../services/logger';

interface UseAppLifecycleParams {
  activeBlobUrlsRef: React.MutableRefObject<Set<string>>;
}

/**
 * One-shot application initialization side effects:
 * - Clear stale CDN URL cache on startup
 * - Initialize Desktop API (async) and revoke tracked blob URLs on unmount
 * - Inject theme CSS variables on the root element
 * - Linux: make body transparent for rounded window corners
 *
 * These are all mount-only effects with no returned state. Window-focus and
 * floating-panel subscriptions are NOT here (they carry state, kept in App).
 */
export function useAppLifecycle({ activeBlobUrlsRef }: UseAppLifecycleParams): void {
  // 启动时清除持久化的 CDN URL 缓存，避免使用可能已过期的预签名 URL
  useEffect(() => {
    webdavClient.clearCdnCache();
  }, []);

  useEffect(() => {
    const initDesktopAPI = async () => {
      logger.debug('[App] Initializing Desktop API...');
      try {
        const api = await getDesktopAPIAsync();
        if (api) {
          logger.debug('[App] ✓ Desktop API initialized, platform:', api.platform);
        } else {
          logger.debug('[App] No Desktop API available (running in browser)');
        }
      } catch (error) {
        logger.error('[App] Failed to initialize Desktop API:', error);
      }
    };
    initDesktopAPI();
    return () => {
      logger.debug('[App] Cleaning up', activeBlobUrlsRef.current.size, 'blob URLs...');
      activeBlobUrlsRef.current.forEach(blobUrl => {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          // Ignore errors during cleanup
        }
      });
      activeBlobUrlsRef.current.clear();
      logger.debug('[App] ✓ All blob URLs revoked');
      terminateMetadataWorker();
    };
  }, [activeBlobUrlsRef]);

  useEffect(() => {
    // Theme CSS variables are injected via the single canonical path in
    // themeManager — keeping this in sync with ThemeView.applyThemeStyles
    // and themeManager.applyTheme used to require three duplicated copies;
    // now everyone delegates to one implementation.
    themeManager.applyCurrentTheme();
    logger.debug('[App] Theme initialized:', themeManager.getCurrentThemeId());
  }, []);

  // Linux 透明窗口圆角：body 透明，由根 div 提供背景和圆角裁剪
  useEffect(() => {
    const api = getDesktopAPI();
    if (api?.platform === 'linux') {
      document.body.style.backgroundColor = 'transparent';
    }
  }, []);
}
