import React from 'react';
import { themeManager } from '@/services/themeManager';
import { THEME_IDS, ThemeConfig } from '@/types/theme';
import { i18n } from '@/services/i18n';
import type { OnlineSource } from '@/services/settingsManager';

/**
 * Shared theme-derived helpers for the application settings sections. Each section
 * component consumes the current theme's colours and a set of style utilities so
 * the sections stay visually consistent without re-deriving these values.
 *
 * NOTE: the settings panels still use inline colour styles (a pre-existing
 * pattern). A later CSS-token pass can migrate them; this module centralises the
 * derivation so that future migration has a single seam.
 */
export interface SettingsTheme {
  colors: ThemeConfig['colors'];
  isBrutalistTheme: boolean;
  /** Range-slider class for the active theme. */
  rangeClassName: string;
  /** Range-slider inline style factory for the active theme. */
  rangeStyle: (progress: number) => React.CSSProperties;
  /** Shared text-input inline style. */
  inputStyle: React.CSSProperties;
  /** Shared text-input focus handler. */
  inputFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /** Shared text-input blur handler. */
  inputBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

export function useSettingsTheme(theme: ThemeConfig): SettingsTheme {
  const colors = theme.colors;
  const isBrutalistTheme = theme.id === THEME_IDS.BRUTALIST;

  const rangeClassName = isBrutalistTheme
    ? 'retro-range'
    : 'w-20 h-1.5 rounded-full appearance-none cursor-pointer';
  const rangeStyle = (progress: number): React.CSSProperties =>
    isBrutalistTheme
      ? ({ '--retro-range-progress': `${progress}%` } as React.CSSProperties)
      : { background: `linear-gradient(to right, ${colors.primary} ${progress}%, ${colors.borderLight} ${progress}%)` };

  const inputStyle: React.CSSProperties = {
    backgroundColor: colors.backgroundCard,
    border: `1px solid ${colors.borderLight}`,
    color: colors.textPrimary,
    borderRadius: 'var(--theme-control-radius)',
  };
  const inputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
    e.currentTarget.style.boxShadow = `0 0 15px ${colors.glowColor}`;
  };
  const inputBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.backgroundColor = colors.backgroundCard;
    e.currentTarget.style.boxShadow = 'none';
  };

  return {
    colors,
    isBrutalistTheme,
    rangeClassName,
    rangeStyle,
    inputStyle,
    inputFocus,
    inputBlur,
  };
}

/**
 * Subscribe to the active app-wide theme; re-renders on change. Used by shared
 * settings sections so they follow the global theme (e.g. light mode → dark
 * text) without duplicating a second theme state.
 */
export function useCurrentTheme(): ThemeConfig {
  const [theme, setTheme] = React.useState<ThemeConfig>(themeManager.getCurrentTheme());
  React.useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => setTheme(themeManager.getCurrentTheme()));
    return unsubscribe;
  }, []);
  return theme;
}

/**
 * Online music source option list.
 *
 * Returned by a function (not a module-level constant) so i18n.t() runs during
 * render rather than once at import time — otherwise switching language leaves
 * the QQ/NetEase labels frozen in whatever language was active at first import.
 */
export function getSourceOptions(): { value: OnlineSource; label: string }[] {
  return [
    { value: 'qq', label: i18n.t('settingsDialog.onlineSourceQq') },
    { value: 'netease', label: i18n.t('settingsDialog.onlineSourceNetease') },
    { value: 'soda', label: i18n.t('settingsDialog.onlineSourceSoda') },
  ];
}

/** Language option list. */
export const LANGUAGE_OPTIONS: { value: import('@/services/i18n').Language; label: string; nativeLabel: string }[] = [
  { value: 'zh', label: i18n.t('settings.language.zh'), nativeLabel: '中文' },
  { value: 'en', label: i18n.t('settings.language.en'), nativeLabel: 'English' },
  { value: 'ja', label: i18n.t('settings.language.ja'), nativeLabel: '日本語' },
  { value: 'ko', label: i18n.t('settings.language.ko'), nativeLabel: '한국어' },
  { value: 'de', label: i18n.t('settings.language.de'), nativeLabel: 'Deutsch' },
  { value: 'fr', label: i18n.t('settings.language.fr'), nativeLabel: 'Français' },
];
