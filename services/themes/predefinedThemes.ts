/**
 * Predefined themes for LyricsAdapter
 */

import { ThemeConfig, THEME_IDS } from '../../types/theme';

export const predefinedThemes: ThemeConfig[] = [
  {
    id: THEME_IDS.DEFAULT,
    name: '经典蓝',
    description: '默认主题，经典蓝色调',
    icon: 'palette',
    isDark: true,
    tags: ['默认', '经典', '商务'],
    colors: {
      primary: '#2b8cee',
      primaryHover: '#4a9fef',
      primaryLight: 'rgba(43, 140, 238, 0.15)',
      backgroundDark: '#101922',
      backgroundGradientStart: '#101922',
      backgroundGradientEnd: '#1a2533',
      backgroundSidebar: '#16212e',
      backgroundCard: 'rgba(255, 255, 255, 0.05)',
      backgroundCardHover: 'rgba(255, 255, 255, 0.08)',
      textPrimary: '#ffffff',
      textSecondary: 'rgba(255, 255, 255, 0.7)',
      textMuted: 'rgba(255, 255, 255, 0.4)',
      borderLight: 'rgba(255, 255, 255, 0.1)',
      borderHover: 'rgba(255, 255, 255, 0.2)',
      accent: '#2b8cee',
      accentHover: '#4a9fef',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#3b82f6',
      shadowColor: 'rgba(0, 0, 0, 0.3)',
      glowColor: 'rgba(43, 140, 238, 0.15)',
    },
    fonts: {
      main: "'Inter', system-ui, -apple-system, sans-serif",
      display: "'Inter', system-ui, -apple-system, sans-serif",
    },
    borderRadius: {
      sm: '4px',
      md: '8px',
      lg: '12px',
      xl: '16px',
      full: '9999px',
    },
  },
  {
    id: THEME_IDS.WARM,
    name: '暖米',
    description: '温暖米色，简约雅致',
    icon: 'light_mode',
    isDark: false,
    tags: ['极简', '暖色', '简约'],
    colors: {
      primary: '#b8956a',
      primaryHover: '#a68458',
      primaryLight: 'rgba(184, 149, 106, 0.2)',
      backgroundDark: '#f5f0e8',
      backgroundGradientStart: '#f5f0e8',
      backgroundGradientEnd: '#ebe5d9',
      backgroundSidebar: '#e8e2d6',
      backgroundCard: 'rgba(255, 255, 255, 0.6)',
      backgroundCardHover: 'rgba(255, 255, 255, 0.85)',
      textPrimary: '#3d3028',
      textSecondary: '#5a4a3a',
      textMuted: '#8a7a6a',
      borderLight: 'rgba(61, 48, 40, 0.12)',
      borderHover: 'rgba(61, 48, 40, 0.25)',
      accent: '#b8956a',
      accentHover: '#a68458',
      success: '#5a9e5f',
      warning: '#c49a4a',
      error: '#c46a6a',
      info: '#6a8ec4',
      shadowColor: 'rgba(61, 48, 40, 0.1)',
      glowColor: 'rgba(184, 149, 106, 0.2)',
    },
    fonts: {
      main: "'Inter', system-ui, -apple-system, sans-serif",
      display: "'Inter', system-ui, -apple-system, sans-serif",
    },
    borderRadius: {
      sm: '4px',
      md: '8px',
      lg: '12px',
      xl: '16px',
      full: '9999px',
    },
  },
];

// Helper function to get a theme by ID
export function getThemeById(id: string): ThemeConfig | undefined {
  return predefinedThemes.find(theme => theme.id === id);
}

// Helper function to get the default theme
export function getDefaultTheme(): ThemeConfig {
  return predefinedThemes.find(theme => theme.id === THEME_IDS.DEFAULT)!;
}
