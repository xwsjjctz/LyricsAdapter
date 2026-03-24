/**
 * Theme configuration types for LyricsAdapter
 */

export interface ThemeColors {
  // Primary colors
  primary: string;
  primaryHover: string;
  primaryLight: string;

  // Background colors
  backgroundDark: string;
  backgroundGradientStart: string;
  backgroundGradientEnd: string;
  backgroundSidebar: string;
  backgroundCard: string;
  backgroundCardHover: string;

  // Text colors
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  // Border colors
  borderLight: string;
  borderHover: string;

  // Accent colors
  accent: string;
  accentHover: string;

  // Status colors
  success: string;
  warning: string;
  error: string;
  info: string;

  // Special effects
  shadowColor: string;
  glowColor: string;
}

export interface ThemeFonts {
  main: string;
  display?: string;
  mono?: string;
}

export interface ThemeBorderRadius {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  full: string;
}

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  description: string;
  icon: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  borderRadius: ThemeBorderRadius;
  tags: string[];
  isDark: boolean;
}

// Default theme IDs
export const THEME_IDS = {
  DEFAULT: 'default',
  CUTE: 'cute',
  OCEAN: 'ocean',
  SUNSET: 'sunset',
  FOREST: 'forest',
  MIDNIGHT: 'midnight',
  WARM: 'warm',
} as const;

export type ThemeId = typeof THEME_IDS[keyof typeof THEME_IDS];
