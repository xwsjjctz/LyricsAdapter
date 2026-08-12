/**
 * Theme Manager Service
 * Handles theme selection, persistence, and application
 */

import { logger } from './logger';
import { appStorage } from './appStorage';
import { ThemeConfig, THEME_IDS, ThemeId } from '../types/theme';
import { predefinedThemes, getDefaultTheme } from './themes/predefinedThemes';
import { hexToRgba } from './colorUtils';
import { resolveThemeControls } from './themeControls';
import { resolveThemeAppearance } from './themeAppearance';

const THEME_STORAGE_KEY = 'app-theme';

/** Write a theme's CSS custom properties and light/dark marker to an element. */
function applyThemeVarsToElement(el: HTMLElement, theme: ThemeConfig): void {
  const colors = theme.colors;
  const fonts = theme.fonts;
  const radius = theme.borderRadius;
  const controls = resolveThemeControls(theme);
  const appearance = resolveThemeAppearance(theme);

  el.style.setProperty('--theme-primary', colors.primary);
  el.style.setProperty('--theme-primary-hover', colors.primaryHover);
  el.style.setProperty('--theme-primary-light', colors.primaryLight);

  el.style.setProperty('--theme-primary-08', hexToRgba(colors.primary, 0.08));
  el.style.setProperty('--theme-primary-10', hexToRgba(colors.primary, 0.10));
  el.style.setProperty('--theme-primary-13', hexToRgba(colors.primary, 0.13));
  el.style.setProperty('--theme-primary-16', hexToRgba(colors.primary, 0.16));
  el.style.setProperty('--theme-primary-20', hexToRgba(colors.primary, 0.20));

  el.style.setProperty('--theme-background-dark', colors.backgroundDark);
  el.style.setProperty('--theme-background-gradient-start', colors.backgroundGradientStart);
  el.style.setProperty('--theme-background-gradient-end', colors.backgroundGradientEnd);
  el.style.setProperty('--theme-background-sidebar', colors.backgroundSidebar);
  el.style.setProperty('--theme-background-card', colors.backgroundCard);
  el.style.setProperty('--theme-background-card-hover', colors.backgroundCardHover);

  el.style.setProperty('--theme-text-primary', colors.textPrimary);
  el.style.setProperty('--theme-text-secondary', colors.textSecondary);
  el.style.setProperty('--theme-text-muted', colors.textMuted);

  el.style.setProperty('--theme-border-light', colors.borderLight);
  el.style.setProperty('--theme-border-hover', colors.borderHover);

  el.style.setProperty('--theme-accent', colors.accent);
  el.style.setProperty('--theme-accent-hover', colors.accentHover);

  el.style.setProperty('--theme-success', colors.success);
  el.style.setProperty('--theme-warning', colors.warning);
  el.style.setProperty('--theme-warning-10', hexToRgba(colors.warning, 0.10));
  el.style.setProperty('--theme-warning-20', hexToRgba(colors.warning, 0.20));
  el.style.setProperty('--theme-error', colors.error);
  el.style.setProperty('--theme-info', colors.info);

  el.style.setProperty('--theme-shadow-color', colors.shadowColor);
  el.style.setProperty('--theme-glow-color', colors.glowColor);

  el.style.setProperty('--theme-font-main', fonts.main);
  el.style.setProperty('--theme-font-display', fonts.display || fonts.main);
  el.style.setProperty('--theme-font-mono', fonts.mono || 'ui-monospace, monospace');

  el.style.setProperty('--theme-radius-sm', radius.sm);
  el.style.setProperty('--theme-radius-md', radius.md);
  el.style.setProperty('--theme-radius-lg', radius.lg);
  el.style.setProperty('--theme-radius-xl', radius.xl);
  el.style.setProperty('--theme-radius-full', radius.full);

  el.style.setProperty('--theme-control-panel-bg', controls.panelBackground);
  el.style.setProperty('--theme-control-panel-bg-glass', controls.panelBackgroundGlass);
  el.style.setProperty('--theme-control-panel-bg-glass-strong', controls.panelBackgroundGlassStrong);
  el.style.setProperty('--theme-control-panel-bg-floating', controls.panelFloatingBackground);
  el.style.setProperty('--theme-control-panel-border', controls.panelBorder);
  el.style.setProperty('--theme-control-panel-shadow', controls.panelShadow);

  el.style.setProperty('--theme-control-container-bg', controls.containerBackground);
  el.style.setProperty('--theme-control-container-border', controls.containerBorder);
  el.style.setProperty('--theme-control-item-bg-hover', controls.itemBackgroundHover);
  el.style.setProperty('--theme-control-item-bg-active', controls.itemBackgroundActive);
  el.style.setProperty('--theme-control-item-fg-active', controls.itemForegroundActive);
  el.style.setProperty('--theme-control-item-shadow-active', controls.itemShadowActive);
  el.style.setProperty('--theme-control-current-track-fg', controls.currentTrackForeground);
  el.style.setProperty('--theme-control-current-track-band-tint', controls.currentTrackBandTint);

  el.style.setProperty('--theme-control-icon-bg', controls.iconBackground);
  el.style.setProperty('--theme-control-icon-bg-active', controls.iconBackgroundActive);
  el.style.setProperty('--theme-control-icon-fg', controls.iconForeground);
  el.style.setProperty('--theme-control-icon-fg-hover', controls.iconForegroundHover);
  el.style.setProperty('--theme-control-icon-fg-active', controls.iconForegroundActive);

  el.style.setProperty('--theme-control-action-bg', controls.actionBackground);
  el.style.setProperty('--theme-control-action-bg-hover', controls.actionBackgroundHover);
  el.style.setProperty('--theme-control-action-bg-active', controls.actionBackgroundActive);
  el.style.setProperty('--theme-control-action-fg', controls.actionForeground);
  el.style.setProperty('--theme-control-action-fg-hover', controls.actionForegroundHover);
  el.style.setProperty('--theme-control-action-fg-active', controls.actionForegroundActive);
  el.style.setProperty('--theme-control-action-shadow', controls.actionShadow);
  el.style.setProperty('--theme-control-action-shadow-active', controls.actionShadowActive);

  el.style.setProperty('--theme-control-primary-button-bg', controls.primaryButtonBackground);
  el.style.setProperty('--theme-control-primary-button-fg', controls.primaryButtonForeground);
  el.style.setProperty('--theme-control-primary-button-shadow', controls.primaryButtonShadow);
  el.style.setProperty('--theme-control-slider-track', controls.sliderTrack);
  el.style.setProperty('--theme-control-slider-fill', controls.sliderFill);
  el.style.setProperty('--theme-control-slider-fill-secondary', controls.sliderSecondaryFill);

  el.style.setProperty('--theme-control-input-bg', controls.inputBackground);
  el.style.setProperty('--theme-control-input-border', controls.inputBorder);
  el.style.setProperty('--theme-control-input-border-active', controls.inputBorderActive);

  el.style.setProperty('--theme-surface-radius', appearance.surfaceRadius);
  el.style.setProperty('--theme-control-radius', appearance.controlRadius);
  el.style.setProperty('--theme-card-radius', appearance.cardRadius);
  el.style.setProperty('--theme-small-radius', appearance.smallRadius);
  el.style.setProperty('--theme-button-radius', appearance.buttonRadius);
  el.style.setProperty('--theme-media-radius', appearance.mediaRadius);
  el.style.setProperty('--theme-media-radius-sm', appearance.mediaRadiusSm);
  el.style.setProperty('--theme-progress-radius', appearance.progressRadius);
  el.style.setProperty('--theme-progress-height', appearance.progressHeight);
  el.style.setProperty('--theme-surface-border-width', appearance.surfaceBorderWidth);
  el.style.setProperty('--theme-control-border-width', appearance.controlBorderWidth);
  el.style.setProperty('--theme-panel-border-width', appearance.panelBorderWidth);
  el.style.setProperty('--theme-list-item-border', appearance.listItemBorder);
  el.style.setProperty('--theme-list-item-gap', appearance.listItemGap);
  el.style.setProperty('--theme-list-item-padding-y', appearance.listItemPaddingY);
  el.style.setProperty('--theme-surface-shadow', appearance.surfaceShadow);
  el.style.setProperty('--theme-surface-shadow-hover', appearance.surfaceShadowHover);
  el.style.setProperty('--theme-elevated-shadow', appearance.elevatedShadow);
  el.style.setProperty('--theme-text-body-weight', appearance.textBodyWeight);
  el.style.setProperty('--theme-text-heading-weight', appearance.textHeadingWeight);
  el.style.setProperty('--theme-text-button-weight', appearance.textButtonWeight);
  el.style.setProperty('--theme-heading-letter-spacing', appearance.headingLetterSpacing);
  el.style.setProperty('--theme-button-letter-spacing', appearance.buttonLetterSpacing);
  el.style.setProperty('--theme-control-text-transform', appearance.controlTextTransform);

  if (theme.isDark) {
    el.classList.add('theme-dark');
    el.classList.remove('theme-light');
  } else {
    el.classList.add('theme-light');
    el.classList.remove('theme-dark');
  }
}

