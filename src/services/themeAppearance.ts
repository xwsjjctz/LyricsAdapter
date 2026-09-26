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
  // Radii nest concentrically inside the macOS native player bar (22px):
  // overlays 16 → controls and buttons 12 → small items and list covers 8.
  const defaults: ThemeAppearanceStyles = {
    controlbarRadius: '22px',
    surfaceRadius: borderRadius.xl,
    controlRadius: borderRadius.lg,
    cardRadius: borderRadius.md,
    smallRadius: borderRadius.sm,
    buttonRadius: borderRadius.lg,
    mediaRadius: borderRadius.lg,
    mediaRadiusSm: borderRadius.md,
    progressRadius: borderRadius.full,
    progressHeight: '4px',
    surfaceBorderWidth: '1px',
    controlBorderWidth: '1px',
    panelBorderWidth: '1px',
    surfaceShadow: `0 18px 48px -28px ${colors.shadowColor}`,
    surfaceShadowHover: `0 22px 54px -30px ${colors.shadowColor}`,
    elevatedShadow: '0 10px 24px -6px rgba(0, 0, 0, 0.2)',
    textBodyWeight: '500',
    textHeadingWeight: '800',
    textButtonWeight: '700',
    headingLetterSpacing: '0',
    buttonLetterSpacing: '0',
    controlTextTransform: 'none',
    listItemBorder: 'transparent',
    listItemGap: '8px',
    listItemPaddingY: '12px',
    playingIndicator: 'floating',
  };

  return {
    ...defaults,
    ...theme.appearance,
  };
}
