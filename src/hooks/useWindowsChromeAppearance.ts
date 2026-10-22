import { useEffect, useState } from 'react';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';
import { themeManager } from '../services/themeManager';
import type { WindowChromeTone } from '../shared/windowsChrome';

/**
 * Keeps the Windows window chrome in step with the app: Mica follows the
 * theme, and the native caption buttons take light glyphs over FocusMode's
 * dimmed cover backdrop.
 */
export function useWindowsChromeAppearance(enabled: boolean, isFocusMode: boolean): void {
  const [themeIsDark, setThemeIsDark] = useState(() => themeManager.getCurrentTheme().isDark);

  useEffect(() => {
    if (!enabled) return;
    return themeManager.subscribe(() => setThemeIsDark(themeManager.getCurrentTheme().isDark));
  }, [enabled]);

  const theme: WindowChromeTone = themeIsDark ? 'dark' : 'light';
  const captions: WindowChromeTone = isFocusMode ? 'dark' : theme;

  useEffect(() => {
    if (!enabled) return;
    getDesktopAPI()?.setWindowChromeAppearance?.({ theme, captions })
      .catch(error => logger.warn('[TitleBar] Failed to update window chrome:', error));
  }, [enabled, theme, captions]);
}
