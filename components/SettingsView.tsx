import React, { useState, useEffect, useRef } from 'react';
import { i18n, type Language } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';
import ShortcutsSettings from './ShortcutsSettings';

interface SettingsViewProps {}

const SettingsView: React.FC<SettingsViewProps> = () => {
  const [currentLang, setCurrentLang] = useState<Language>(i18n.getLanguage());
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = i18n.subscribe((lang) => {
      setCurrentLang(lang);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  const colors = currentTheme.colors;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsLangDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLanguageChange = (lang: Language) => {
    i18n.setLanguage(lang);
    setIsLangDropdownOpen(false);
  };

  const languageOptions: { value: Language; label: string; nativeLabel: string }[] = [
    { value: 'zh', label: i18n.t('settings.language.zh'), nativeLabel: '中文' },
    { value: 'en', label: i18n.t('settings.language.en'), nativeLabel: 'English' },
    { value: 'ja', label: i18n.t('settings.language.ja'), nativeLabel: '日本語' },
    { value: 'ko', label: i18n.t('settings.language.ko'), nativeLabel: '한국어' },
    { value: 'de', label: i18n.t('settings.language.de'), nativeLabel: 'Deutsch' },
    { value: 'fr', label: i18n.t('settings.language.fr'), nativeLabel: 'Français' }
  ];

  const currentLanguageOption = languageOptions.find(opt => opt.value === currentLang);

  return (
    <div className="w-full flex flex-col h-full">
      {/* Header */}
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold mb-2" style={{ color: 'var(--theme-text-primary, #fff)' }}>{i18n.t('settings.title')}</h1>
          <p style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>{i18n.t('settings.description')}</p>
        </div>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto no-scrollbar">

          {/* 语言和关于合并为紧凑的双列布局 */}
          <section className="mb-4">
            <div className="grid grid-cols-2 gap-3">
              {/* Language Setting */}
              <div className="rounded-lg p-3 border transition-colors" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined text-lg" style={{ color: colors.primary }}>language</span>
                    <span className="text-sm truncate" style={{ color: colors.textPrimary }}>{i18n.t('settings.language')}</span>
                  </div>
                  <div className="relative" ref={dropdownRef}>
                    <button
                      onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-sm transition-all"
                      style={{ backgroundColor: colors.backgroundCard, border: `1px solid ${colors.borderLight}`, color: colors.textSecondary }}
                    >
                      <span>{currentLanguageOption?.nativeLabel}</span>
                      <span className={`material-symbols-outlined text-sm transition-transform duration-200 ${isLangDropdownOpen ? 'rotate-180' : ''}`}>
                        expand_more
                      </span>
                    </button>

                    {isLangDropdownOpen && (
                      <div className="absolute top-full right-0 mt-1 rounded-lg shadow-xl overflow-hidden z-50 min-w-[140px]" style={{ backgroundColor: colors.backgroundDark, border: `1px solid ${colors.borderLight}` }}>
                        {languageOptions.map((option) => (
                          <button
                            key={option.value}
                            onClick={() => handleLanguageChange(option.value)}
                            className="w-full flex items-center justify-between px-3 py-2 text-left transition-colors text-sm"
                            style={{ color: currentLang === option.value ? colors.primary : colors.textSecondary }}
                            onMouseEnter={e => { if (currentLang !== option.value) { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textPrimary; } }}
                            onMouseLeave={e => { if (currentLang !== option.value) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.textSecondary; } }}
                          >
                            <span>{option.nativeLabel}</span>
                            {currentLang === option.value && (
                              <span className="material-symbols-outlined text-sm" style={{ color: colors.primary }}>check</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* About */}
              <div className="rounded-lg p-4 border transition-colors" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg" style={{ color: colors.textMuted }}>info</span>
                  <div className="min-w-0">
                    <span className="text-sm" style={{ color: colors.textPrimary }}>Lyrics Adapter</span>
                    <span className="text-xs ml-2" style={{ color: colors.textMuted }}>v1.0.0</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Shortcuts Section */}
          <section className="mb-4">
            <ShortcutsSettings />
          </section>

        </div>
      </div>
    </div>
  );
};

export default SettingsView;