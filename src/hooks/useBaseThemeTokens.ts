import { useLayoutEffect, type RefObject } from 'react';
import { applyThemeVarsToElement, themeManager } from '../services/themeManager';

/**
 * Redeclares the current theme's own --theme-* tokens on an element, so a
 * surface that keeps its own material (the Windows glass player) is not
 * reshaped by the platform's Fluent layer on the root.
 */
export function useBaseThemeTokens(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const apply = () => applyThemeVarsToElement(element, themeManager.getBaseTheme());
    apply();
    return themeManager.subscribe(apply);
  }, [ref, enabled]);
}
