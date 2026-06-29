import React, { useState, useEffect, useRef } from 'react';
import { i18n, type Language } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';
import { cookieManager, neteaseCookieManager } from '../services/cookieManager';
import { settingsManager, type OnlineSource } from '../services/settingsManager';
import { webdavClient } from '../services/webdavClient';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';
import ShortcutsSettings from './ShortcutsSettings';
import GsapModal from './GsapModal';
import { useFrostedHeader } from '../hooks/useFrostedHeader';

interface SettingsViewProps {
  onClearOrphanCache?: () => Promise<{ metadataDeleted: number; coversDeleted: number; errors: string[] }>;
  onHeaderHeightChange?: (height: number) => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ onClearOrphanCache, onHeaderHeightChange }) => {
  // Reuse the local `glassUI` state below for className branches; the hook
  // only needs to own the band measurement + report height upstream.
  // NOTE: Frosted Glass UI is shelved (no longer toggleable), so `glassUI` is
  // effectively always false here — the branches are retained for future use.
  const { ref: headerBandRef, headerHeight: headerBandHeight } = useFrostedHeader(onHeaderHeightChange);
  const [currentLang, setCurrentLang] = useState<Language>(i18n.getLanguage());
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [cookie, setCookie] = useState('');
  const [neteaseCookie, setNeteaseCookie] = useState('');
  const [onlineSource, setOnlineSource] = useState<OnlineSource>('qq');
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
  const [bgBlurTrans, setBgBlurTrans] = useState(1.0);
  const [qqMusicEnabled, setQqMusicEnabled] = useState(false);
  const [glassUI, setGlassUI] = useState(false);
  const [gsapButtonBounce, setGsapButtonBounce] = useState(true);
  const [focusBgBlurRadius, setFocusBgBlurRadius] = useState(80);
  const [focusLyricsFontSize, setFocusLyricsFontSize] = useState(24);
  const [focusLyricLineSpacing, setFocusLyricLineSpacing] = useState(32);
  const [focusInactiveLyricBlur, setFocusInactiveLyricBlur] = useState(2);

  const [appVersion, setAppVersion] = useState<string>('');
  const [showClearCacheConfirm, setShowClearCacheConfirm] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheClearMessage, setCacheClearMessage] = useState<string | null>(null);
  const [cacheClearMessageType, setCacheClearMessageType] = useState<'success' | 'error' | null>(null);

  useEffect(() => {
    (async () => {
      await cookieManager.ensureLoaded();
      await neteaseCookieManager.ensureLoaded();
      await settingsManager.ensureLoaded();
      setCookie(cookieManager.getCookie());
      setNeteaseCookie(neteaseCookieManager.getCookie());
      setOnlineSource(settingsManager.getOnlineSource());
      setDownloadPath(settingsManager.getDownloadPath());
      const webdavConfig = webdavClient.getConfig();
      if (webdavConfig) {
        setWebdavServerUrl(webdavConfig.serverUrl);
        setWebdavUsername(webdavConfig.username);
        setWebdavPassword(webdavConfig.password);
      }
      setBgBlurTrans(settingsManager.getBgBlurTrans());
      setQqMusicEnabled(settingsManager.getQqMusicEnabled());
      setGlassUI(settingsManager.getGlassUI());
      setGsapButtonBounce(settingsManager.getGsapButtonBounce());
      setFocusBgBlurRadius(settingsManager.getFocusBgBlurRadius());
      setFocusLyricsFontSize(settingsManager.getFocusLyricsFontSize());
      setFocusLyricLineSpacing(settingsManager.getFocusLyricLineSpacing());
      setFocusInactiveLyricBlur(settingsManager.getFocusInactiveLyricBlur());
    })();
  }, []);

  // Subscribe to settings changes (e.g. bgBlurTrans updated by FocusMode)
  useEffect(() => {
    const unsubscribe = settingsManager.subscribe(() => {
      setBgBlurTrans(settingsManager.getBgBlurTrans());
      setQqMusicEnabled(settingsManager.getQqMusicEnabled());
      setGlassUI(settingsManager.getGlassUI());
      setGsapButtonBounce(settingsManager.getGsapButtonBounce());
      setFocusBgBlurRadius(settingsManager.getFocusBgBlurRadius());
      setFocusLyricsFontSize(settingsManager.getFocusLyricsFontSize());
      setFocusLyricLineSpacing(settingsManager.getFocusLyricLineSpacing());
      setFocusInactiveLyricBlur(settingsManager.getFocusInactiveLyricBlur());
    });
    return unsubscribe;
  }, []);

  // Debounce bgBlurTrans persistence: 500ms after slider stops moving
  useEffect(() => {
    const timer = setTimeout(() => {
      settingsManager.setBgBlurTrans(bgBlurTrans);
    }, 500);
    return () => clearTimeout(timer);
  }, [bgBlurTrans]);

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

  // 获取应用版本号
  useEffect(() => {
    getDesktopAPI()?.getAppVersion?.()
      .then(v => setAppVersion(v))
      .catch(e => logger.error('[SettingsView] getAppVersion failed:', e));
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
      // Persist the active source choice immediately.
      settingsManager.setOnlineSource(onlineSource);

      const cookieStore = onlineSource === 'netease' ? neteaseCookieManager : cookieManager;
      const cookieValue = (onlineSource === 'netease' ? neteaseCookie : cookie).trim();
      if (cookieValue) {
        await cookieStore.setCookie(cookieValue);
        const status = await cookieStore.validateCookie();
        if (!status.valid) {
          setSaveMessage(i18n.t('settingsDialog.cookieInvalid'));
          setSaveMessageType('error');
          await cookieStore.clearCookie();
          setIsSaving(false);
          return;
        }
      }
      // NetEase cookie is optional — empty is valid (anonymous search).

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
    borderRadius: 'var(--theme-control-radius)',
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
    <><div className="w-full flex flex-col h-full relative">
      {/* Header band: in glass mode it overlays the top (z-30) while the body
          scrolls under the App-level frosted band; its measured height pads the
          scroll content down so it starts below the band. */}
      <div ref={headerBandRef} className={glassUI ? 'relative z-30 flex-shrink-0' : 'flex-shrink-0'}>
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold" style={{ color: 'var(--theme-text-primary, #fff)' }}>{i18n.t('settings.title')}</h1>
          <p style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>{i18n.t('settings.description')}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-5 py-2.5 r-control text-sm transition-all disabled:opacity-50 flex items-center gap-2 shadow-xl"
          style={{ backgroundColor: colors.primary, color: '#fff', border: `var(--theme-control-border-width) solid ${colors.borderLight}` }}
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
        <div className={`mb-4 p-3 r-control text-sm ${
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
      </div>

      <div className={glassUI ? 'absolute inset-0 overflow-hidden' : 'flex-1 overflow-hidden'}>
        <div
          className="h-full overflow-y-auto no-scrollbar space-y-4"
          style={glassUI ? { paddingTop: headerBandHeight } : undefined}
        >

          <section>
            <div className="grid grid-cols-2 gap-3">
              <div className="r-card p-3 border transition-colors" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined text-lg" style={{ color: colors.primary }}>language</span>
                    <span className="text-sm truncate" style={{ color: colors.textPrimary }}>{i18n.t('settings.language')}</span>
                  </div>
                  <div className="relative" ref={dropdownRef}>
                    <button
                      onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
                      className="flex items-center gap-1.5 px-2.5 py-1 r-sm text-sm transition-all"
                      style={{ backgroundColor: colors.backgroundCard, border: `1px solid ${colors.borderLight}`, color: colors.textSecondary }}
                    >
                      <span>{currentLanguageOption?.nativeLabel}</span>
                      <span className={`material-symbols-outlined text-sm transition-transform duration-200 ${isLangDropdownOpen ? 'rotate-180' : ''}`}>
                        expand_more
                      </span>
                    </button>

                    {isLangDropdownOpen && (
                      <div className="absolute top-full right-0 mt-1 r-card shadow-xl overflow-hidden z-50 min-w-[140px]" style={{ backgroundColor: colors.backgroundDark, border: `1px solid ${colors.borderLight}` }}>
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

              <div className="r-card p-4 border transition-colors" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg" style={{ color: colors.textMuted }}>info</span>
                  <div className="min-w-0">
                    <span className="text-sm" style={{ color: colors.textPrimary }}>{i18n.t('settings.about')}</span>
                    <span className="text-xs ml-2" style={{ color: colors.textMuted }}>v{appVersion || '…'}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Online Music — only visible when experimental toggle is enabled */}
          {qqMusicEnabled && (
          <section className="r-card p-4 border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: colors.textPrimary }}>
              <span className="material-symbols-outlined text-lg" style={{ color: colors.primary }}>music_note</span>
              {i18n.t('settingsDialog.onlineMusicTitle')}
            </h3>
            <div className="space-y-3">
              {/* Source selector (QQ Music / NetEase) */}
              <div>
                <label className="block text-xs mb-1.5" style={{ color: colors.textSecondary }}>
                  {i18n.t('settingsDialog.onlineSource')}
                </label>
                <div className="flex gap-2">
                  {(['qq', 'netease'] as OnlineSource[]).map((src) => {
                    const active = onlineSource === src;
                    return (
                      <button
                        key={src}
                        type="button"
                        onClick={() => {
                          setOnlineSource(src);
                          settingsManager.setOnlineSource(src);
                        }}
                        className="flex-1 px-3 py-2 r-control text-xs font-medium transition-all"
                        style={{
                          backgroundColor: active ? colors.primary : colors.backgroundCard,
                          color: active ? colors.textPrimary : colors.textSecondary,
                          border: `1px solid ${active ? colors.primary : colors.borderLight}`,
                        }}
                      >
                        {src === 'netease' ? i18n.t('settingsDialog.onlineSourceNetease') : i18n.t('settingsDialog.onlineSourceQq')}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Cookie (QQ: required; NetEase: optional, unlocks VIP/high quality) */}
              <div>
                <label className="block text-xs mb-1.5" style={{ color: colors.textSecondary }}>
                  {onlineSource === 'netease'
                    ? i18n.t('settingsDialog.neteaseCookieLabel')
                    : i18n.t('settingsDialog.cookie')}
                </label>
                <textarea
                  value={onlineSource === 'netease' ? neteaseCookie : cookie}
                  onChange={(e) =>
                    onlineSource === 'netease'
                      ? setNeteaseCookie(e.target.value)
                      : setCookie(e.target.value)
                  }
                  placeholder={i18n.t('settingsDialog.pasteCookie')}
                  className="w-full h-20 r-control p-3 text-sm focus:outline-none focus:ring-0 transition-all resize-none"
                  style={inputStyle}
                  onFocus={inputFocus}
                  onBlur={inputBlur}
                  disabled={isSaving}
                />
                {onlineSource === 'netease' && (
                  <p className="mt-1 text-xs" style={{ color: colors.textMuted }}>
                    {i18n.t('settingsDialog.neteaseCookieHint')}
                  </p>
                )}
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
                    className="flex-1 r-control py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
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
                    className="px-3 py-2.5 r-control transition-all disabled:opacity-50 flex items-center"
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
          )}

          {/* WebDAV */}
          <section className="r-card p-4 border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
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
                className="w-full r-control py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
                style={inputStyle}
                onFocus={inputFocus}
                onBlur={inputBlur}
              />
              <input
                type="text"
                value={webdavUsername}
                onChange={(e) => setWebdavUsername(e.target.value)}
                placeholder={i18n.t('settingsDialog.webdavUsername')}
                className="w-full r-control py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
                style={inputStyle}
                onFocus={inputFocus}
                onBlur={inputBlur}
              />
              <input
                type="password"
                value={webdavPassword}
                onChange={(e) => setWebdavPassword(e.target.value)}
                placeholder={i18n.t('settingsDialog.webdavPassword')}
                className="w-full r-control py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
                style={inputStyle}
                onFocus={inputFocus}
                onBlur={inputBlur}
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestWebdav}
                  disabled={isTestingWebdav}
                  className="px-4 py-2 r-control text-sm transition-all disabled:opacity-50 flex items-center gap-2"
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

          {/* Experimental Features */}
          <section className="r-card p-4 border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: colors.textPrimary }}>
              <span className="material-symbols-outlined text-lg" style={{ color: colors.textMuted }}>science</span>
              {i18n.t('settings.experimental')}
            </h3>

            {/* 背景模糊透明度滑块 */}
            <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
              <span className="text-sm" style={{ color: colors.textSecondary }}>{i18n.t('settings.bgBlurTrans')}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums w-8 text-right" style={{ color: colors.textMuted }}>{bgBlurTrans.toFixed(2)}</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={bgBlurTrans}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    setBgBlurTrans(value);
                    // 实时更新 FocusMode 预览（不持久化）
                    const fn = (window as any).bg_blur_trans;
                    if (typeof fn === 'function') fn(value);
                  }}
                  className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, ${colors.primary} ${bgBlurTrans * 100}%, ${colors.borderLight} ${bgBlurTrans * 100}%)`,
                  }}
                />
              </div>
            </div>

            {/* Focus Mode 背景模糊半径 */}
            <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
              <span className="text-sm" style={{ color: colors.textSecondary }}>{i18n.t('settings.focusBgBlurRadius')}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums w-10 text-right" style={{ color: colors.textMuted }}>{focusBgBlurRadius}px</span>
                <input
                  type="range"
                  min="40"
                  max="80"
                  step="1"
                  value={focusBgBlurRadius}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setFocusBgBlurRadius(value);
                    settingsManager.setFocusBgBlurRadius(value);
                  }}
                  className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, ${colors.primary} ${((focusBgBlurRadius - 40) / 40) * 100}%, ${colors.borderLight} ${((focusBgBlurRadius - 40) / 40) * 100}%)`,
                  }}
                />
              </div>
            </div>

            {/* Focus Mode 滚动歌词字号 */}
            <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
              <span className="text-sm" style={{ color: colors.textSecondary }}>{i18n.t('settings.focusLyricsFontSize')}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums w-10 text-right" style={{ color: colors.textMuted }}>{focusLyricsFontSize}px</span>
                <input
                  type="range"
                  min="16"
                  max="40"
                  step="1"
                  value={focusLyricsFontSize}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setFocusLyricsFontSize(value);
                    settingsManager.setFocusLyricsFontSize(value);
                  }}
                  className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, ${colors.primary} ${((focusLyricsFontSize - 16) / 24) * 100}%, ${colors.borderLight} ${((focusLyricsFontSize - 16) / 24) * 100}%)`,
                  }}
                />
              </div>
            </div>

            {/* Focus Mode 滚动歌词行间距 */}
            <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
              <span className="text-sm" style={{ color: colors.textSecondary }}>{i18n.t('settings.focusLyricLineSpacing')}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums w-10 text-right" style={{ color: colors.textMuted }}>{focusLyricLineSpacing}px</span>
                <input
                  type="range"
                  min="12"
                  max="48"
                  step="1"
                  value={focusLyricLineSpacing}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setFocusLyricLineSpacing(value);
                    settingsManager.setFocusLyricLineSpacing(value);
                  }}
                  className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, ${colors.primary} ${((focusLyricLineSpacing - 12) / 36) * 100}%, ${colors.borderLight} ${((focusLyricLineSpacing - 12) / 36) * 100}%)`,
                  }}
                />
              </div>
            </div>

            {/* Focus Mode 非当前歌词模糊 */}
            <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
              <span className="text-sm" style={{ color: colors.textSecondary }}>{i18n.t('settings.focusInactiveLyricBlur')}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums w-10 text-right" style={{ color: colors.textMuted }}>{focusInactiveLyricBlur}px</span>
                <input
                  type="range"
                  min="0"
                  max="12"
                  step="1"
                  value={focusInactiveLyricBlur}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setFocusInactiveLyricBlur(value);
                    settingsManager.setFocusInactiveLyricBlur(value);
                  }}
                  className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, ${colors.primary} ${(focusInactiveLyricBlur / 12) * 100}%, ${colors.borderLight} ${(focusInactiveLyricBlur / 12) * 100}%)`,
                  }}
                />
              </div>
            </div>

            {/* 第三方音源开关 */}
            <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
              <span className="text-sm" style={{ color: colors.textSecondary }}>{i18n.t('settings.qqMusicEnabled')}</span>
              <button
                onClick={() => {
                  const newValue = !qqMusicEnabled;
                  setQqMusicEnabled(newValue);
                  settingsManager.setQqMusicEnabled(newValue);
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none`}
                style={{
                  backgroundColor: qqMusicEnabled ? colors.primary : colors.borderLight,
                }}
              >
                <span
                  className={`inline-block size-5 rounded-full bg-white shadow-sm transform transition-transform duration-200`}
                  style={{
                    transform: qqMusicEnabled ? 'translateX(22px)' : 'translateX(2px)',
                  }}
                />
              </button>
            </div>

            {/* 按钮回弹开关 */}
            <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
              <div className="min-w-0 mr-3">
                <span className="text-sm" style={{ color: colors.textSecondary }}>{i18n.t('settings.buttonBounce')}</span>
                <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>{i18n.t('settings.buttonBounceDesc')}</p>
              </div>
              <button
                onClick={() => {
                  const newValue = !gsapButtonBounce;
                  setGsapButtonBounce(newValue);
                  settingsManager.setGsapButtonBounce(newValue);
                }}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0"
                style={{ backgroundColor: gsapButtonBounce ? colors.primary : colors.borderLight }}
                aria-label={i18n.t('settings.buttonBounce')}
                aria-pressed={gsapButtonBounce}
              >
                <span
                  className="inline-block size-5 rounded-full bg-white shadow-sm transform transition-transform duration-200"
                  style={{ transform: gsapButtonBounce ? 'translateX(22px)' : 'translateX(2px)' }}
                />
              </button>
            </div>

            {/* 清理孤儿缓存按钮 */}
            <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
              <div>
                <span className="text-sm" style={{ color: colors.textSecondary }}>{i18n.t('settings.clearCache')}</span>
                <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>{i18n.t('settings.clearCacheDesc')}</p>
              </div>
              <button
                onClick={() => setShowClearCacheConfirm(true)}
                disabled={isClearingCache}
                className="px-3 py-1.5 r-card text-xs transition-all disabled:opacity-50 flex items-center gap-1.5"
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.25)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.15)'}
              >
                <span className="material-symbols-outlined text-sm">delete_sweep</span>
                {i18n.t('settings.clearCache')}
              </button>
            </div>

            {/* 清理结果提示 */}
            {cacheClearMessage && (
              <div className={`mt-2 p-2 r-card text-xs ${
                cacheClearMessageType === 'success'
                  ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                  : 'bg-red-500/10 border border-red-500/30 text-red-400'
              }`}>
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-xs">
                    {cacheClearMessageType === 'success' ? 'check' : 'error'}
                  </span>
                  {cacheClearMessage}
                </div>
              </div>
            )}
          </section>

          {/* Shortcuts */}
          <section className="mb-4">
            <ShortcutsSettings />
          </section>

        </div>
      </div>
    </div>

    {/* 清理缓存二次确认弹窗 */}
    <GsapModal
      isOpen={showClearCacheConfirm}
      overlayClassName="z-50"
      overlayStyle={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      panelClassName="r-control p-6 max-w-md w-full mx-4 shadow-2xl"
      panelStyle={{ backgroundColor: colors.backgroundDark, border: `1px solid ${colors.borderLight}` }}
    >
          <h3 className="text-lg font-semibold mb-2" style={{ color: colors.textPrimary }}>{i18n.t('settings.clearCacheConfirmTitle')}</h3>
          <p className="mb-4" style={{ color: colors.textSecondary }}>{i18n.t('settings.clearCacheConfirmBody')}</p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowClearCacheConfirm(false)}
              disabled={isClearingCache}
              className="px-4 py-2 r-card transition-all"
              style={{ color: colors.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {i18n.t('common.cancel')}
            </button>
            <button
              onClick={async () => {
                if (!onClearOrphanCache) return;
                setIsClearingCache(true);
                setCacheClearMessage(null);
                try {
                  const result = await onClearOrphanCache();
                  if (result.errors.length > 0) {
                    setCacheClearMessage(`${i18n.t('settings.clearCacheDone')} ${result.metadataDeleted} metadata, ${result.coversDeleted} covers (${result.errors.length} errors)`);
                    setCacheClearMessageType('error');
                  } else {
                    setCacheClearMessage(`${i18n.t('settings.clearCacheDone')} ${result.metadataDeleted} metadata, ${result.coversDeleted} covers`);
                    setCacheClearMessageType('success');
                  }
                } catch (error) {
                  setCacheClearMessage(i18n.t('settings.clearCacheFailed'));
                  setCacheClearMessageType('error');
                } finally {
                  setIsClearingCache(false);
                  setShowClearCacheConfirm(false);
                }
              }}
              disabled={isClearingCache || !onClearOrphanCache}
              className="px-4 py-2 r-card transition-all flex items-center gap-1.5"
              style={{ backgroundColor: `${colors.error}20`, color: colors.error }}
            >
              {isClearingCache ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-sm">refresh</span>
                  {i18n.t('settings.clearing')}
                </>
              ) : (
                i18n.t('settings.confirmClearCache')
              )}
            </button>
          </div>
    </GsapModal>
    </>
  );
};

export default SettingsView;
