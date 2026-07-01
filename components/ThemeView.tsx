import React, { useState, useEffect } from 'react';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig, ThemeId, THEME_IDS } from '../types/theme';
import { predefinedThemes } from '../services/themes/predefinedThemes';
import { useFrostedHeader } from '../hooks/useFrostedHeader';
import { resolveThemeControls } from '../services/themeControls';
import { resolveThemeAppearance } from '../services/themeAppearance';
import RetroSwitch from './RetroSwitch';

interface ThemeViewProps {
  onHeaderHeightChange?: (height: number) => void;
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

const ThemeView: React.FC<ThemeViewProps> = ({ onHeaderHeightChange }) => {
  const { ref: headerBandRef, headerHeight: headerBandHeight, glassUI } = useFrostedHeader(onHeaderHeightChange);
  const [currentThemeId, setCurrentThemeId] = useState<ThemeId>(themeManager.getCurrentThemeId());
  const [defaultCardMode, setDefaultCardMode] = useState<'dark' | 'light'>(
    themeManager.getCurrentThemeId() === THEME_IDS.DEFAULT_LIGHT ? 'light' : 'dark'
  );
  const [, setLanguageVersion] = useState(0);

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

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = i18n.subscribe(() => {
      setLanguageVersion(v => v + 1);
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

  const getThemeNameKey = (themeId: string): string => {
    return `theme.name.${themeId}`;
  };

  const getThemeDescKey = (themeId: string): string => {
    return `theme.desc.${themeId}`;
  };

  const getThemeTagKey = (tag: string): string => {
    const tagMap: Record<string, string> = {
      '默认': 'theme.tag.default',
      '经典': 'theme.tag.classic',
      '商务': 'theme.tag.business',
      '可爱': 'theme.tag.cute',
      '甜美': 'theme.tag.sweet',
      '粉色': 'theme.tag.pink',
      '海洋': 'theme.tag.ocean',
      '蓝色': 'theme.tag.blue',
      '深邃': 'theme.tag.deep',
      '温暖': 'theme.tag.warm',
      '橙色': 'theme.tag.orange',
      '舒适': 'theme.tag.cozy',
      '自然': 'theme.tag.natural',
      '绿色': 'theme.tag.green',
      '清新': 'theme.tag.fresh',
      '神秘': 'theme.tag.mysterious',
      '紫色': 'theme.tag.purple',
      '优雅': 'theme.tag.elegant',
      '浅色': 'theme.tag.light',
      '冷色': 'theme.tag.cool',
      '现代': 'theme.tag.modern',
      '极简': 'theme.tag.minimal',
      '暖色': 'theme.tag.warmColor',
      '简约': 'theme.tag.minimalist',
      '粗粝': 'theme.tag.brutalist',
      '高对比': 'theme.tag.highContrast',
      '黄色': 'theme.tag.yellow',
      'Default': 'theme.tag.default',
      'Classic': 'theme.tag.classic',
      'Business': 'theme.tag.business',
      'Cute': 'theme.tag.cute',
      'Sweet': 'theme.tag.sweet',
      'Pink': 'theme.tag.pink',
      'Ocean': 'theme.tag.ocean',
      'Blue': 'theme.tag.blue',
      'Deep': 'theme.tag.deep',
      'Warm': 'theme.tag.warm',
      'Orange': 'theme.tag.orange',
      'Cozy': 'theme.tag.cozy',
      'Natural': 'theme.tag.natural',
      'Green': 'theme.tag.green',
      'Fresh': 'theme.tag.fresh',
      'Mysterious': 'theme.tag.mysterious',
      'Purple': 'theme.tag.purple',
      'Elegant': 'theme.tag.elegant',
      'Light': 'theme.tag.light',
      'Cool': 'theme.tag.cool',
      'Modern': 'theme.tag.modern',
      'Minimalist': 'theme.tag.minimalist',
      'Warm Color': 'theme.tag.warmColor',
      'Warm Tone': 'theme.tag.warmColor',
      'Brutalist': 'theme.tag.brutalist',
      'High Contrast': 'theme.tag.highContrast',
      'Yellow': 'theme.tag.yellow',
    };
    return tagMap[tag] || '';
  };

  const translateTag = (tag: string): string => {
    const key = getThemeTagKey(tag);
    if (key) {
      const translated = i18n.t(key);
      return translated !== key ? translated : tag;
    }
    return tag;
  };

  const defaultDarkTheme = predefinedThemes.find(theme => theme.id === THEME_IDS.DEFAULT_DARK)!;
  const defaultLightTheme = predefinedThemes.find(theme => theme.id === THEME_IDS.DEFAULT_LIGHT)!;
  const defaultCardTheme = defaultCardMode === 'dark' ? defaultDarkTheme : defaultLightTheme;
  const visibleThemes = [
    defaultCardTheme,
    ...predefinedThemes.filter(theme => !DEFAULT_THEME_IDS.includes(theme.id)),
  ];

  return (
    <div className="w-full flex flex-col h-full relative">
      {/* Header band: in glass mode it overlays the top (z-30) while the grid
          scrolls under the App-level frosted band; measured height pads the
          grid down so it starts below the band. */}
      <div ref={headerBandRef} className={glassUI ? 'relative z-30 flex-shrink-0' : 'flex-shrink-0'}>
      {/* Header */}
      <div className="mb-6 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold" style={{ color: 'var(--theme-text-primary, #fff)' }}>
            {i18n.t('theme.title')}
          </h1>
          <p style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>
            {i18n.t('theme.description')}
          </p>
        </div>
      </div>

      </div>

      {/* Theme Grid - Each card shows its own theme colors (not CSS variables) */}
      <div
        className={glassUI ? 'absolute inset-0 overflow-y-auto no-scrollbar' : 'flex-1 overflow-y-auto no-scrollbar'}
        style={glassUI ? { paddingTop: headerBandHeight } : undefined}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleThemes.map((theme) => {
            const isDefaultCard = theme.id === THEME_IDS.DEFAULT_DARK || theme.id === THEME_IDS.DEFAULT_LIGHT;
            const isCurrent = theme.id === currentThemeId;
            const controls = resolveThemeControls(theme);
            const appearance = resolveThemeAppearance(theme);

            return (
              <div
                key={isDefaultCard ? 'default-theme-card' : theme.id}
                className="theme-preview-card relative overflow-hidden transition-all duration-300 cursor-pointer group"
                style={{
                  backgroundColor: theme.colors.backgroundSidebar,
                  borderRadius: appearance.surfaceRadius,
                  border: `${appearance.surfaceBorderWidth} solid ${theme.colors.borderLight}`,
                  boxShadow: appearance.surfaceShadow,
                }}
              >
                {/* Theme Preview Area - Shows theme's own colors and control style tokens */}
                <div className="h-32 relative overflow-hidden">
                  {isDefaultCard && (
                    <div
                      className="absolute right-3 top-3 z-20"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {currentThemeId === THEME_IDS.BRUTALIST ? (
                        <RetroSwitch
                          checked={defaultCardMode === 'dark'}
                          ariaLabel={defaultCardMode === 'dark' ? i18n.t('theme.darkMode') : i18n.t('theme.lightMode')}
                          onChange={handleToggleDefaultCardMode}
                        />
                      ) : (
                        <ThemeModeSwitch
                          checked={defaultCardMode === 'dark'}
                          ariaLabel={defaultCardMode === 'dark' ? i18n.t('theme.darkMode') : i18n.t('theme.lightMode')}
                          onChange={handleToggleDefaultCardMode}
                        />
                      )}
                    </div>
                  )}
                  <div
                    className="theme-preview-color absolute inset-0 opacity-80"
                    style={{
                      background: `linear-gradient(135deg, ${theme.colors.backgroundGradientStart}, ${theme.colors.backgroundGradientEnd})`,
                      backgroundColor: theme.colors.backgroundGradientStart,
                    }}
                  />
                  {/* Decorative elements */}
                  <div
                    className="theme-preview-color absolute top-4 left-4 w-8 h-8 opacity-60"
                    style={{ backgroundColor: theme.colors.primary, borderRadius: appearance.buttonRadius }}
                  />
                  <div
                    className="theme-preview-color absolute top-6 right-8 w-4 h-4 opacity-40"
                    style={{ backgroundColor: theme.colors.accent, borderRadius: appearance.controlRadius }}
                  />
                  <div
                    className="theme-preview-color absolute bottom-4 right-12 w-6 h-6 opacity-30"
                    style={{ backgroundColor: theme.colors.success, borderRadius: appearance.buttonRadius }}
                  />
                  <div
                    className="theme-preview-color absolute left-4 right-4 bottom-4 p-2"
                    style={{
                      backgroundColor: controls.panelBackgroundGlassStrong,
                      border: `${appearance.panelBorderWidth} solid ${controls.panelBorder}`,
                      borderRadius: appearance.surfaceRadius,
                      boxShadow: controls.panelShadow,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="theme-preview-color flex h-7 w-7 items-center justify-center"
                        style={{
                          backgroundColor: controls.primaryButtonBackground,
                          color: controls.primaryButtonForeground,
                          borderRadius: appearance.buttonRadius,
                          boxShadow: controls.primaryButtonShadow,
                        }}
                      >
                        <span className="material-symbols-outlined text-[16px] fill-icon">play_arrow</span>
                      </span>
                      <div
                        className="theme-preview-color flex-1 overflow-hidden"
                        style={{
                          height: appearance.progressHeight,
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
                        className="theme-preview-color h-7 w-7"
                        style={{ backgroundColor: controls.iconBackgroundActive, borderRadius: appearance.controlRadius }}
                      />
                    </div>
                  </div>
                </div>

                {/* Theme Info - Shows theme's own colors */}
                <div className="theme-preview-color p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3
                      className="text-lg"
                      style={{
                        color: theme.colors.textPrimary,
                        fontFamily: theme.fonts.display || theme.fonts.main,
                        fontWeight: appearance.textHeadingWeight,
                        letterSpacing: appearance.headingLetterSpacing,
                      }}
                    >
                      {isDefaultCard ? i18n.t('theme.name.default-combined') : i18n.t(getThemeNameKey(theme.id))}
                    </h3>
                    {isCurrent && (
                      <span
                        className="theme-preview-color px-2 py-1 text-xs flex items-center gap-1"
                        style={{
                          backgroundColor: theme.colors.primary,
                          color: theme.isDark ? '#ffffff' : '#1a1a1a',
                          borderRadius: appearance.buttonRadius,
                          fontWeight: appearance.textButtonWeight,
                        }}
                      >
                        <span className="material-symbols-outlined text-sm">check</span>
                        {i18n.t('theme.applied')}
                      </span>
                    )}
                  </div>

                  <p
                    className="text-sm mb-3"
                    style={{ color: theme.colors.textSecondary }}
                  >
                    {isDefaultCard ? i18n.t('theme.desc.default-combined') : i18n.t(getThemeDescKey(theme.id))}
                  </p>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {theme.tags.map((tag) => (
                      <span
                        key={tag}
                        className="theme-preview-color px-2 py-0.5 text-xs"
                        style={{
                          backgroundColor: theme.colors.backgroundCardHover,
                          color: theme.colors.textMuted,
                          borderRadius: appearance.buttonRadius,
                          fontWeight: appearance.textButtonWeight,
                          letterSpacing: appearance.buttonLetterSpacing,
                          textTransform: appearance.controlTextTransform as React.CSSProperties['textTransform'],
                        }}
                      >
                        {translateTag(tag)}
                      </span>
                    ))}
                  </div>

                  {/* Mode badge */}
                  <div className="flex items-center gap-1 text-xs" style={{ color: theme.colors.textMuted }}>
                    <span className="material-symbols-outlined text-sm">
                      {theme.isDark ? 'dark_mode' : 'light_mode'}
                    </span>
                    <span>{theme.isDark ? i18n.t('theme.darkMode') : i18n.t('theme.lightMode')}</span>
                  </div>
                </div>

                {/* Apply Button Overlay */}
                <div
                  className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    backdropFilter: 'blur(4px)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleApplyTheme(theme.id);
                  }}
                >
                  <button
                    className="px-6 py-3 transition-transform transform hover:scale-105"
                    style={{
                      backgroundColor: theme.colors.primary,
                      color: theme.isDark ? '#ffffff' : '#1a1a1a',
                      borderRadius: appearance.buttonRadius,
                      fontWeight: appearance.textButtonWeight,
                      letterSpacing: appearance.buttonLetterSpacing,
                      textTransform: appearance.controlTextTransform as React.CSSProperties['textTransform'],
                    }}
                  >
                    {isCurrent ? i18n.t('theme.applied') : i18n.t('theme.apply')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};

export default ThemeView;
