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
      <div className="mb-6 flex-shrink-0">
        <h1 className="text-3xl font-bold text-white mb-1">{i18n.t('settings.title')}</h1>
        <p className="text-white/50 text-sm">{i18n.t('settings.description')}</p>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto no-scrollbar">
          
          {/* Language Setting Section */}
          <section className="mb-6">
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/[0.07] transition-colors">
              <div className="flex items-center justify-between">
                {/* Left side - Icon and labels */}
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary text-xl">language</span>
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-white">{i18n.t('settings.language')}</h3>
                    <p className="text-xs text-white/40 mt-0.5">
                      {currentLanguageOption?.nativeLabel} • {currentLanguageOption?.label}
                    </p>
                  </div>
                </div>

                {/* Right side - Dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
                    className="flex items-center gap-3 px-5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white/80 hover:bg-white/10 hover:border-white/20 transition-all min-w-[180px] justify-between"
                  >
                    <span className="text-sm font-medium">{currentLanguageOption?.nativeLabel}</span>
                    <span className={`material-symbols-outlined text-lg transition-transform duration-200 ${isLangDropdownOpen ? 'rotate-180' : ''}`}>
                      expand_more
                    </span>
                  </button>

                  {/* Dropdown Menu */}
                  {isLangDropdownOpen && (
                    <div className="absolute top-full left-0 mt-2 bg-[#1a2533] border border-white/10 rounded-xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200 min-w-[180px]">
                      {languageOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => handleLanguageChange(option.value)}
                          className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                            currentLang === option.value
                              ? 'bg-primary/20 text-primary'
                              : 'text-white/70 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium">{option.nativeLabel}</span>
                            <span className="text-xs text-white/40">{option.label}</span>
                          </div>
                          {currentLang === option.value && (
                            <span className="material-symbols-outlined text-primary text-lg">check</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Divider */}
          <div className="border-t border-white/5 my-4"></div>

          {/* Shortcuts Section */}
          <section className="mb-6">
            <ShortcutsSettings />
          </section>

          {/* Divider */}
          <div className="border-t border-white/5 my-4"></div>

          {/* About Section */}
          <section className="mb-6">
            <h2 className="text-xs font-semibold text-white/30 uppercase tracking-wider mb-3 px-1">
              {i18n.t('settings.about')}
            </h2>
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/[0.07] transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-white/60 text-xl">info</span>
                </div>
                <div>
                  <h3 className="text-base font-medium text-white">Lyrics Adapter</h3>
                  <p className="text-xs text-white/40 mt-0.5">v1.0.0</p>
                </div>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
};

export default SettingsView;