class ThemeManagerClass {
  private currentThemeId: ThemeId = THEME_IDS.DEFAULT_DARK;
  private listeners: Set<(themeId: ThemeId) => void> = new Set();
  private themeTransitionTimer: number | null = null;

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const storedTheme = appStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
      const normalizedTheme = this.normalizeThemeId(storedTheme);
      if (normalizedTheme && predefinedThemes.some(t => t.id === normalizedTheme)) {
        this.currentThemeId = normalizedTheme;
        logger.debug('[ThemeManager] Loaded saved theme from localStorage:', storedTheme);
      } else {
        logger.debug('[ThemeManager] No saved theme found, using default');
      }
    } catch (error) {
      logger.error('[ThemeManager] Failed to load from localStorage:', error);
    }
  }

  private normalizeThemeId(themeId: ThemeId | null): ThemeId | null {
    if (themeId === THEME_IDS.DEFAULT) return THEME_IDS.DEFAULT_DARK;
    if (themeId === THEME_IDS.WARM) return THEME_IDS.DEFAULT_LIGHT;
    return themeId;
  }

  private saveToStorage(themeId: ThemeId): void {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeId);
      appStorage.setItem(THEME_STORAGE_KEY, themeId).catch(() => {});
      logger.debug('[ThemeManager] Theme saved', themeId);
    } catch (error) {
      logger.error('[ThemeManager] Failed to save theme:', error);
    }
  }

  getCurrentThemeId(): ThemeId {
    return this.currentThemeId;
  }

  getCurrentTheme(): ThemeConfig {
    return predefinedThemes.find(t => t.id === this.currentThemeId) || getDefaultTheme();
  }

  applyCurrentTheme(): void {
    this.applyTheme(this.getCurrentTheme());
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

  applyTheme(theme: ThemeConfig): void {
    const root = document.documentElement;

    this.startThemeTransition(root);

    applyThemeVarsToElement(root, theme);

    // Apply font family to body
    root.style.fontFamily = theme.fonts.main;

    // Clean up legacy theme classes
    root.classList.remove('theme-cute');
    document.body.classList.remove('theme-cute');

    logger.debug('[ThemeManager] Theme applied:', theme.name);
  }

  private startThemeTransition(root: HTMLElement): void {
    if (this.themeTransitionTimer !== null) {
      window.clearTimeout(this.themeTransitionTimer);
    }

    root.classList.add('theme-is-transitioning');
    this.themeTransitionTimer = window.setTimeout(() => {
      root.classList.remove('theme-is-transitioning');
      this.themeTransitionTimer = null;
    }, 420);
  }
}

export const themeManager = new ThemeManagerClass();
