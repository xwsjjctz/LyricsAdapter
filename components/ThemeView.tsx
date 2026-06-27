import React, { useEffect, useMemo, useRef, useState } from 'react';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig, ThemeId } from '../types/theme';
import { predefinedThemes } from '../services/themes/predefinedThemes';
import { useFrostedHeader } from '../hooks/useFrostedHeader';

interface ThemeViewProps {
  onHeaderHeightChange?: (height: number) => void;
}

const tagKeys: Record<string, string> = {
  '默认': 'theme.tag.default',
  '经典': 'theme.tag.classic',
  '商务': 'theme.tag.business',
  '神秘': 'theme.tag.mysterious',
  '紫色': 'theme.tag.purple',
  '优雅': 'theme.tag.elegant',
  '浅色': 'theme.tag.light',
  '暖色': 'theme.tag.warmColor',
  '简约': 'theme.tag.minimalist',
  '自然': 'theme.tag.natural',
  '绿色': 'theme.tag.green',
  '清新': 'theme.tag.fresh',
};

function tThemeName(themeId: string): string {
  return i18n.t(`theme.name.${themeId}`);
}

function tThemeDescription(themeId: string): string {
  return i18n.t(`theme.desc.${themeId}`);
}

function tTag(tag: string): string {
  const key = tagKeys[tag];
  if (!key) return tag;
  const translated = i18n.t(key);
  return translated === key ? tag : translated;
}

function ThemeMiniPreview({ theme }: { theme: ThemeConfig }) {
  const colors = theme.colors;

  return (
    <div
      className="h-48 rounded-xl overflow-hidden border shadow-inner"
      style={{
        background: colors.mainBackground,
        borderColor: colors.borderLight,
        boxShadow: `inset 0 1px 0 ${colors.borderLight}`,
      }}
    >
      <div className="flex h-full">
        <div
          className="w-20 p-3 border-r"
          style={{
            backgroundColor: colors.backgroundSidebar,
            borderColor: colors.divider,
          }}
        >
          <div className="h-3 w-10 rounded-full mb-5" style={{ backgroundColor: colors.textMuted }} />
          <div className="space-y-2">
            <div className="h-8 rounded-lg" style={{ backgroundColor: colors.controlActive }} />
            <div className="h-8 rounded-lg" style={{ backgroundColor: colors.control }} />
          </div>
        </div>
        <div className="flex-1 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-3 w-24 rounded-full mb-2" style={{ backgroundColor: colors.textPrimary }} />
              <div className="h-2 w-16 rounded-full" style={{ backgroundColor: colors.textMuted }} />
            </div>
            <div className="h-8 w-8 rounded-lg" style={{ backgroundColor: colors.control }} />
          </div>
          <div
            className="flex-1 rounded-xl border p-3"
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.borderLight,
              boxShadow: `0 18px 44px -30px ${colors.shadowColor}`,
            }}
          >
            <div className="h-8 rounded-lg mb-3" style={{ backgroundColor: colors.surfaceElevated }} />
            <div className="grid grid-cols-[32px_1fr_48px] gap-3 items-center">
              <div className="h-8 w-8 rounded-md" style={{ backgroundColor: colors.primary }} />
              <div className="space-y-2">
                <div className="h-2.5 rounded-full" style={{ backgroundColor: colors.textSecondary }} />
                <div className="h-2 w-2/3 rounded-full" style={{ backgroundColor: colors.textMuted }} />
              </div>
              <div className="h-2 rounded-full" style={{ backgroundColor: colors.accent }} />
            </div>
          </div>
          <div
            className="h-9 rounded-xl border flex items-center gap-2 px-3"
            style={{
              backgroundColor: colors.control,
              borderColor: colors.borderLight,
            }}
          >
            <div className="h-5 w-5 rounded-full" style={{ backgroundColor: colors.textPrimary }} />
            <div className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: colors.borderHover }}>
              <div className="h-full w-2/5 rounded-full" style={{ backgroundColor: colors.primary }} />
            </div>
            <div className="h-2 w-8 rounded-full" style={{ backgroundColor: colors.textMuted }} />
          </div>
        </div>
      </div>
    </div>
  );
}

