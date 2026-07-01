import React, { useState, useEffect, useRef } from 'react';
import { i18n, type Language } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';
import { cookieManager, neteaseCookieManager } from '../services/cookieManager';
import { settingsManager, type OnlineSource } from '../services/settingsManager';
import { webdavClient } from '../services/webdavClient';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';
import {
  startQQLogin,
  pollQQLogin,
  startNetEaseQR,
  pollNetEaseQR,
  type QRLoginStatus,
  type QRPollResult,
} from '../services/qrLogin';
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
  const langDropdownRef = useRef<HTMLDivElement>(null);

  const [cookie, setCookie] = useState('');
  const [neteaseCookie, setNeteaseCookie] = useState('');
  const [onlineSource, setOnlineSource] = useState<OnlineSource>('qq');
  const [downloadPath, setDownloadPath] = useState('');
  const [isSavingOnline, setIsSavingOnline] = useState(false);
  const [onlineMessage, setOnlineMessage] = useState<string | null>(null);
  const [onlineMessageType, setOnlineMessageType] = useState<'success' | 'error' | null>(null);

  // QR scan-login state — drives the live QR panel in the third-party section.
  const [qqLoggedIn, setQqLoggedIn] = useState(false);
  const [neteaseLoggedIn, setNeteaseLoggedIn] = useState(false);
  const [qrState, setQrState] = useState<'idle' | 'loading' | QRLoginStatus>('idle');
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrMsg, setQrMsg] = useState<string>('');
  const sessionRef = useRef<{ source: OnlineSource; key: string } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const [webdavServerUrl, setWebdavServerUrl] = useState('');
  const [webdavUsername, setWebdavUsername] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');
  const [isTestingWebdav, setIsTestingWebdav] = useState(false);
  const [isSavingWebdav, setIsSavingWebdav] = useState(false);
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
      setQqLoggedIn(cookieManager.hasCookie());
      setNeteaseLoggedIn(neteaseCookieManager.hasCookie());
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
      if (langDropdownRef.current && !langDropdownRef.current.contains(event.target as Node)) {
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

  const handleOnlineSourceChange = (source: OnlineSource) => {
    setOnlineSource(source);
    settingsManager.setOnlineSource(source);
    setOnlineMessage(null);
    setOnlineMessageType(null);
  };

  const showOnlineMessage = (msg: string, type: 'success' | 'error') => {
    setOnlineMessage(msg);
    setOnlineMessageType(type);
    setTimeout(() => { setOnlineMessage(null); setOnlineMessageType(null); }, 3000);
  };

  const handleSaveOnlineMusic = async () => {
    setIsSavingOnline(true);
    setOnlineMessage(null);

    try {
      settingsManager.setOnlineSource(onlineSource);

      const cookieStore = onlineSource === 'netease' ? neteaseCookieManager : cookieManager;
      const cookieValue = (onlineSource === 'netease' ? neteaseCookie : cookie).trim();
      if (cookieValue) {
        await cookieStore.setCookie(cookieValue);
        const status = await cookieStore.validateCookie();
        if (!status.valid) {
          showOnlineMessage(i18n.t('settingsDialog.cookieInvalid'), 'error');
          await cookieStore.clearCookie();
          return;
        }
      } else {
        await cookieStore.clearCookie();
      }

      settingsManager.setDownloadPath(downloadPath.trim());
      showOnlineMessage(i18n.t('settingsDialog.saved'), 'success');
    } catch (err) {
      showOnlineMessage(i18n.t('settingsDialog.saveFailed'), 'error');
      logger.error('[SettingsView] Online Music save failed:', err);
    } finally {
      setIsSavingOnline(false);
    }
  };

  const getWebdavFormConfig = () => {
    if (!webdavServerUrl.trim() || !webdavUsername.trim() || !webdavPassword.trim()) {
      setWebdavMessage(i18n.t('settingsDialog.webdavFillAll'));
      setWebdavMessageType('error');
      return null;
    }
    return {
      serverUrl: webdavServerUrl.trim(),
      username: webdavUsername.trim(),
      password: webdavPassword.trim(),
    };
  };

  const handleTestWebdav = async () => {
    const config = getWebdavFormConfig();
    if (!config) {
      return;
    }
    setIsTestingWebdav(true);
    try {
      const result = await webdavClient.testConnection(config);
      setWebdavMessage(result.message);
      setWebdavMessageType(result.success ? 'success' : 'error');
    } finally {
      setIsTestingWebdav(false);
    }
  };

  const handleSaveWebdav = () => {
    setIsSavingWebdav(true);
    try {
      const config = getWebdavFormConfig();
      if (!config) {
        return;
      }
      webdavClient.saveConfig(config);
      setWebdavMessage(i18n.t('settingsDialog.saved'));
      setWebdavMessageType('success');
      setTimeout(() => { setWebdavMessage(null); setWebdavMessageType(null); }, 3000);
    } catch (err) {
      setWebdavMessage(i18n.t('settingsDialog.saveFailed'));
      setWebdavMessageType('error');
      logger.error('[SettingsView] WebDAV save failed:', err);
    } finally {
      setIsSavingWebdav(false);
    }
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
  const sourceOptions: { value: OnlineSource; label: string }[] = [
    { value: 'qq', label: i18n.t('settingsDialog.onlineSourceQq') },
    { value: 'netease', label: i18n.t('settingsDialog.onlineSourceNetease') },
  ];
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

  // ===== QR scan-login lifecycle =====
  const isQrLoggedIn = onlineSource === 'qq' ? qqLoggedIn : neteaseLoggedIn;
  const qrScanning = qrState === 'loading' || qrState === 'waiting' || qrState === 'confirming';

  const stopQrPolling = (): void => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const resetQr = (): void => {
    stopQrPolling();
    sessionRef.current = null;
    setQrImage(null);
    setQrMsg('');
    setQrState('idle');
  };

  const handleQrPollResult = async (source: OnlineSource, res: QRPollResult): Promise<void> => {
    setQrState(res.status);
    if (res.status === 'confirming') {
      setQrMsg(i18n.t('settingsDialog.qrConfirming'));
    } else if (res.status === 'waiting') {
      setQrMsg(res.msg || i18n.t('settingsDialog.qrWaiting'));
    } else if (res.msg) {
      setQrMsg(res.msg);
    }

    if (res.status === 'done') {
      stopQrPolling();
      setQrImage(null);
      if (res.cookie) {
        if (source === 'qq') {
          await cookieManager.setCookie(res.cookie);
          setCookie(cookieManager.getCookie());
          setQqLoggedIn(true);
          window.electron?.setOnlineCookie?.('qq', cookieManager.getCookie());
        } else {
          await neteaseCookieManager.setCookie(res.cookie);
          setNeteaseCookie(neteaseCookieManager.getCookie());
          setNeteaseLoggedIn(true);
          window.electron?.setOnlineCookie?.('netease', neteaseCookieManager.getCookie());
        }
        showOnlineMessage(i18n.t('settingsDialog.qrLoggedIn'), 'success');
      }
    } else if (res.status === 'expired') {
      stopQrPolling();
      setQrImage(null);
    }
    // 'waiting' | 'confirming' | 'error' → keep polling (error is treated as soft)
  };

  const beginQrPolling = (source: OnlineSource, key: string): void => {
    stopQrPolling();
    const tick = async (): Promise<void> => {
      if (!mountedRef.current) return;
      const sess = sessionRef.current;
      if (!sess || sess.key !== key) return; // superseded by a newer session
      try {
        const res = source === 'qq' ? await pollQQLogin(key) : await pollNetEaseQR(key);
        if (!mountedRef.current) return;
        if (!sessionRef.current || sessionRef.current.key !== key) return;
        await handleQrPollResult(source, res);
      } catch (e) {
        if (!mountedRef.current) return;
        logger.error('[SettingsView] QR poll failed:', e);
        setQrMsg((e as Error).message || i18n.t('settingsDialog.qrError'));
        setQrState('error');
      }
    };
    pollTimerRef.current = setInterval(tick, 2000);
  };

  const startQr = async (source: OnlineSource): Promise<void> => {
    stopQrPolling();
    sessionRef.current = null;
    setQrImage(null);
    setQrMsg('');
    setQrState('loading');
    try {
      const res = source === 'qq' ? await startQQLogin() : await startNetEaseQR();
      if (!mountedRef.current) return;
      sessionRef.current = { source, key: res.sessionKey };
      setQrImage(res.qrcode);
      setQrState('waiting');
      setQrMsg(i18n.t('settingsDialog.qrWaiting'));
      beginQrPolling(source, res.sessionKey);
    } catch (e) {
      if (!mountedRef.current) return;
      logger.error('[SettingsView] startQr failed:', e);
      setQrMsg((e as Error).message || i18n.t('settingsDialog.qrError'));
      setQrState('error');
    }
  };

  const handleQrLogout = async (): Promise<void> => {
    if (onlineSource === 'qq') {
      await cookieManager.clearCookie();
      setCookie('');
      setQqLoggedIn(false);
    } else {
      await neteaseCookieManager.clearCookie();
      setNeteaseCookie('');
      setNeteaseLoggedIn(false);
    }
    resetQr();
    await startQr(onlineSource);
  };

  // Mark mounted; clean up any active polling on unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopQrPolling();
      sessionRef.current = null;
    };
  }, []);

  // (Re)start the QR whenever the third-party section is shown or the source changes.
  useEffect(() => {
    if (!qqMusicEnabled) {
      resetQr();
      return;
    }
    resetQr();
    const loggedIn =
      onlineSource === 'qq' ? cookieManager.hasCookie() : neteaseCookieManager.hasCookie();
    if (!loggedIn) {
      void startQr(onlineSource);
    }
    return () => {
      stopQrPolling();
      sessionRef.current = null;
    };
    // startQr/resetQr are stable in behavior (only refs + setters); omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qqMusicEnabled, onlineSource]);

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
      </div>
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
                  <div className="relative w-32" ref={langDropdownRef}>
                    <button
                      onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
                      className="flex w-full items-center justify-between gap-1.5 px-2.5 py-1 text-sm transition-all"
                      style={{
                        backgroundColor: colors.backgroundCard,
                        border: `1px solid ${colors.borderLight}`,
                        borderRadius: isLangDropdownOpen ? 'var(--theme-card-radius) var(--theme-card-radius) 0 0' : 'var(--theme-card-radius)',
                        color: colors.textSecondary,
                      }}
                    >
                      <span>{currentLanguageOption?.nativeLabel}</span>
                      <span className={`material-symbols-outlined text-sm transition-transform duration-200 ${isLangDropdownOpen ? 'rotate-180' : ''}`}>
                        expand_more
                      </span>
                    </button>

                    <div
                      className="absolute left-0 right-0 top-full overflow-hidden z-50"
                      style={{
                        transform: isLangDropdownOpen ? 'scaleY(1)' : 'scaleY(0)',
                        transformOrigin: 'top center',
                        opacity: isLangDropdownOpen ? 1 : 0,
                        pointerEvents: isLangDropdownOpen ? 'auto' : 'none',
                        transition: 'transform 0.25s ease, opacity 0.2s ease',
                        background: colors.backgroundDark,
                        backdropFilter: 'blur(20px)',
                        borderWidth: '0 1px 1px',
                        borderStyle: 'solid',
                        borderColor: isLangDropdownOpen ? colors.borderLight : 'transparent',
                        borderRadius: '0 0 var(--theme-card-radius) var(--theme-card-radius)',
                      }}
                    >
                      {languageOptions.map((option) => {
                        const active = currentLang === option.value;
                        return (
                          <button
                            key={option.value}
                            onClick={() => handleLanguageChange(option.value)}
                            className="w-full px-3 py-2 text-left transition-colors text-sm"
                            style={{ color: active ? colors.primary : colors.textSecondary }}
                            onMouseEnter={e => { if (!active) { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textPrimary; } }}
                            onMouseLeave={e => { if (!active) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.textSecondary; } }}
                          >
                            {option.nativeLabel}
                          </button>
                        );
                      })}
                    </div>
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

          {/* WebDAV */}
          <section className="r-card p-4 border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: colors.textPrimary }}>
                <span className="material-symbols-outlined text-lg" style={{ color: colors.primary }}>cloud</span>
                {i18n.t('settingsDialog.webdavTitle')}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTestWebdav}
                  disabled={isTestingWebdav || isSavingWebdav}
                  className="px-4 py-2 text-sm transition-all disabled:opacity-50 flex items-center gap-2"
                  style={{ backgroundColor: colors.backgroundDark, color: colors.textSecondary, border: `1px solid ${colors.borderLight}`, borderRadius: 'var(--theme-card-radius)' }}
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
                <button
                  onClick={handleSaveWebdav}
                  disabled={isTestingWebdav || isSavingWebdav}
                  className="px-4 py-2 text-sm transition-all disabled:opacity-50 flex items-center gap-2"
                  style={{ backgroundColor: colors.primary, color: '#fff', border: `1px solid ${colors.borderLight}`, borderRadius: 'var(--theme-card-radius)' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.primaryHover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.primary}
                >
                  {isSavingWebdav ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-sm">refresh</span>
                      {i18n.t('settingsDialog.saving')}
                    </>
                  ) : (
                    i18n.t('settingsDialog.save')
                  )}
                </button>
              </div>
            </div>
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
              {webdavMessage && (
                <span className={`text-xs ${
                  webdavMessageType === 'success' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {webdavMessage}
                </span>
              )}
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

          {/* Online Music — only visible when experimental toggle is enabled */}
          {qqMusicEnabled && (
          <section className="r-card p-4 border mb-4" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: colors.textPrimary }}>
                <span className="material-symbols-outlined text-lg" style={{ color: colors.primary }}>music_note</span>
                {i18n.t('settingsDialog.onlineMusicTitle')}
              </h3>
              <button
                onClick={handleSaveOnlineMusic}
                disabled={isSavingOnline}
                className="px-4 py-2 text-sm transition-all disabled:opacity-50 flex items-center gap-2 flex-shrink-0"
                style={{ backgroundColor: colors.primary, color: '#fff', border: `1px solid ${colors.borderLight}`, borderRadius: 'var(--theme-card-radius)' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.primaryHover}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.primary}
              >
                {isSavingOnline ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-sm">refresh</span>
                    {i18n.t('settingsDialog.saving')}
                  </>
                ) : (
                  i18n.t('settingsDialog.save')
                )}
              </button>
            </div>

            <div className="grid grid-cols-[190px_176px_minmax(220px,1fr)] gap-6">
              <div className="min-w-0">
                <div className="text-xs mb-1.5" style={{ color: colors.textSecondary }}>
                  {i18n.t('settingsDialog.onlineSource')}
                </div>
                <div
                  className="h-44 overflow-y-auto no-scrollbar p-2 space-y-1"
                  style={{
                    backgroundColor: colors.backgroundDark,
                    border: `1px solid ${colors.borderLight}`,
                    borderRadius: 'var(--theme-card-radius)',
                  }}
                >
                  {sourceOptions.map((option) => {
                    const active = onlineSource === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleOnlineSourceChange(option.value)}
                        className="w-full px-3 py-2 text-left transition-colors text-xs flex items-center justify-between gap-2"
                        style={{
                          backgroundColor: active ? `${colors.primary}20` : 'transparent',
                          border: `1px solid ${active ? colors.primary : 'transparent'}`,
                          borderRadius: 'var(--theme-card-radius)',
                          color: active ? colors.primary : colors.textSecondary,
                        }}
                        onMouseEnter={e => {
                          if (!active) {
                            e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                            e.currentTarget.style.color = colors.textPrimary;
                          }
                        }}
                        onMouseLeave={e => {
                          if (!active) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = colors.textSecondary;
                          }
                        }}
                      >
                        <span className="truncate">{option.label}</span>
                        {active && <span className="material-symbols-outlined text-sm flex-shrink-0">check</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-w-0">
                <div className="text-xs mb-1.5 flex items-center justify-between gap-2" style={{ color: colors.textSecondary }}>
                  <span>{i18n.t('settingsDialog.qrTitle')}</span>
                  {(qrImage || qrState === 'error' || qrState === 'expired') && (
                    <button
                      type="button"
                      onClick={() => void startQr(onlineSource)}
                      title={i18n.t('settingsDialog.qrRefresh')}
                      className="material-symbols-outlined text-xs leading-none opacity-60 hover:opacity-100 transition-opacity"
                      style={{ color: colors.textSecondary }}
                    >
                      refresh
                    </button>
                  )}
                </div>
                <div
                  className="h-44 w-full r-control relative flex flex-col items-center justify-center overflow-hidden"
                  style={{
                    backgroundColor: colors.backgroundDark,
                    border: `1px dashed ${colors.borderLight}`,
                    color: colors.textMuted,
                  }}
                >
                  {/* Logged-in panel */}
                  {isQrLoggedIn && !qrScanning ? (
                    <div className="flex flex-col items-center gap-1.5 text-center px-2">
                      <span className="material-symbols-outlined text-5xl" style={{ color: '#22c55e' }}>check_circle</span>
                      <span className="text-xs" style={{ color: colors.textSecondary }}>{i18n.t('settingsDialog.qrLoggedIn')}</span>
                      <div className="flex gap-1.5 mt-0.5">
                        <button
                          type="button"
                          onClick={() => void handleQrLogout()}
                          className="px-2 py-1 text-xs transition-all"
                          style={{
                            backgroundColor: colors.backgroundCard,
                            color: colors.textSecondary,
                            border: `1px solid ${colors.borderLight}`,
                            borderRadius: 'var(--theme-control-radius)',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
                        >
                          {i18n.t('settingsDialog.qrLogout')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void startQr(onlineSource)}
                          className="px-2 py-1 text-xs transition-all"
                          style={{
                            backgroundColor: `${colors.primary}20`,
                            color: colors.primary,
                            border: `1px solid ${colors.primary}`,
                            borderRadius: 'var(--theme-control-radius)',
                          }}
                        >
                          {i18n.t('settingsDialog.qrReLogin')}
                        </button>
                      </div>
                    </div>
                  ) : qrState === 'loading' ? (
                    <div className="flex flex-col items-center gap-2">
                      <span className="material-symbols-outlined text-5xl animate-spin">progress_activity</span>
                      <span className="text-xs" style={{ color: colors.textSecondary }}>{i18n.t('settingsDialog.qrLoading')}</span>
                    </div>
                  ) : qrImage ? (
                    <>
                      <img
                        src={qrImage}
                        alt="QR"
                        className="size-32 object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                      <div
                        className="absolute bottom-0 inset-x-0 px-2 py-1 text-center text-[11px] truncate"
                        style={{
                          backgroundColor: colors.backgroundDark,
                          color: qrState === 'confirming' ? colors.primary : colors.textSecondary,
                        }}
                      >
                        {qrMsg || i18n.t('settingsDialog.qrWaiting')}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 text-center px-2">
                      <span className="material-symbols-outlined text-5xl">
                        {qrState === 'expired' ? 'qr_code_scanner' : 'error'}
                      </span>
                      <span className="text-xs" style={{ color: colors.textSecondary }}>
                        {qrState === 'expired'
                          ? i18n.t('settingsDialog.qrExpired')
                          : (qrMsg || i18n.t('settingsDialog.qrError'))}
                      </span>
                      <button
                        type="button"
                        onClick={() => void startQr(onlineSource)}
                        className="mt-0.5 px-2 py-1 text-xs transition-all"
                        style={{
                          backgroundColor: `${colors.primary}20`,
                          color: colors.primary,
                          border: `1px solid ${colors.primary}`,
                          borderRadius: 'var(--theme-control-radius)',
                        }}
                      >
                        {i18n.t('settingsDialog.qrRefresh')}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="min-w-0 space-y-3">
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
                    className="w-full h-16 r-control p-2.5 text-sm focus:outline-none focus:ring-0 transition-all resize-none"
                    style={inputStyle}
                    onFocus={inputFocus}
                    onBlur={inputBlur}
                    disabled={isSavingOnline}
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
                      className="min-w-0 flex-1 r-control py-2 px-2.5 text-sm focus:outline-none focus:ring-0 transition-all"
                      style={inputStyle}
                      onFocus={inputFocus}
                      onBlur={inputBlur}
                      disabled={isSavingOnline}
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
                      disabled={isSavingOnline}
                      className="px-3 py-2 transition-all disabled:opacity-50 flex items-center flex-shrink-0"
                      style={{ backgroundColor: colors.backgroundCard, color: colors.textPrimary, border: `1px solid ${colors.borderLight}`, borderRadius: 'var(--theme-card-radius)' }}
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

                {onlineMessage && (
                  <div className={`p-2 r-control text-xs ${
                    onlineMessageType === 'success'
                      ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                      : 'bg-red-500/10 border border-red-500/30 text-red-400'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-xs">
                        {onlineMessageType === 'success' ? 'check' : 'error'}
                      </span>
                      {onlineMessage}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
          )}

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
