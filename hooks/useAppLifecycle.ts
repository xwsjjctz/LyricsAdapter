import { useEffect } from 'react';
import { getDesktopAPIAsync, getDesktopAPI } from '../services/desktopAdapter';
import { themeManager } from '../services/themeManager';
import { webdavClient } from '../services/webdavClient';
import { metadataCacheService } from '../services/metadataCacheService';
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
      metadataCacheService.revokeAllBlobUrls();
      terminateMetadataWorker();
    };
  }, [activeBlobUrlsRef]);

  useEffect(() => {
    const theme = themeManager.getCurrentTheme();
    const root = document.documentElement;
    const colors = theme.colors;
    const fonts = theme.fonts;
    const radius = theme.borderRadius;
    root.style.setProperty('--theme-primary', colors.primary);
    root.style.setProperty('--theme-primary-hover', colors.primaryHover);
    root.style.setProperty('--theme-primary-light', colors.primaryLight);
    root.style.setProperty('--theme-background-dark', colors.backgroundDark);
    root.style.setProperty('--theme-background-gradient-start', colors.backgroundGradientStart);
    root.style.setProperty('--theme-background-gradient-end', colors.backgroundGradientEnd);
    root.style.setProperty('--theme-background-sidebar', colors.backgroundSidebar);
    root.style.setProperty('--theme-background-card', colors.backgroundCard);
    root.style.setProperty('--theme-background-card-hover', colors.backgroundCardHover);
    root.style.setProperty('--theme-text-primary', colors.textPrimary);
    root.style.setProperty('--theme-text-secondary', colors.textSecondary);
    root.style.setProperty('--theme-text-muted', colors.textMuted);
    root.style.setProperty('--theme-border-light', colors.borderLight);
    root.style.setProperty('--theme-border-hover', colors.borderHover);
    root.style.setProperty('--theme-accent', colors.accent);
    root.style.setProperty('--theme-accent-hover', colors.accentHover);
    root.style.setProperty('--theme-success', colors.success);
    root.style.setProperty('--theme-warning', colors.warning);
    root.style.setProperty('--theme-error', colors.error);
    root.style.setProperty('--theme-info', colors.info);
    root.style.setProperty('--theme-shadow-color', colors.shadowColor);
    root.style.setProperty('--theme-glow-color', colors.glowColor);
    root.style.setProperty('--theme-font-main', fonts.main);
    root.style.setProperty('--theme-radius-sm', radius.sm);
    root.style.setProperty('--theme-radius-md', radius.md);
    root.style.setProperty('--theme-radius-lg', radius.lg);
    root.style.setProperty('--theme-radius-xl', radius.xl);
    root.style.setProperty('--theme-radius-full', radius.full);
    root.style.fontFamily = fonts.main;
    if (theme.isDark) {
      root.classList.add('theme-dark');
      root.classList.remove('theme-light');
    } else {
      root.classList.add('theme-light');
      root.classList.remove('theme-dark');
    }
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
