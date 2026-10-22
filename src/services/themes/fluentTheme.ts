/**
 * Windows 11 (Fluent) layer over the app themes.
 *
 * On Windows the default themes keep their accent and the Mica tint from
 * their gradient, but take Fluent's neutral text, fill and stroke colours,
 * its 4px control / 8px overlay corners and Segoe UI's weights, so every
 * component that reads `--theme-*` follows Windows without its own branch.
 * Themes with their own shape language (`appearance`, e.g. brutalist) are
 * left as they are.
 */

import type { ThemeConfig } from '../../types/theme';
import { readableForeground } from '../colorUtils';

/** WinUI 3 theme resources for one tone. */
interface FluentPalette {
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  controlFill: string;
  controlFillHover: string;
  controlStroke: string;
  controlStrongFill: string;
  subtleFillHover: string;
  subtleFillPressed: string;
  cardFill: string;
  divider: string;
  flyoutFallback: string;
  flyoutShadow: string;
}

const DARK: FluentPalette = {
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255, 255, 255, 0.786)',
  textTertiary: 'rgba(255, 255, 255, 0.545)',
  controlFill: 'rgba(255, 255, 255, 0.0605)',
  controlFillHover: 'rgba(255, 255, 255, 0.0837)',
  controlStroke: 'rgba(255, 255, 255, 0.093)',
  controlStrongFill: 'rgba(255, 255, 255, 0.545)',
  subtleFillHover: 'rgba(255, 255, 255, 0.0605)',
  subtleFillPressed: 'rgba(255, 255, 255, 0.0419)',
  cardFill: 'rgba(255, 255, 255, 0.0512)',
  divider: 'rgba(255, 255, 255, 0.0837)',
  flyoutFallback: '#2c2c2c',
  flyoutShadow: '0 8px 16px rgba(0, 0, 0, 0.26)',
};

const LIGHT: FluentPalette = {
  textPrimary: 'rgba(0, 0, 0, 0.896)',
  textSecondary: 'rgba(0, 0, 0, 0.606)',
  textTertiary: 'rgba(0, 0, 0, 0.446)',
  controlFill: 'rgba(255, 255, 255, 0.7)',
  controlFillHover: 'rgba(249, 249, 249, 0.5)',
  controlStroke: 'rgba(0, 0, 0, 0.0578)',
  controlStrongFill: 'rgba(0, 0, 0, 0.446)',
  subtleFillHover: 'rgba(0, 0, 0, 0.0373)',
  subtleFillPressed: 'rgba(0, 0, 0, 0.0241)',
  cardFill: 'rgba(255, 255, 255, 0.7)',
  divider: 'rgba(0, 0, 0, 0.0803)',
  flyoutFallback: '#f9f9f9',
  flyoutShadow: '0 8px 16px rgba(0, 0, 0, 0.14)',
};

/** Whether a theme takes the Fluent layer: only those without their own shape language. */
export function supportsFluentAppearance(theme: ThemeConfig): boolean {
  return !theme.appearance;
}

/** The theme as drawn on Windows; themes with their own appearance come back unchanged. */
export function withFluentAppearance(theme: ThemeConfig): ThemeConfig {
  if (!supportsFluentAppearance(theme)) return theme;
  const fluent = theme.isDark ? DARK : LIGHT;
  const onAccent = readableForeground(theme.colors.primary);
  return {
    ...theme,
    designLanguage: 'fluent',
    colors: {
      ...theme.colors,
      backgroundSidebar: fluent.flyoutFallback,
      backgroundCard: fluent.cardFill,
      backgroundCardHover: fluent.controlFillHover,
      textPrimary: fluent.textPrimary,
      textSecondary: fluent.textSecondary,
      textMuted: fluent.textTertiary,
      borderLight: fluent.divider,
      borderHover: fluent.controlStroke,
    },
    borderRadius: { sm: '4px', md: '4px', lg: '8px', xl: '8px', full: '9999px' },
    controls: {
      ...theme.controls,
      panelShadow: fluent.flyoutShadow,
      itemBackgroundHover: fluent.subtleFillHover,
      iconBackground: fluent.subtleFillHover,
      iconBackgroundActive: fluent.controlFillHover,
      actionBackground: fluent.controlFill,
      actionBackgroundHover: fluent.controlFillHover,
      primaryButtonBackground: theme.colors.primary,
      primaryButtonForeground: onAccent,
      primaryButtonShadow: 'none',
      sliderTrack: fluent.controlStrongFill,
      inputBackground: fluent.controlFill,
      inputBorder: fluent.controlStroke,
      inputBorderActive: theme.colors.primary,
    },
    appearance: {
      controlbarRadius: '8px',
      surfaceRadius: '8px',
      controlRadius: '4px',
      cardRadius: '4px',
      smallRadius: '4px',
      buttonRadius: '4px',
      mediaRadius: '8px',
      mediaRadiusSm: '4px',
      surfaceShadow: 'none',
      surfaceShadowHover: fluent.flyoutShadow,
      elevatedShadow: 'none',
      textBodyWeight: '400',
      textHeadingWeight: '600',
      textButtonWeight: '400',
    },
  };
}
