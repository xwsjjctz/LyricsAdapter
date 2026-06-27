/**
 * Theme Manager Service
 * Handles theme selection, persistence, and application
 */

import { logger } from './logger';
import { ThemeConfig, THEME_IDS, ThemeId } from '../types/theme';
import { predefinedThemes, getDefaultTheme, getThemeById } from './themes/predefinedThemes';
import { hexToRgba } from './colorUtils';

const THEME_STORAGE_KEY = 'app-theme';

class ThemeManagerClass {
  private currentThemeId: ThemeId = THEME_IDS.DEFAULT;
  private listeners: Set<(themeId: ThemeId) => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
      if (storedTheme && predefinedThemes.some(t => t.id === storedTheme)) {
        this.currentThemeId = storedTheme;
        logger.debug('[ThemeManager] Loaded saved theme from localStorage:', storedTheme);
      } else {
        logger.debug('[ThemeManager] No saved theme found, using default');
      }
    } catch (error) {
      logger.error('[ThemeManager] Failed to load from localStorage:', error);
    }
  }

  private saveToStorage(themeId: ThemeId): void {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeId);
      logger.debug('[ThemeManager] Theme saved to localStorage:', themeId);
    } catch (error) {
      logger.error('[ThemeManager] Failed to save to localStorage:', error);
    }
  }

  getCurrentThemeId(): ThemeId {
    return this.currentThemeId;
  }

  getCurrentTheme(): ThemeConfig {
    return getThemeById(this.currentThemeId) || getDefaultTheme();
  }

  applyCurrentTheme(): void {
    this.applyTheme(this.getCurrentTheme());
  }

  setTheme(themeId: ThemeId): void {
    const theme = getThemeById(themeId);
    if (!theme) {
      logger.warn('[ThemeManager] Attempted to set non-existent theme:', themeId);
      return;
    }

    this.currentThemeId = themeId;
    this.saveToStorage(themeId);
    this.applyTheme(theme);
    this.notifyListeners();

    logger.info('[ThemeManager] Theme changed to:', theme.name);
  }

  getAllThemes(): ThemeConfig[] {
    return predefinedThemes;
  }

  subscribe(listener: (themeId: ThemeId) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.currentThemeId));
  }

  applyTheme(theme: ThemeConfig): void {
    const root = document.documentElement;
    const colors = theme.colors;
    const fonts = theme.fonts;
    const radius = theme.borderRadius;

    // Apply CSS custom properties (CSS variables)
    root.style.setProperty('--theme-primary', colors.primary);
    root.style.setProperty('--theme-primary-hover', colors.primaryHover);
    root.style.setProperty('--theme-primary-light', colors.primaryLight);

    // Derived alpha-tinted primary variants so tinted backgrounds can be used
    // as CSS variables (auto-refresh on theme switch) instead of inline RGB.
    root.style.setProperty('--theme-primary-08', hexToRgba(colors.primary, 0.08));
    root.style.setProperty('--theme-primary-10', hexToRgba(colors.primary, 0.10));
    root.style.setProperty('--theme-primary-13', hexToRgba(colors.primary, 0.13));
    root.style.setProperty('--theme-primary-16', hexToRgba(colors.primary, 0.16));
    root.style.setProperty('--theme-primary-20', hexToRgba(colors.primary, 0.20));

    root.style.setProperty('--theme-background-dark', colors.backgroundDark);
    root.style.setProperty('--theme-background-gradient-start', colors.backgroundGradientStart);
    root.style.setProperty('--theme-background-gradient-end', colors.backgroundGradientEnd);
    root.style.setProperty('--theme-background-sidebar', colors.backgroundSidebar);
    root.style.setProperty('--theme-background-card', colors.backgroundCard);
    root.style.setProperty('--theme-background-card-hover', colors.backgroundCardHover);
    root.style.setProperty('--theme-app-background', colors.appBackground);
    root.style.setProperty('--theme-main-background', colors.mainBackground);
    root.style.setProperty('--theme-surface', colors.surface);
    root.style.setProperty('--theme-surface-elevated', colors.surfaceElevated);
    root.style.setProperty('--theme-surface-muted', colors.surfaceMuted);
    root.style.setProperty('--theme-surface-subtle', colors.surfaceSubtle);
    root.style.setProperty('--theme-control', colors.control);
    root.style.setProperty('--theme-control-hover', colors.controlHover);
    root.style.setProperty('--theme-control-active', colors.controlActive);
    root.style.setProperty('--theme-overlay', colors.overlay);
    root.style.setProperty('--theme-input-background', colors.inputBackground);
    root.style.setProperty('--theme-selection-background', colors.selectionBackground);

    root.style.setProperty('--theme-text-primary', colors.textPrimary);
    root.style.setProperty('--theme-text-secondary', colors.textSecondary);
    root.style.setProperty('--theme-text-muted', colors.textMuted);
    root.style.setProperty('--theme-text-on-primary', colors.textOnPrimary);

    root.style.setProperty('--theme-border-light', colors.borderLight);
    root.style.setProperty('--theme-border-hover', colors.borderHover);
    root.style.setProperty('--theme-divider', colors.divider);
    root.style.setProperty('--theme-focus-ring', colors.focusRing);

    root.style.setProperty('--theme-accent', colors.accent);
    root.style.setProperty('--theme-accent-hover', colors.accentHover);

    root.style.setProperty('--theme-success', colors.success);
    root.style.setProperty('--theme-warning', colors.warning);
    root.style.setProperty('--theme-warning-10', hexToRgba(colors.warning, 0.10));
    root.style.setProperty('--theme-warning-20', hexToRgba(colors.warning, 0.20));
    root.style.setProperty('--theme-error', colors.error);
    root.style.setProperty('--theme-info', colors.info);

    root.style.setProperty('--theme-shadow-color', colors.shadowColor);
    root.style.setProperty('--theme-glow-color', colors.glowColor);

    root.style.setProperty('--theme-font-main', fonts.main);
    root.style.setProperty('--theme-font-display', fonts.display || fonts.main);
    root.style.setProperty('--theme-font-mono', fonts.mono || 'ui-monospace, monospace');

    root.style.setProperty('--theme-radius-sm', radius.sm);
    root.style.setProperty('--theme-radius-md', radius.md);
    root.style.setProperty('--theme-radius-lg', radius.lg);
    root.style.setProperty('--theme-radius-xl', radius.xl);
    root.style.setProperty('--theme-radius-full', radius.full);

    // Apply font family to body
    root.style.fontFamily = fonts.main;
    root.style.colorScheme = theme.isDark ? 'dark' : 'light';
    root.dataset['theme'] = theme.id;
    document.body.style.backgroundColor = colors.appBackground;

    // Add/remove dark mode class
    if (theme.isDark) {
      root.classList.add('theme-dark');
      root.classList.remove('theme-light');
    } else {
      root.classList.add('theme-light');
      root.classList.remove('theme-dark');
    }

    // Clean up legacy theme classes
    root.classList.remove('theme-cute');
    document.body.classList.remove('theme-cute');

    logger.debug('[ThemeManager] Theme applied:', theme.name);
  }
}

export const themeManager = new ThemeManagerClass();
