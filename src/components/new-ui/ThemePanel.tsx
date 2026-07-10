import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { themeManager } from '../../services/themeManager';
import { ThemeConfig, ThemeId, THEME_IDS } from '../../types/theme';
import { predefinedThemes } from '../../services/themes/predefinedThemes';
import { resolveThemeAppearance } from '../../services/themeAppearance';

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
      const translated = t(key);
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
    <aside className="new-ux-side-panel new-ux-side-panel--theme new-ux-panel-in">
      <header className="new-ux-side-panel__header">
        <div>
          <div className="new-ux-side-panel__eyebrow">{t('theme.title')}</div>
          <h2 className="new-ux-side-panel__title">{t('theme.description')}</h2>
        </div>
        <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onClose} aria-label="Close theme panel">
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>
      </header>
      <div className="new-ux-side-panel__body">
        <div className="space-y-3">
          <section
            className="relative flex min-h-[76px] items-center gap-3 overflow-hidden rounded-2xl border px-3 py-3"
            style={{
              background: 'linear-gradient(135deg, rgba(32, 43, 88, 0.96), rgba(54, 31, 85, 0.96))',
              borderColor: 'rgba(164, 132, 255, 0.48)',
              boxShadow: '0 12px 28px rgba(10, 8, 32, 0.24)',
            }}
          >
            <div className="absolute -right-5 -top-8 size-28 rounded-full bg-violet-300/20 blur-2xl" />
            <span className="material-symbols-outlined relative text-3xl text-violet-200">auto_awesome</span>
            <div className="relative min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-white">{t('settings.newUx')}</h3>
              <p className="mt-0.5 truncate text-xs text-violet-100/75">{t('settings.newUxDesc')}</p>
            </div>
            <span className="relative flex shrink-0 items-center gap-1 rounded-full bg-violet-100/15 px-2 py-1 text-[11px] font-medium text-violet-50">
              <span className="material-symbols-outlined text-sm">check</span>
              {t('theme.applied')}
            </span>
          </section>

          <div className="space-y-2.5">
          {visibleThemes.map((theme) => {
            const isDefaultCard = theme.id === THEME_IDS.DEFAULT_DARK || theme.id === THEME_IDS.DEFAULT_LIGHT;
            const isCurrent = theme.id === currentThemeId;
            const appearance = resolveThemeAppearance(theme);

            return (
              <div
                key={isDefaultCard ? 'default-theme-card' : theme.id}
                className="theme-preview-card flex min-h-[88px] overflow-hidden transition-shadow duration-200"
                style={{
                  backgroundColor: theme.colors.backgroundSidebar,
                  borderRadius: appearance.surfaceRadius,
                  border: `${appearance.surfaceBorderWidth} solid ${theme.colors.borderLight}`,
                  boxShadow: appearance.surfaceShadow,
                }}
              >
                <div className="relative w-24 shrink-0 overflow-hidden">
                  {isDefaultCard && (
                    <div
                      className="absolute right-2 top-2 z-10"
                    >
                      <ThemeModeSwitch
                        checked={defaultCardMode === 'dark'}
                        ariaLabel={defaultCardMode === 'dark' ? t('theme.darkMode') : t('theme.lightMode')}
                        onChange={handleToggleDefaultCardMode}
                      />
                    </div>
                  )}
                  <div
                    className="theme-preview-color absolute inset-0"
                    style={{
                      background: `linear-gradient(135deg, ${theme.colors.backgroundGradientStart}, ${theme.colors.backgroundGradientEnd})`,
                      backgroundColor: theme.colors.backgroundGradientStart,
                    }}
                  />
                  <div
                    className="theme-preview-color absolute -right-4 -top-4 size-14 opacity-45"
                    style={{ backgroundColor: theme.colors.accent, borderRadius: appearance.buttonRadius }}
                  />
                  <div
                    className="theme-preview-color absolute bottom-3 left-3 flex size-9 items-center justify-center"
                    style={{
                      backgroundColor: theme.colors.primary,
                      color: theme.isDark ? '#ffffff' : '#1a1a1a',
                      borderRadius: appearance.buttonRadius,
                    }}
                  >
                    <span className="material-symbols-outlined text-lg">palette</span>
                  </div>
                </div>

                <div className="theme-preview-color min-w-0 flex-1 px-3 py-2.5">
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
                      {isDefaultCard ? t('theme.name.default-combined') : t(getThemeNameKey(theme.id))}
                    </h3>
                    {isCurrent && (
                      <span
                        className="theme-preview-color flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[11px]"
                        style={{
                          backgroundColor: theme.colors.primary,
                          color: theme.isDark ? '#ffffff' : '#1a1a1a',
                          borderRadius: appearance.buttonRadius,
                          fontWeight: appearance.textButtonWeight,
                        }}
                      >
                        <span className="material-symbols-outlined text-sm">check</span>
                        {t('theme.applied')}
                      </span>
                    )}
                  </div>

                  <p
                    className="mt-1 truncate text-xs"
                    style={{ color: theme.colors.textSecondary }}
                  >
                    {isDefaultCard ? t('theme.desc.default-combined') : t(getThemeDescKey(theme.id))}
                  </p>

                  <div className="mt-2 flex gap-1 overflow-hidden">
                    {theme.tags.slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="theme-preview-color shrink-0 px-1.5 py-0.5 text-[10px]"
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
                </div>

                <button
                  type="button"
                  onClick={() => handleApplyTheme(theme.id)}
                  aria-label={`${isCurrent ? t('theme.applied') : t('theme.apply')}: ${isDefaultCard ? t('theme.name.default-combined') : t(getThemeNameKey(theme.id))}`}
                  className="flex w-10 shrink-0 items-center justify-center transition-colors"
                  style={{
                    backgroundColor: isCurrent ? `${theme.colors.primary}18` : theme.colors.backgroundCardHover,
                    color: isCurrent ? theme.colors.primary : theme.colors.textSecondary,
                  }}
                >
                  <span className="material-symbols-outlined text-lg">{isCurrent ? 'check' : 'arrow_forward'}</span>
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
