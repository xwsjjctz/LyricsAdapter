/**
 * Derives shape, typography and surface tokens from a theme.
 *
 * This layer keeps older themes visually stable while allowing newer themes to
 * customize more than color: radii, border weight, shadows, progress bars and
 * text weight can all move through CSS variables.
 */

import { ThemeAppearanceStyles, ThemeConfig } from '../types/theme';

export function resolveThemeAppearance(theme: ThemeConfig): ThemeAppearanceStyles {
  const { borderRadius, colors } = theme;
  const defaults: ThemeAppearanceStyles = {
    surfaceRadius: borderRadius.xl,
    controlRadius: borderRadius.lg,
    buttonRadius: borderRadius.full,
    mediaRadius: borderRadius.lg,
    mediaRadiusSm: borderRadius.md,
    progressRadius: borderRadius.full,
    progressHeight: '4px',
    surfaceBorderWidth: '1px',
    controlBorderWidth: '1px',
    panelBorderWidth: '1px',
    surfaceShadow: `0 18px 48px -28px ${colors.shadowColor}`,
    surfaceShadowHover: `0 22px 54px -30px ${colors.shadowColor}`,
    textBodyWeight: '500',
    textHeadingWeight: '800',
    textButtonWeight: '700',
    headingLetterSpacing: '0',
    buttonLetterSpacing: '0',
    controlTextTransform: 'none',
    listItemBorder: 'transparent',
  };

  return {
    ...defaults,
    ...theme.appearance,
  };
}
