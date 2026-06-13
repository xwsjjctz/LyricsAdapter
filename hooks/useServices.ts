import { useEffect, useReducer, useState } from 'react';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import type { ThemeConfig } from '../types/theme';

/**
 * Subscribe to i18n language changes; re-renders the component on switch.
 * Side-effect only — caller still imports `i18n` from services to call .t() etc.
 */
export function useI18n(): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => i18n.subscribe(() => force()), []);
}

/**
 * Subscribe to theme changes; returns the current ThemeConfig.
 */
export function useTheme(): ThemeConfig {
  const [theme, setTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  useEffect(() => themeManager.subscribe(() => setTheme(themeManager.getCurrentTheme())), []);
  return theme;
}
