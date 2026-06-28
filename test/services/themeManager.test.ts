import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { themeManager } from '@/services/themeManager';
import { THEME_IDS } from '@/types/theme';
import { getDefaultTheme } from '@/services/themes/predefinedThemes';
import { resolveThemeControls } from '@/services/themeControls';

beforeEach(() => {
  localStorage.clear();
  (themeManager as any).currentThemeId = THEME_IDS.DEFAULT;
});

describe('getCurrentThemeId', () => {
  it('should return default theme id initially', () => {
    expect(themeManager.getCurrentThemeId()).toBe(THEME_IDS.DEFAULT);
  });
});

describe('getCurrentTheme', () => {
  it('should return a valid theme config', () => {
    const theme = themeManager.getCurrentTheme();
    expect(theme).toBeDefined();
    expect(theme.id).toBe(THEME_IDS.DEFAULT);
    expect(theme.colors).toBeDefined();
    expect(theme.colors.primary).toBeTruthy();
  });
});

describe('setTheme', () => {
  it('should change the current theme', () => {
    const allThemes = themeManager.getAllThemes();
    const otherTheme = allThemes.find(t => t.id !== THEME_IDS.DEFAULT);
    if (!otherTheme) return;

    themeManager.setTheme(otherTheme.id);
    expect(themeManager.getCurrentThemeId()).toBe(otherTheme.id);
  });

  it('should ignore non-existent theme id', () => {
    const originalId = themeManager.getCurrentThemeId();
    // Call setTheme with an invalid id - the method logs a warning and returns
    themeManager.setTheme('non-existent' as any);
    // Theme should remain unchanged
    expect(themeManager.getCurrentThemeId()).toBe(originalId);
  });

  it('should persist to localStorage', () => {
    const allThemes = themeManager.getAllThemes();
    const otherTheme = allThemes.find(t => t.id !== THEME_IDS.DEFAULT);
    if (!otherTheme) return;

    themeManager.setTheme(otherTheme.id);
    expect(localStorage.getItem('app-theme')).toBe(otherTheme.id);
  });
});

describe('getAllThemes', () => {
  it('should return an array of themes', () => {
    const themes = themeManager.getAllThemes();
    expect(Array.isArray(themes)).toBe(true);
    expect(themes.length).toBeGreaterThan(0);
  });

  it('should include the default theme', () => {
    const themes = themeManager.getAllThemes();
    expect(themes.some(t => t.id === THEME_IDS.DEFAULT)).toBe(true);
  });
});

describe('applyTheme', () => {
  it('should set CSS custom properties on :root', () => {
    const theme = getDefaultTheme();

    // Restore original documentElement before this test
    themeManager.applyTheme(theme);

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--theme-primary')).toBe(theme.colors.primary);
    expect(root.style.getPropertyValue('--theme-background-dark')).toBe(theme.colors.backgroundDark);
    expect(root.style.getPropertyValue('--theme-text-primary')).toBe(theme.colors.textPrimary);
  });

  it('should expose theme-driven control custom properties', () => {
    const theme = getDefaultTheme();
    const controls = resolveThemeControls(theme);

    themeManager.applyTheme(theme);

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--theme-control-panel-bg')).toBe(controls.panelBackground);
    expect(root.style.getPropertyValue('--theme-control-action-bg')).toBe(controls.actionBackground);
    expect(root.style.getPropertyValue('--theme-control-primary-button-bg')).toBe(controls.primaryButtonBackground);
    expect(root.style.getPropertyValue('--theme-control-slider-fill')).toBe(controls.sliderFill);
  });

  it('should allow themes to override control styles without changing palette tokens', () => {
    const theme = {
      ...getDefaultTheme(),
      controls: {
        actionBackground: '#123456',
        sliderFill: '#abcdef',
      },
    };

    themeManager.applyTheme(theme);

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--theme-primary')).toBe(theme.colors.primary);
    expect(root.style.getPropertyValue('--theme-control-action-bg')).toBe('#123456');
    expect(root.style.getPropertyValue('--theme-control-slider-fill')).toBe('#abcdef');
  });

  it('should set font family on root', () => {
    const theme = getDefaultTheme();
    themeManager.applyTheme(theme);
    // CSSOM serializes single quotes to double quotes, so do a contains check
    expect(document.documentElement.style.fontFamily).toContain('Inter');
  });

  it('should toggle theme-dark / theme-light class based on isDark', () => {
    const darkTheme = getDefaultTheme();
    // The default theme is probably dark — test the light case
    const lightTheme = { ...darkTheme, isDark: false };
    themeManager.applyTheme(lightTheme);
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false);
  });
});

describe('subscribe', () => {
  it('should notify on theme change', () => {
    const listener = vi.fn();
    themeManager.subscribe(listener);

    const allThemes = themeManager.getAllThemes();
    const otherTheme = allThemes.find(t => t.id !== THEME_IDS.DEFAULT);
    if (!otherTheme) return;

    themeManager.setTheme(otherTheme.id);
    expect(listener).toHaveBeenCalledWith(otherTheme.id);
  });

  it('should stop notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = themeManager.subscribe(listener);
    unsubscribe();

    const allThemes = themeManager.getAllThemes();
    const otherTheme = allThemes.find(t => t.id !== THEME_IDS.DEFAULT);
    if (!otherTheme) return;

    themeManager.setTheme(otherTheme.id);
    expect(listener).not.toHaveBeenCalled();
  });
});
