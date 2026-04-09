import React, { useState, useEffect, useRef } from 'react';
import { i18n, type Language } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';
import { cookieManager } from '../services/cookieManager';
import { settingsManager } from '../services/settingsManager';
import { webdavClient } from '../services/webdavClient';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';
import ShortcutsSettings from './ShortcutsSettings';

interface SettingsViewProps {}

const SettingsView: React.FC<SettingsViewProps> = () => {
  const [currentLang, setCurrentLang] = useState<Language>(i18n.getLanguage());
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [cookie, setCookie] = useState('');
  const [downloadPath, setDownloadPath] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveMessageType, setSaveMessageType] = useState<'success' | 'error' | null>(null);

  const [webdavServerUrl, setWebdavServerUrl] = useState('');
  const [webdavUsername, setWebdavUsername] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');
  const [isTestingWebdav, setIsTestingWebdav] = useState(false);
  const [webdavMessage, setWebdavMessage] = useState<string | null>(null);
  const [webdavMessageType, setWebdavMessageType] = useState<'success' | 'error' | null>(null);

  useEffect(() => {
    setCookie(cookieManager.getCookie());
    setDownloadPath(settingsManager.getDownloadPath());
    const webdavConfig = webdavClient.getConfig();
    if (webdavConfig) {
      setWebdavServerUrl(webdavConfig.serverUrl);
      setWebdavUsername(webdavConfig.username);
      setWebdavPassword(webdavConfig.password);
    }
  }, []);

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

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      if (cookie.trim()) {
        cookieManager.setCookie(cookie.trim());
        const status = await cookieManager.validateCookie();
        if (!status.valid) {
          setSaveMessage(i18n.t('settingsDialog.cookieInvalid'));
          setSaveMessageType('error');
          cookieManager.clearCookie();
          setIsSaving(false);
          return;
        }
      }

      settingsManager.setDownloadPath(downloadPath.trim());

      if (webdavServerUrl.trim() && webdavUsername.trim() && webdavPassword.trim()) {
        webdavClient.saveConfig({
          serverUrl: webdavServerUrl.trim(),
          username: webdavUsername.trim(),
          password: webdavPassword.trim(),
        });
      }

      setSaveMessage(i18n.t('settingsDialog.saved'));
      setSaveMessageType('success');
      setTimeout(() => { setSaveMessage(null); setSaveMessageType(null); }, 3000);
    } catch (err) {
      setSaveMessage(i18n.t('settingsDialog.saveFailed'));
      setSaveMessageType('error');
      logger.error('[SettingsView] Save failed:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestWebdav = async () => {
    if (!webdavServerUrl.trim() || !webdavUsername.trim() || !webdavPassword.trim()) {
      setWebdavMessage(i18n.t('settingsDialog.webdavFillAll'));
      setWebdavMessageType('error');
      return;
    }
    setIsTestingWebdav(true);
    webdavClient.saveConfig({
      serverUrl: webdavServerUrl.trim(),
      username: webdavUsername.trim(),
      password: webdavPassword.trim(),
    });
    const result = await webdavClient.testConnection();
    setWebdavMessage(result.message);
    setWebdavMessageType(result.success ? 'success' : 'error');
    setIsTestingWebdav(false);
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
  const colors = currentTheme.colors;

  const inputStyle = {
    backgroundColor: colors.backgroundCard,
    border: `1px solid ${colors.borderLight}`,
    color: colors.textPrimary,
  };
  const inputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
    e.currentTarget.style.boxShadow = `0 0 15px ${colors.glowColor}`;
  };
  const inputBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.backgroundColor = colors.backgroundCard;
    e.currentTarget.style.boxShadow = 'none';
  };

  return (
    <div className="w-full flex flex-col h-full">
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold mb-2" style={{ color: 'var(--theme-text-primary, #fff)' }}>{i18n.t('settings.title')}</h1>
          <p style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>{i18n.t('settings.description')}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-5 py-2.5 rounded-xl text-sm transition-all disabled:opacity-50 flex items-center gap-2"
          style={{ backgroundColor: colors.primary, color: '#fff' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.primaryHover}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.primary}
        >
          {isSaving ? (
            <>
              <span className="material-symbols-outlined animate-spin text-sm">refresh</span>
              {i18n.t('settingsDialog.saving')}
            </>
          ) : (
            i18n.t('settingsDialog.save')
          )}
        </button>
      </div>

      {saveMessage && (
        <div className={`mb-4 p-3 rounded-xl text-sm ${
          saveMessageType === 'success'
            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-400'
        }`}>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">
              {saveMessageType === 'success' ? 'check' : 'error'}
            </span>
            {saveMessage}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto no-scrollbar space-y-4">

          <section>
            <div className="grid grid-cols-2 gap-3">
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

          {/* QQ Music */}
          <section className="rounded-lg p-4 border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: colors.textPrimary }}>
              <span className="material-symbols-outlined text-lg" style={{ color: colors.primary }}>music_note</span>
              {i18n.t('settingsDialog.qqMusicTitle')}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: colors.textSecondary }}>
                  {i18n.t('settingsDialog.cookie')}
                </label>
                <textarea
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  placeholder={i18n.t('settingsDialog.pasteCookie')}
                  className="w-full h-20 rounded-xl p-3 text-sm focus:outline-none focus:ring-0 transition-all resize-none"
                  style={inputStyle}
                  onFocus={inputFocus}
                  onBlur={inputBlur}
                  disabled={isSaving}
                />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: colors.textSecondary }}>
                  {i18n.t('settingsDialog.savePath')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={downloadPath}
                    onChange={(e) => setDownloadPath(e.target.value)}
                    placeholder={i18n.t('settingsDialog.downloadFolderPath')}
                    className="flex-1 rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
                    style={inputStyle}
                    onFocus={inputFocus}
                    onBlur={inputBlur}
                    disabled={isSaving}
                  />
                  <button
                    onClick={async () => {
                      const desktopAPI = getDesktopAPI();
                      if (desktopAPI?.selectDownloadFolder) {
                        const result = await desktopAPI.selectDownloadFolder();
                        if (result.success && result.path) {
                          setDownloadPath(result.path);
                        }
                      }
                    }}
                    disabled={isSaving}
                    className="px-3 py-2.5 rounded-xl transition-all disabled:opacity-50 flex items-center"
                    style={{ backgroundColor: colors.backgroundCard, color: colors.textPrimary, border: `1px solid ${colors.borderLight}` }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.backgroundCardHover}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.backgroundCard}
                  >
                    <span className="material-symbols-outlined text-base">folder_open</span>
                  </button>
                </div>
                <p className="mt-1 text-xs" style={{ color: colors.textMuted }}>
                  {i18n.t('settingsDialog.tip')}
                </p>
              </div>
            </div>
          </section>

          {/* WebDAV */}
          <section className="rounded-lg p-4 border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: colors.textPrimary }}>
              <span className="material-symbols-outlined text-lg" style={{ color: colors.primary }}>cloud</span>
              {i18n.t('settingsDialog.webdavTitle')}
            </h3>
            <div className="space-y-3">
              <input
                type="text"
                value={webdavServerUrl}
                onChange={(e) => setWebdavServerUrl(e.target.value)}
                placeholder="https://webdav.123pan.cn/webdav"
                className="w-full rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
                style={inputStyle}
                onFocus={inputFocus}
                onBlur={inputBlur}
              />
              <input
                type="text"
                value={webdavUsername}
                onChange={(e) => setWebdavUsername(e.target.value)}
                placeholder={i18n.t('settingsDialog.webdavUsername')}
                className="w-full rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
                style={inputStyle}
                onFocus={inputFocus}
                onBlur={inputBlur}
              />
              <input
                type="password"
                value={webdavPassword}
                onChange={(e) => setWebdavPassword(e.target.value)}
                placeholder={i18n.t('settingsDialog.webdavPassword')}
                className="w-full rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
                style={inputStyle}
                onFocus={inputFocus}
                onBlur={inputBlur}
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestWebdav}
                  disabled={isTestingWebdav}
                  className="px-4 py-2 rounded-xl text-sm transition-all disabled:opacity-50 flex items-center gap-2"
                  style={{ backgroundColor: colors.backgroundDark, color: colors.textSecondary, border: `1px solid ${colors.borderLight}` }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.backgroundCardHover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.backgroundDark}
                >
                  {isTestingWebdav ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-sm">refresh</span>
                      {i18n.t('settingsDialog.webdavTesting')}
                    </>
                  ) : (
                    i18n.t('settingsDialog.webdavTestConnection')
                  )}
                </button>
                {webdavMessage && (
                  <span className={`text-xs ${
                    webdavMessageType === 'success' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {webdavMessage}
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Shortcuts */}
          <section className="mb-4">
            <ShortcutsSettings />
          </section>

        </div>
      </div>
    </div>
  );
};

export default SettingsView;
