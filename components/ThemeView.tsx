import React, { useState, useEffect } from 'react';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig, THEME_IDS, ThemeId } from '../types/theme';
import { predefinedThemes } from '../services/themes/predefinedThemes';

const ThemeView: React.FC = () => {
  const [currentThemeId, setCurrentThemeId] = useState<ThemeId>(themeManager.getCurrentThemeId());
  const [previewTheme, setPreviewTheme] = useState<ThemeConfig | null>(null);
  const [languageVersion, setLanguageVersion] = useState(0);

  // Subscribe to theme changes
  useEffect(() => {
    const unsubscribe = themeManager.subscribe((themeId) => {
      setCurrentThemeId(themeId);
      setPreviewTheme(null);
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

  const handlePreviewTheme = (theme: ThemeConfig) => {
    setPreviewTheme(theme);
    applyThemeStyles(theme);
  };

  const handleResetTheme = () => {
    setPreviewTheme(null);
    const currentTheme = themeManager.getCurrentTheme();
    applyThemeStyles(currentTheme);
  };

  const applyThemeStyles = (theme: ThemeConfig) => {
    const root = document.documentElement;
    const colors = theme.colors;

    root.style.setProperty('--theme-primary', colors.primary);
    root.style.setProperty('--theme-primary-hover', colors.primaryHover);
    root.style.setProperty('--theme-primary-light', colors.primaryLight);
    root.style.setProperty('--theme-background-dark', colors.backgroundDark);
    root.style.setProperty('--theme-background-gradient-start', colors.backgroundGradientStart);
    root.style.setProperty('--theme-background-gradient-end', colors.backgroundGradientEnd);
    root.style.setProperty('--theme-background-sidebar', colors.backgroundSidebar);
    root.style.setProperty('--theme-background-card', colors.backgroundCard);
    root.style.setProperty('--theme-background-card-hover', colors.backgroundCardHover);
    root.style.setProperty('--theme-text-primary', colors.textPrimary);
    root.style.setProperty('--theme-text-secondary', colors.textSecondary);
    root.style.setProperty('--theme-text-muted', colors.textMuted);
    root.style.setProperty('--theme-border-light', colors.borderLight);
    root.style.setProperty('--theme-border-hover', colors.borderHover);
    root.style.setProperty('--theme-accent', colors.accent);
    root.style.setProperty('--theme-accent-hover', colors.accentHover);
    root.style.setProperty('--theme-success', colors.success);
    root.style.setProperty('--theme-warning', colors.warning);
    root.style.setProperty('--theme-error', colors.error);
    root.style.setProperty('--theme-info', colors.info);
    root.style.setProperty('--theme-shadow-color', colors.shadowColor);
    root.style.setProperty('--theme-glow-color', colors.glowColor);
    root.style.setProperty('--theme-radius-sm', theme.borderRadius.sm);
    root.style.setProperty('--theme-radius-md', theme.borderRadius.md);
    root.style.setProperty('--theme-radius-lg', theme.borderRadius.lg);
    root.style.setProperty('--theme-radius-xl', theme.borderRadius.xl);
    root.style.setProperty('--theme-radius-full', theme.borderRadius.full);

    // Add/remove cute theme class for font
    if (theme.id === THEME_IDS.CUTE) {
      root.classList.add('theme-cute');
      document.body.classList.add('theme-cute');
    } else {
      root.classList.remove('theme-cute');
      document.body.classList.remove('theme-cute');
    }
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

  return (
    <div className="max-w-6xl mx-auto w-full flex flex-col h-full">
      {/* Header */}
      <div className="mb-6 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold mb-2" style={{ color: 'var(--theme-text-primary, #fff)' }}>
            {i18n.t('theme.title')}
          </h1>
          <p style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>
            {i18n.t('theme.description')}
          </p>
        </div>
        {previewTheme && (
          <button
            onClick={handleResetTheme}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80"
            style={{
              backgroundColor: 'var(--theme-background-card, rgba(255,255,255,0.05))',
              border: '1px solid var(--theme-border-light, rgba(255,255,255,0.1))',
              color: 'var(--theme-text-primary, #fff)',
            }}
          >
            {i18n.t('common.cancel')}
          </button>
        )}
      </div>

      {/* Current Theme Info - Uses CSS variables to reflect current theme */}
      <div className="mb-6 p-4 rounded-xl" style={{
        backgroundColor: 'var(--theme-background-card, rgba(255,255,255,0.05))',
        border: '1px solid var(--theme-border-light, rgba(255,255,255,0.1))',
      }}>
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-2xl" style={{ color: 'var(--theme-primary, #2b8cee)' }}>
            checkroom
          </span>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--theme-text-secondary, rgba(255,255,255,0.7))' }}>
              {i18n.t('theme.current')}
            </p>
            <p className="text-lg font-bold" style={{ color: 'var(--theme-text-primary, #fff)' }}>
              {i18n.t(getThemeNameKey(currentThemeId))}
            </p>
          </div>
        </div>
      </div>

      {/* Theme Grid - Each card shows its own theme colors (not CSS variables) */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {predefinedThemes.map((theme) => {
            const isCurrent = theme.id === currentThemeId;
            const isPreview = previewTheme?.id === theme.id;

            return (
              <div
                key={theme.id}
                className={`relative rounded-2xl overflow-hidden transition-all duration-300 cursor-pointer group ${
                  isPreview ? 'ring-2 ring-offset-2 ring-offset-transparent' : ''
                }`}
                style={{
                  backgroundColor: theme.colors.backgroundCard,
                  boxShadow: isPreview ? `0 0 0 2px ${theme.colors.primary}` : undefined,
                }}
                onClick={() => handlePreviewTheme(theme)}
              >
                {/* Theme Preview Area - Shows theme's own colors */}
                <div className="h-32 relative overflow-hidden">
                  <div
                    className="absolute inset-0 opacity-80"
                    style={{
                      background: `linear-gradient(135deg, ${theme.colors.backgroundGradientStart}, ${theme.colors.backgroundGradientEnd})`,
                    }}
                  />
                  {/* Decorative elements */}
                  <div
                    className="absolute top-4 left-4 w-8 h-8 rounded-full opacity-60"
                    style={{ backgroundColor: theme.colors.primary }}
                  />
                  <div
                    className="absolute top-6 right-8 w-4 h-4 rounded-lg opacity-40"
                    style={{ backgroundColor: theme.colors.accent }}
                  />
                  <div
                    className="absolute bottom-4 right-12 w-6 h-6 rounded-full opacity-30"
                    style={{ backgroundColor: theme.colors.success }}
                  />
                </div>

                {/* Theme Info - Shows theme's own colors */}
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3
                      className="text-lg font-bold"
                      style={{ color: theme.colors.textPrimary }}
                    >
                      {i18n.t(getThemeNameKey(theme.id))}
                    </h3>
                    {isCurrent && (
                      <span
                        className="px-2 py-1 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: theme.colors.primaryLight,
                          color: theme.colors.primary,
                        }}
                      >
                        {i18n.t('theme.applied')}
                      </span>
                    )}
                  </div>

                  <p
                    className="text-sm mb-3"
                    style={{ color: theme.colors.textSecondary }}
                  >
                    {i18n.t(getThemeDescKey(theme.id))}
                  </p>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {theme.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-full text-xs"
                        style={{
                          backgroundColor: theme.colors.backgroundCardHover,
                          color: theme.colors.textMuted,
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
                  className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
                    isPreview ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
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
                    className="px-6 py-3 rounded-full font-semibold transition-transform transform hover:scale-105"
                    style={{
                      backgroundColor: theme.colors.primary,
                      color: theme.isDark ? '#ffffff' : '#1a1a1a',
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
