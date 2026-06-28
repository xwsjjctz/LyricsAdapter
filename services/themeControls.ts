/**
 * Derives component-control tokens from a theme palette.
 *
 * Themes can override any value through `theme.controls`, while existing
 * themes keep their original visual behavior by using these palette-derived
 * defaults.
 */

import { ThemeConfig, ThemeControlStyles } from '../types/theme';
import { hexToRgba } from './colorUtils';

function alpha(color: string, opacity: number): string {
  if (!color.startsWith('#')) return color;
  return hexToRgba(color, opacity);
}

export function resolveThemeControls(theme: ThemeConfig): ThemeControlStyles {
  const { colors } = theme;
  const defaults: ThemeControlStyles = {
    panelBackground: colors.backgroundSidebar,
    panelBackgroundGlass: alpha(colors.backgroundSidebar, 0.4),
    panelBackgroundGlassStrong: alpha(colors.backgroundSidebar, 0.6),
    panelFloatingBackground: colors.backgroundSidebar,
    panelBorder: colors.borderLight,
    panelShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',

    containerBackground: colors.primaryLight,
    containerBorder: colors.borderLight,
    itemBackgroundHover: colors.backgroundCard,
    itemBackgroundActive: alpha(colors.primary, 0.16),
    itemForegroundActive: colors.primary,
    currentTrackForeground: colors.primary,
    itemShadowActive: '0 10px 24px -16px var(--theme-glow-color)',

    iconBackground: alpha(colors.primary, 0.08),
    iconBackgroundActive: alpha(colors.primary, 0.13),
    iconForeground: colors.textSecondary,
    iconForegroundHover: colors.textPrimary,
    iconForegroundActive: colors.primary,

    actionBackground: colors.backgroundCard,
    actionBackgroundHover: colors.backgroundCardHover,
    actionBackgroundActive: alpha(colors.primary, 0.20),
    actionForeground: colors.textSecondary,
    actionForegroundHover: colors.textPrimary,
    actionForegroundActive: colors.primary,
    actionShadow: '0 4px 16px -6px var(--theme-glow-color)',
    actionShadowActive: '0 0 20px var(--theme-glow-color)',

    primaryButtonBackground: colors.textPrimary,
    primaryButtonForeground: colors.backgroundDark,
    primaryButtonShadow: '0 10px 24px rgba(0, 0, 0, 0.18)',
    sliderTrack: colors.borderLight,
    sliderFill: colors.primary,
    sliderSecondaryFill: colors.textSecondary,

    inputBackground: colors.backgroundCard,
    inputBorder: colors.borderLight,
    inputBorderActive: alpha(colors.primary, 0.4),
  };

  return {
    ...defaults,
    ...theme.controls,
  };
}
