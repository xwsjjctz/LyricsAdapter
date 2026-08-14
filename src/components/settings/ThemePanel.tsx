import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { themeManager } from '../../services/themeManager';
import { ThemeConfig, ThemeId, THEME_IDS } from '../../types/theme';
import { predefinedThemes } from '../../services/themes/predefinedThemes';
import { resolveThemeAppearance } from '../../services/themeAppearance';
import { resolveThemeControls } from '../../services/themeControls';

interface ThemePanelProps {
  onClose: () => void;
}

const DEFAULT_THEME_IDS: ThemeId[] = [
  THEME_IDS.DEFAULT_DARK,
  THEME_IDS.DEFAULT_LIGHT,
  THEME_IDS.DEFAULT,
  THEME_IDS.WARM,
];

const STAR_PATH = 'M135.831 3.00688C135.055 3.85027 134.111 4.29946 133 4.35447C134.111 4.40947 135.055 4.85867 135.831 5.71123C136.607 6.55462 136.996 7.56303 136.996 8.72727C136.996 7.95722 137.172 7.25134 137.525 6.59129C137.886 5.93124 138.372 5.39954 138.98 5.00535C139.598 4.60199 140.268 4.39114 141 4.35447C139.88 4.2903 138.936 3.85027 138.16 3.00688C137.384 2.16348 136.996 1.16425 136.996 0C136.996 1.16425 136.607 2.16348 135.831 3.00688ZM31 23.3545C32.1114 23.2995 33.0551 22.8503 33.8313 22.0069C34.6075 21.1635 34.9956 20.1642 34.9956 19C34.9956 20.1642 35.3837 21.1635 36.1599 22.0069C36.9361 22.8503 37.8798 23.2903 39 23.3545C38.2679 23.3911 37.5976 23.602 36.9802 24.0053C36.3716 24.3995 35.8864 24.9312 35.5248 25.5913C35.172 26.2513 34.9956 26.9572 34.9956 27.7273C34.9956 26.563 34.6075 25.5546 33.8313 24.7112C33.0551 23.8587 32.1114 23.4095 31 23.3545ZM0 36.3545C1.11136 36.2995 2.05513 35.8503 2.83131 35.0069C3.6075 34.1635 3.99559 33.1642 3.99559 32C3.99559 33.1642 4.38368 34.1635 5.15987 35.0069C5.93605 35.8503 6.87982 36.2903 8 36.3545C7.26792 36.3911 6.59757 36.602 5.98015 37.0053C5.37155 37.3995 4.88644 37.9312 4.52481 38.5913C4.172 39.2513 3.99559 39.9572 3.99559 40.7273C3.99559 39.563 3.6075 38.5546 2.83131 37.7112C2.05513 36.8587 1.11136 36.4095 0 36.3545ZM56.8313 24.0069C56.0551 24.8503 55.1114 25.2995 54 25.3545C55.1114 25.4095 56.0551 25.8587 56.8313 26.7112C57.6075 27.5546 57.9956 28.563 57.9956 29.7273C57.9956 28.9572 58.172 28.2513 58.5248 27.5913C58.8864 26.9312 59.3716 26.3995 59.9802 26.0053C60.5976 25.602 61.2679 25.3911 62 25.3545C60.8798 25.2903 59.9361 24.8503 59.1599 24.0069C58.3837 23.1635 57.9956 22.1642 57.9956 21C57.9956 22.1642 57.6075 23.1635 56.8313 24.0069ZM81 25.3545C82.1114 25.2995 83.0551 24.8503 83.8313 24.0069C84.6075 23.1635 84.9956 22.1642 84.9956 21C84.9956 22.1642 85.3837 23.1635 86.1599 24.0069C86.9361 24.8503 87.8798 25.2903 89 25.3545C88.2679 25.3911 87.5976 25.602 86.9802 26.0053C86.3716 26.3995 85.8864 26.9312 85.5248 27.5913C85.172 28.2513 84.9956 28.9572 84.9956 29.7273C84.9956 28.563 84.6075 27.5546 83.8313 26.7112C83.0551 25.8587 82.1114 25.4095 81 25.3545ZM136 36.3545C137.111 36.2995 138.055 35.8503 138.831 35.0069C139.607 34.1635 139.996 33.1642 139.996 32C139.996 33.1642 140.384 34.1635 141.16 35.0069C141.936 35.8503 142.88 36.2903 144 36.3545C143.268 36.3911 142.598 36.602 141.98 37.0053C141.372 37.3995 140.886 37.9312 140.525 38.5913C140.172 39.2513 139.996 39.9572 139.996 40.7273C139.996 39.563 139.607 38.5546 138.831 37.7112C138.055 36.8587 137.111 36.4095 136 36.3545ZM101.831 49.0069C101.055 49.8503 100.111 50.2995 99 50.3545C100.111 50.4095 101.055 50.8587 101.831 51.7112C102.607 52.5546 102.996 53.563 102.996 54.7273C102.996 53.9572 103.172 53.2513 103.525 52.5913C103.886 51.9312 104.372 51.3995 104.98 51.0053C105.598 50.602 106.268 50.3911 107 50.3545C105.88 50.2903 104.936 49.8503 104.16 49.0069C103.384 48.1635 102.996 47.1642 102.996 46C102.996 47.1642 102.607 48.1635 101.831 49.0069Z';

