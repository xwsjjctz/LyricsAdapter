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
      className="h-24 rounded-lg overflow-hidden border shadow-inner"
      style={{
        background: colors.mainBackground,
        borderColor: colors.borderLight,
        boxShadow: `inset 0 1px 0 ${colors.borderLight}`,
      }}
    >
      <div className="flex h-full">
        <div
          className="w-12 p-2 border-r"
          style={{
            backgroundColor: colors.backgroundSidebar,
            borderColor: colors.divider,
          }}
        >
          <div className="h-2 w-7 rounded-full mb-4" style={{ backgroundColor: colors.textMuted }} />
          <div className="space-y-1.5">
            <div className="h-6 rounded-md" style={{ backgroundColor: colors.controlActive }} />
            <div className="h-6 rounded-md" style={{ backgroundColor: colors.control }} />
          </div>
        </div>
        <div className="flex-1 p-2.5 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-2.5 w-16 rounded-full mb-1.5" style={{ backgroundColor: colors.textPrimary }} />
              <div className="h-1.5 w-11 rounded-full" style={{ backgroundColor: colors.textMuted }} />
            </div>
            <div className="h-6 w-6 rounded-md" style={{ backgroundColor: colors.control }} />
          </div>
          <div
            className="flex-1 rounded-lg border p-2"
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.borderLight,
              boxShadow: `0 12px 30px -24px ${colors.shadowColor}`,
            }}
          >
            <div className="h-6 rounded-md mb-2" style={{ backgroundColor: colors.surfaceElevated }} />
            <div className="grid grid-cols-[24px_1fr_34px] gap-2 items-center">
              <div className="h-6 w-6 rounded-md" style={{ backgroundColor: colors.primary }} />
              <div className="space-y-1.5">
                <div className="h-1.5 rounded-full" style={{ backgroundColor: colors.textSecondary }} />
                <div className="h-1.5 w-2/3 rounded-full" style={{ backgroundColor: colors.textMuted }} />
              </div>
              <div className="h-1.5 rounded-full" style={{ backgroundColor: colors.accent }} />
            </div>
          </div>
          <div
            className="h-5 rounded-md border flex items-center gap-1.5 px-2"
            style={{
              backgroundColor: colors.control,
              borderColor: colors.borderLight,
            }}
          >
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: colors.textPrimary }} />
            <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: colors.borderHover }}>
              <div className="h-full w-2/5 rounded-full" style={{ backgroundColor: colors.primary }} />
            </div>
            <div className="h-1 w-5 rounded-full" style={{ backgroundColor: colors.textMuted }} />
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
          className="mb-4 rounded-xl border p-3 flex items-center gap-3"
          style={{
            backgroundColor: 'var(--theme-surface)',
            borderColor: 'var(--theme-border-light)',
            boxShadow: '0 14px 36px -30px var(--theme-shadow-color)',
          }}
        >
          <div
            className="size-10 rounded-lg flex items-center justify-center"
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
        <div className="grid max-w-[960px] grid-cols-2 xl:grid-cols-4 gap-3 pb-24 md:pb-5">
          {predefinedThemes.map((theme) => {
            const isCurrent = theme.id === currentThemeId;
            const isPreview = previewTheme?.id === theme.id;
            const isActive = isCurrent || isPreview;

            return (
              <article
                key={theme.id}
                className="relative flex aspect-square min-h-[224px] flex-col rounded-xl border p-3 transition-all duration-200"
                style={{
                  background: isActive
                    ? `linear-gradient(180deg, ${theme.colors.primaryLight} 0%, var(--theme-surface-elevated) 46%, var(--theme-surface) 100%)`
                    : 'var(--theme-surface)',
                  borderColor: isActive ? theme.colors.primary : 'var(--theme-border-light)',
                  borderWidth: isActive ? 2 : 1,
                  boxShadow: isActive
                    ? `0 18px 42px -30px ${theme.colors.glowColor}, 0 0 0 3px ${theme.colors.focusRing}, inset 0 1px 0 ${theme.colors.borderLight}`
                    : '0 14px 34px -30px var(--theme-shadow-color)',
                }}
              >
                {isActive && (
                  <span
                    className="absolute right-3 top-3 z-10 flex size-7 items-center justify-center rounded-full shadow-lg"
                    style={{
                      backgroundColor: theme.colors.primary,
                      color: theme.colors.textOnPrimary,
                      boxShadow: `0 10px 24px -12px ${theme.colors.glowColor}`,
                    }}
                  >
                    <span className="material-symbols-outlined text-[18px]">check</span>
                  </span>
                )}
                <button
                  type="button"
                  className="block w-full flex-1 text-left"
                  onClick={() => handlePreviewTheme(theme)}
                  aria-pressed={isActive}
                >
                  <ThemeMiniPreview theme={theme} />
                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-extrabold truncate" style={{ color: 'var(--theme-text-primary)' }}>
                          {tThemeName(theme.id)}
                        </h2>
                        {isCurrent && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ backgroundColor: 'var(--theme-control-active)', color: 'var(--theme-primary)' }}
                          >
                            {i18n.t('theme.applied')}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-5" style={{ color: 'var(--theme-text-secondary)' }}>
                        {tThemeDescription(theme.id)}
                      </p>
                    </div>
                    <span
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        backgroundColor: isActive ? theme.colors.controlActive : 'var(--theme-control)',
                        color: isActive ? theme.colors.primary : 'var(--theme-text-secondary)',
                      }}
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {theme.isDark ? 'dark_mode' : 'light_mode'}
                      </span>
                    </span>
                  </div>
                </button>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    {theme.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
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
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition-transform disabled:cursor-default disabled:opacity-100 enabled:hover:scale-[1.02]"
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
