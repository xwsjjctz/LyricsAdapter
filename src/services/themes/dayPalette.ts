import type { ThemeColors } from '../../types/theme';

/**
 * The pink-blue day palette that was the default before the app settled on the
 * night palette everywhere. It is intentionally not registered as a theme and
 * nothing applies it; it is kept as a reference for future colour work.
 */
export const dayPaletteColors: ThemeColors = {
  primary: '#b6408d',
  primaryHover: '#a83d88',
  primaryLight: 'rgba(238, 166, 217, 0.24)',
  backgroundDark: '#f5e2f6',
  backgroundGradientStart: '#ffc5d1',
  backgroundGradientEnd: '#7cc6fc',
  backgroundSidebar: '#f7eef9',
  backgroundCard: 'rgba(255, 255, 255, 0.72)',
  backgroundCardHover: 'rgba(255, 255, 255, 0.94)',
  textPrimary: '#31283a',
  textSecondary: '#5d536a',
  textMuted: '#796e84',
  borderLight: 'rgba(83, 67, 102, 0.12)',
  borderHover: 'rgba(83, 67, 102, 0.24)',
  accent: '#4e6ec8',
  accentHover: '#405fba',
  success: '#3f8f70',
  warning: '#b47722',
  error: '#bd4f68',
  info: '#4e6ec8',
  shadowColor: 'rgba(71, 55, 91, 0.12)',
  glowColor: 'rgba(182, 64, 141, 0.22)',
};
