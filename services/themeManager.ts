/**
 * Theme Manager Service
 * Handles theme selection, persistence, and application
 */

import { logger } from './logger';
import { ThemeConfig, THEME_IDS, ThemeId } from '../types/theme';
import { predefinedThemes, getDefaultTheme } from './themes/predefinedThemes';

const THEME_STORAGE_KEY = 'app-theme';

class ThemeManagerClass {
  private currentThemeId: ThemeId = THEME_IDS.DEFAULT;
  private listeners: Set<(themeId: ThemeId) => void> = new Set();
  private isInitialized = false;

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
    this.isInitialized = true;
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
    return predefinedThemes.find(t => t.id === this.currentThemeId) || getDefaultTheme();
  }

  setTheme(themeId: ThemeId): void {
    const theme = predefinedThemes.find(t => t.id === themeId);
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

  private applyTheme(theme: ThemeConfig): void {
    const root = document.documentElement;
    const colors = theme.colors;
    const fonts = theme.fonts;
    const radius = theme.borderRadius;

    // Apply CSS custom properties (CSS variables)
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

    // Apply font family to body
    root.style.fontFamily = fonts.main;

    // Add/remove dark mode class
    if (theme.isDark) {
      root.classList.add('theme-dark');
      root.classList.remove('theme-light');
    } else {
      root.classList.add('theme-light');
      root.classList.remove('theme-dark');
    }

    logger.debug('[ThemeManager] Theme applied:', theme.name);
  }
}

export const themeManager = new ThemeManagerClass();
