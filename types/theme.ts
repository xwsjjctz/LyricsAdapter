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

export interface ThemeControlStyles {
  // Player / fixed panels
  panelBackground: string;
  panelBackgroundGlass: string;
  panelBackgroundGlassStrong: string;
  panelFloatingBackground: string;
  panelBorder: string;
  panelShadow: string;

  // Grouped controls, sidebar nav, segmented controls
  containerBackground: string;
  containerBorder: string;
  itemBackgroundHover: string;
  itemBackgroundActive: string;
  itemForegroundActive: string;
  itemShadowActive: string;
  currentTrackForeground: string;
  currentTrackBandTint: string;

  // Icon buttons and icon surfaces
  iconBackground: string;
  iconBackgroundActive: string;
  iconForeground: string;
  iconForegroundHover: string;
  iconForegroundActive: string;

  // Action buttons
  actionBackground: string;
  actionBackgroundHover: string;
  actionBackgroundActive: string;
  actionForeground: string;
  actionForegroundHover: string;
  actionForegroundActive: string;
  actionShadow: string;
  actionShadowActive: string;

  // Playback controls
  primaryButtonBackground: string;
  primaryButtonForeground: string;
  primaryButtonShadow: string;
  sliderTrack: string;
  sliderFill: string;
  sliderSecondaryFill: string;

  // Inputs / popovers
  inputBackground: string;
  inputBorder: string;
  inputBorderActive: string;
}

export interface ThemeAppearanceStyles {
  surfaceRadius: string;
  controlRadius: string;
  cardRadius: string;
  smallRadius: string;
  buttonRadius: string;
  mediaRadius: string;
  mediaRadiusSm: string;
  progressRadius: string;
  progressHeight: string;
  surfaceBorderWidth: string;
  controlBorderWidth: string;
  panelBorderWidth: string;
  surfaceShadow: string;
  surfaceShadowHover: string;
  elevatedShadow: string;
  textBodyWeight: string;
  textHeadingWeight: string;
  textButtonWeight: string;
  headingLetterSpacing: string;
  buttonLetterSpacing: string;
  controlTextTransform: string;
  listItemBorder: string;
  listItemGap: string;
  listItemPaddingY: string;
  /**
   * 当前播放曲目的指示器形态。
   * - 'floating'：浮在列表外的跟随式高亮滑块（随滚动反向补偿 + 过渡动画）。
   * - 'inline'：不渲染浮动滑块，当前播放行直接用行内样式（实色背景 + 前景色）
   *   标识，无跟随动画。适合行本身已有强边框的粗粝类主题，且彻底规避
   *   浮动定位（rowStride/topInset）错位到相邻行的问题。
   */
  playingIndicator: 'floating' | 'inline';
}

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  description: string;
  icon: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  borderRadius: ThemeBorderRadius;
  controls?: Partial<ThemeControlStyles>;
  appearance?: Partial<ThemeAppearanceStyles>;
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
  GLACIER: 'glacier',

  // The idea comes from https://uiverse.io/WattoRex/odd-fish-37
  // Thanks to @WattoRex for the inspiration!
  BRUTALIST: 'brutalist',
} as const;

export type ThemeId = typeof THEME_IDS[keyof typeof THEME_IDS];