interface ThemeModeSwitchProps {
  checked: boolean;
  ariaLabel: string;
  onChange: (checked: boolean) => void;
}

const ThemeModeSwitch: React.FC<ThemeModeSwitchProps> = ({ checked, ariaLabel, onChange }) => (
  <label className="theme-mode-switch theme-mode-switch--card" aria-label={ariaLabel}>
    <input
      type="checkbox"
      className="theme-mode-switch__checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="theme-mode-switch__container">
      <span className="theme-mode-switch__clouds" />
      <span className="theme-mode-switch__stars-container">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 55" fill="none" aria-hidden="true">
          <path fillRule="evenodd" clipRule="evenodd" d={STAR_PATH} fill="currentColor" />
        </svg>
      </span>
      <span className="theme-mode-switch__circle-container">
        <span className="theme-mode-switch__sun-moon-container">
          <span className="theme-mode-switch__moon">
            <span className="theme-mode-switch__spot" />
            <span className="theme-mode-switch__spot" />
            <span className="theme-mode-switch__spot" />
          </span>
        </span>
      </span>
    </span>
  </label>
);

const ThemePanel: React.FC<ThemePanelProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const [currentThemeId, setCurrentThemeId] = useState<ThemeId>(themeManager.getCurrentThemeId());
  const [defaultCardMode, setDefaultCardMode] = useState<'dark' | 'light'>(
    themeManager.getCurrentThemeId() === THEME_IDS.DEFAULT_LIGHT ? 'light' : 'dark'
  );
  // Subscribe to theme changes
  useEffect(() => {
    const unsubscribe = themeManager.subscribe((themeId) => {
      setCurrentThemeId(themeId);
      if (themeId === THEME_IDS.DEFAULT_DARK || themeId === THEME_IDS.DEFAULT_LIGHT) {
        setDefaultCardMode(themeId === THEME_IDS.DEFAULT_LIGHT ? 'light' : 'dark');
      }
      // Re-apply current theme styles when theme changes
      const currentTheme = themeManager.getCurrentTheme();
      applyThemeStyles(currentTheme);
    });
    return unsubscribe;
  }, []);

  // Apply current theme CSS variables on mount
  useEffect(() => {
    const currentTheme = themeManager.getCurrentTheme();
    applyThemeStyles(currentTheme);
  }, []);

  const handleApplyTheme = (themeId: ThemeId) => {
    themeManager.setTheme(themeId);
  };

  const handleToggleDefaultCardMode = (isDark: boolean) => {
    const nextMode = isDark ? 'dark' : 'light';
    const nextThemeId = isDark ? THEME_IDS.DEFAULT_DARK : THEME_IDS.DEFAULT_LIGHT;

    setDefaultCardMode(nextMode);
    themeManager.setTheme(nextThemeId);
  };

  // Delegate to themeManager so theme CSS variables (including derived
  // alpha-tinted variants) have a single source of truth.
  const applyThemeStyles = (theme: ThemeConfig) => {
    themeManager.applyTheme(theme);
  };

  const getThemeNameKey = (themeId: string): string => `theme.name.${themeId}`;
  const getThemeDescKey = (themeId: string): string => `theme.desc.${themeId}`;

  const defaultDarkTheme = predefinedThemes.find(theme => theme.id === THEME_IDS.DEFAULT_DARK)!;
  const defaultLightTheme = predefinedThemes.find(theme => theme.id === THEME_IDS.DEFAULT_LIGHT)!;
  const defaultCardTheme = defaultCardMode === 'dark' ? defaultDarkTheme : defaultLightTheme;
  const visibleThemes = [
    defaultCardTheme,
    ...predefinedThemes.filter(theme => !DEFAULT_THEME_IDS.includes(theme.id)),
  ];

  return (
    <aside className="app-side-panel app-side-panel--theme app-panel-in">
      <header className="app-side-panel__header">
        <div>
          <div className="app-side-panel__eyebrow">{t('theme.title')}</div>
          <h2 className="app-side-panel__title">{t('theme.description')}</h2>
        </div>
        <button type="button" className="app-button-reset app-icon-button" onClick={onClose} aria-label="Close theme panel">
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>
      </header>
      <div className="app-side-panel__body">
        <div className="space-y-3">
          <div className="space-y-2">
            {visibleThemes.map((theme) => {
              const isDefaultCard = theme.id === THEME_IDS.DEFAULT_DARK || theme.id === THEME_IDS.DEFAULT_LIGHT;
              const isCurrent = theme.id === currentThemeId;
              const controls = resolveThemeControls(theme);
              const appearance = resolveThemeAppearance(theme);
              const themeName = isDefaultCard ? t('theme.name.default-combined') : t(getThemeNameKey(theme.id));

              return (
                <div
                  key={isDefaultCard ? 'default-theme-card' : theme.id}
                  className="theme-preview-card group relative overflow-hidden transition-all duration-200"
                  style={{
                    backgroundColor: theme.colors.backgroundSidebar,
                    borderRadius: appearance.surfaceRadius,
                    border: `${appearance.surfaceBorderWidth} solid ${theme.colors.borderLight}`,
                    boxShadow: appearance.surfaceShadow,
                  }}
                >
                  <div className="relative h-24 overflow-hidden">
                    {isDefaultCard && (
                      <div
                        className="absolute right-2 top-2 z-20"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <ThemeModeSwitch
                          checked={defaultCardMode === 'dark'}
                          ariaLabel={defaultCardMode === 'dark' ? t('theme.darkMode') : t('theme.lightMode')}
                          onChange={handleToggleDefaultCardMode}
                        />
                      </div>
                    )}
                    <div
                      className="theme-preview-color absolute inset-0 opacity-80"
                      style={{
                        background: `linear-gradient(135deg, ${theme.colors.backgroundGradientStart}, ${theme.colors.backgroundGradientEnd})`,
                        backgroundColor: theme.colors.backgroundGradientStart,
                      }}
                    />
                    <div
                      className="theme-preview-color absolute left-3 top-3 size-6 opacity-60"
                      style={{ backgroundColor: theme.colors.primary, borderRadius: appearance.buttonRadius }}
                    />
                    <div
                      className="theme-preview-color absolute right-6 top-4 size-3 opacity-40"
                      style={{ backgroundColor: theme.colors.accent, borderRadius: appearance.controlRadius }}
                    />
                    <div
                      className="theme-preview-color absolute bottom-3 right-8 size-4 opacity-30"
                      style={{ backgroundColor: theme.colors.success, borderRadius: appearance.buttonRadius }}
                    />
                    <div
                      className="theme-preview-color absolute bottom-3 left-3 right-3 p-1.5"
                      style={{
                        backgroundColor: controls.panelBackgroundGlassStrong,
                        border: `${appearance.panelBorderWidth} solid ${controls.panelBorder}`,
                        borderRadius: appearance.surfaceRadius,
                        boxShadow: controls.panelShadow,
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="theme-preview-color flex h-6 w-6 items-center justify-center"
                          style={{
                            backgroundColor: controls.primaryButtonBackground,
                            color: controls.primaryButtonForeground,
                            borderRadius: appearance.buttonRadius,
                            boxShadow: controls.primaryButtonShadow,
                          }}
                        >
                          <span className="material-symbols-outlined text-[14px] fill-icon">play_arrow</span>
                        </span>
                        <div
                          className="theme-preview-color flex-1 overflow-hidden"
                          style={{
                            height: '3px',
                            borderRadius: appearance.progressRadius,
                            backgroundColor: controls.sliderTrack,
                          }}
                        >
                          <div
                            className="theme-preview-color h-full w-2/3"
                            style={{ backgroundColor: controls.sliderFill, borderRadius: appearance.progressRadius }}
                          />
                        </div>
                        <span
                          className="theme-preview-color h-6 w-6"
                          style={{ backgroundColor: controls.iconBackgroundActive, borderRadius: appearance.controlRadius }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="theme-preview-color px-3 py-2">
                    <div className="flex items-center gap-2">
                      <h3
                        className="min-w-0 flex-1 truncate text-sm"
                        style={{
                          color: theme.colors.textPrimary,
                          fontFamily: theme.fonts.display || theme.fonts.main,
                          fontWeight: appearance.textHeadingWeight,
                          letterSpacing: appearance.headingLetterSpacing,
                        }}
                      >
                        {themeName}
                      </h3>
                      {isCurrent && (
                        <span
                          className="theme-preview-color flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: theme.colors.primary,
                            color: theme.isDark ? '#ffffff' : '#1a1a1a',
                            borderRadius: appearance.buttonRadius,
                            fontWeight: appearance.textButtonWeight,
                          }}
                        >
                          <span className="material-symbols-outlined text-xs">check</span>
                          {t('theme.applied')}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs" style={{ color: theme.colors.textSecondary }}>
                      {isDefaultCard ? t('theme.desc.default-combined') : t(getThemeDescKey(theme.id))}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleApplyTheme(theme.id)}
                    aria-label={`${isCurrent ? t('theme.applied') : t('theme.apply')}: ${themeName}`}
                    className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <span
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium shadow-lg"
                      style={{
                        backgroundColor: theme.colors.primary,
                        color: theme.isDark ? '#ffffff' : '#1a1a1a',
                        borderRadius: appearance.buttonRadius,
                      }}
                    >
                      <span className="material-symbols-outlined text-sm">{isCurrent ? 'check' : 'arrow_forward'}</span>
                      {isCurrent ? t('theme.applied') : t('theme.apply')}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default ThemePanel;