const ThemeView: React.FC<ThemeViewProps> = ({ onHeaderHeightChange }) => {
  const { ref: headerBandRef, headerHeight: headerBandHeight, glassUI } = useFrostedHeader(onHeaderHeightChange);
  const [currentThemeId, setCurrentThemeId] = useState<ThemeId>(themeManager.getCurrentThemeId());
  const [previewTheme, setPreviewTheme] = useState<ThemeConfig | null>(null);
  const previewThemeRef = useRef<ThemeConfig | null>(null);
  const [, setLanguageVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = themeManager.subscribe((themeId) => {
      setCurrentThemeId(themeId);
      setPreviewTheme(null);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = i18n.subscribe(() => setLanguageVersion(v => v + 1));
    return unsubscribe;
  }, []);

  useEffect(() => {
    themeManager.applyCurrentTheme();
  }, []);

  useEffect(() => {
    previewThemeRef.current = previewTheme;
  }, [previewTheme]);

  useEffect(() => {
    return () => {
      if (previewThemeRef.current) {
        themeManager.applyCurrentTheme();
      }
    };
  }, []);

  const currentTheme = useMemo(
    () => predefinedThemes.find(theme => theme.id === currentThemeId) || predefinedThemes[0]!,
    [currentThemeId]
  );
  const displayedTheme = previewTheme || currentTheme;

  const handlePreviewTheme = (theme: ThemeConfig) => {
    setPreviewTheme(theme.id === currentThemeId ? null : theme);
    themeManager.applyTheme(theme);
  };

  const handleApplyTheme = (themeId: ThemeId) => {
    themeManager.setTheme(themeId);
  };

  const handleResetTheme = () => {
    setPreviewTheme(null);
    themeManager.applyTheme(currentTheme);
  };

  return (
    <div className="w-full flex flex-col h-full relative">
      <div ref={headerBandRef} className={glassUI ? 'relative z-30 flex-shrink-0' : 'flex-shrink-0'}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold" style={{ color: 'var(--theme-text-primary)' }}>
              {i18n.t('theme.title')}
            </h1>
            <p className="mt-1" style={{ color: 'var(--theme-text-muted)' }}>
              {i18n.t('theme.description')}
            </p>
          </div>
          {previewTheme && (
            <button
              onClick={handleResetTheme}
              className="px-4 py-2 rounded-lg text-sm font-semibold border transition-colors"
              style={{
                backgroundColor: 'var(--theme-control)',
                borderColor: 'var(--theme-border-light)',
                color: 'var(--theme-text-primary)',
              }}
            >
              {i18n.t('common.cancel')}
            </button>
          )}
        </div>

        <div
          className="mb-5 rounded-xl border p-4 flex items-center gap-4"
          style={{
            backgroundColor: 'var(--theme-surface)',
            borderColor: 'var(--theme-border-light)',
            boxShadow: '0 18px 50px -34px var(--theme-shadow-color)',
          }}
        >
          <div
            className="size-11 rounded-xl flex items-center justify-center"
            style={{
              backgroundColor: 'var(--theme-control-active)',
              color: 'var(--theme-primary)',
            }}
          >
            <span className="material-symbols-outlined text-[24px]">{displayedTheme.icon}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" style={{ color: 'var(--theme-text-secondary)' }}>
              {previewTheme ? i18n.t('theme.preview') : i18n.t('theme.current')}
            </p>
            <p className="text-xl font-extrabold truncate" style={{ color: 'var(--theme-text-primary)' }}>
              {tThemeName(displayedTheme.id)}
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2">
            <span className="size-4 rounded-full" style={{ backgroundColor: 'var(--theme-primary)' }} />
            <span className="size-4 rounded-full" style={{ backgroundColor: 'var(--theme-accent)' }} />
            <span className="size-4 rounded-full" style={{ backgroundColor: 'var(--theme-success)' }} />
          </div>
        </div>
      </div>

      <div
        className={glassUI ? 'absolute inset-0 overflow-y-auto no-scrollbar' : 'flex-1 overflow-y-auto no-scrollbar'}
        style={glassUI ? { paddingTop: headerBandHeight } : undefined}
      >
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 pb-5">
          {predefinedThemes.map((theme) => {
            const isCurrent = theme.id === currentThemeId;
            const isPreview = previewTheme?.id === theme.id;
            const isActive = isCurrent || isPreview;

            return (
              <article
                key={theme.id}
                className="rounded-xl border p-4 transition-all duration-200"
                style={{
                  backgroundColor: isActive ? 'var(--theme-surface-elevated)' : 'var(--theme-surface)',
                  borderColor: isActive ? theme.colors.primary : 'var(--theme-border-light)',
                  boxShadow: isActive
                    ? `0 20px 56px -36px ${theme.colors.glowColor}, 0 0 0 1px ${theme.colors.focusRing}`
                    : '0 16px 42px -34px var(--theme-shadow-color)',
                }}
              >
                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => handlePreviewTheme(theme)}
                  aria-pressed={isActive}
                >
                  <ThemeMiniPreview theme={theme} />
                  <div className="mt-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-extrabold truncate" style={{ color: 'var(--theme-text-primary)' }}>
                          {tThemeName(theme.id)}
                        </h2>
                        {isCurrent && (
                          <span
                            className="rounded-full px-2 py-1 text-xs font-semibold"
                            style={{ backgroundColor: 'var(--theme-control-active)', color: 'var(--theme-primary)' }}
                          >
                            {i18n.t('theme.applied')}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--theme-text-secondary)' }}>
                        {tThemeDescription(theme.id)}
                      </p>
                    </div>
                    <span
                      className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                      style={{
                        backgroundColor: isActive ? theme.colors.controlActive : 'var(--theme-control)',
                        color: isActive ? theme.colors.primary : 'var(--theme-text-secondary)',
                      }}
                    >
                      <span className="material-symbols-outlined text-[22px]">
                        {theme.isDark ? 'dark_mode' : 'light_mode'}
                      </span>
                    </span>
                  </div>
                </button>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {theme.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{
                          backgroundColor: 'var(--theme-surface-muted)',
                          color: 'var(--theme-text-muted)',
                        }}
                      >
                        {tTag(tag)}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApplyTheme(theme.id)}
                    disabled={isCurrent}
                    className="rounded-lg px-4 py-2 text-sm font-bold transition-transform disabled:cursor-default disabled:opacity-80 enabled:hover:scale-[1.02]"
                    style={{
                      backgroundColor: isCurrent ? 'var(--theme-control-active)' : theme.colors.primary,
                      color: isCurrent ? 'var(--theme-primary)' : theme.colors.textOnPrimary,
                    }}
                  >
                    {isCurrent ? i18n.t('theme.applied') : i18n.t('theme.apply')}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ThemeView;
