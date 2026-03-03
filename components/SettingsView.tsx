import React, { useState, useEffect, useRef } from 'react';
import { i18n, type Language } from '../services/i18n';
import ShortcutsSettings from './ShortcutsSettings';

interface SettingsViewProps {}

const SettingsView: React.FC<SettingsViewProps> = () => {
  const [currentLang, setCurrentLang] = useState<Language>(i18n.getLanguage());
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = i18n.subscribe((lang) => {
      setCurrentLang(lang);
    });
    return unsubscribe;
  }, []);

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
    <div className="max-w-4xl mx-auto w-full flex flex-col h-full">
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
              <div className="bg-white/5 border border-white/10 rounded-lg p-3 hover:bg-white/[0.07] transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined text-primary text-lg">language</span>
                    <span className="text-sm text-white/90 truncate">{i18n.t('settings.language')}</span>
                  </div>
                  <div className="relative" ref={dropdownRef}>
                    <button
                      onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 border border-white/10 rounded text-white/80 hover:bg-white/10 hover:border-white/20 transition-all text-sm"
                    >
                      <span>{currentLanguageOption?.nativeLabel}</span>
                      <span className={`material-symbols-outlined text-sm transition-transform duration-200 ${isLangDropdownOpen ? 'rotate-180' : ''}`}>
                        expand_more
                      </span>
                    </button>

                    {isLangDropdownOpen && (
                      <div className="absolute top-full right-0 mt-1 bg-[#1a2533] border border-white/10 rounded-lg shadow-xl overflow-hidden z-50 min-w-[140px]">
                        {languageOptions.map((option) => (
                          <button
                            key={option.value}
                            onClick={() => handleLanguageChange(option.value)}
                            className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors text-sm ${
                              currentLang === option.value
                                ? 'bg-primary/20 text-primary'
                                : 'text-white/70 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <span>{option.nativeLabel}</span>
                            {currentLang === option.value && (
                              <span className="material-symbols-outlined text-primary text-sm">check</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* About */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-4 hover:bg-white/[0.07] transition-colors">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-white/60 text-lg">info</span>
                  <div className="min-w-0">
                    <span className="text-sm text-white/90">Lyrics Adapter</span>
                    <span className="text-xs text-white/40 ml-2">v1.0.0</span>
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