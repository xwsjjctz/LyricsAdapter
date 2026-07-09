import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n as i18nService, type Language } from '../../services/i18n';
import { settingsManager } from '../../services/settingsManager';
import { getDesktopAPI } from '../../services/desktopAdapter';
import { logger } from '../../services/logger';
import ShortcutsSettings from '../ShortcutsSettings';
import GsapModal from '../GsapModal';
import RetroSwitch from '../RetroSwitch';
import { useCurrentTheme, useSettingsTheme, LANGUAGE_OPTIONS } from './settings/shared';
import { useWebdavSettings } from './settings/hooks/useWebdavSettings';
import { useOnlineMusicSettings } from './settings/hooks/useOnlineMusicSettings';
import WebdavSection from './settings/sections/WebdavSection';
import OnlineMusicSection from './settings/sections/OnlineMusicSection';

interface SettingsPanelProps {
  onClose: () => void;
  onClearOrphanCache?: () => Promise<{ metadataDeleted: number; coversDeleted: number; errors: string[] }>;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose, onClearOrphanCache }) => {
  const theme = useCurrentTheme();
  const themeUtils = useSettingsTheme(theme);
  const { colors, isBrutalistTheme, rangeClassName, rangeStyle } = themeUtils;

  const { t, i18n } = useTranslation();
  // Language + about
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');
  const langDropdownRef = useRef<HTMLDivElement>(null);

  // Appearance / experimental toggles & sliders (kept here: they share one
  // settingsManager subscription and feed both this panel and the live app.)
  const [bgBlurTrans, setBgBlurTrans] = useState(1.0);
  const [qqMusicEnabled, setQqMusicEnabled] = useState(false);
  const [newUxEnabled, setNewUxEnabled] = useState(false);
  const [focusBgBlurRadius, setFocusBgBlurRadius] = useState(80);
  const [focusLyricsFontSize, setFocusLyricsFontSize] = useState(30);
  const [focusLyricLineSpacing, setFocusLyricLineSpacing] = useState(32);
  const [focusInactiveLyricBlur, setFocusInactiveLyricBlur] = useState(2);

  // Clear-cache confirmation
  const [showClearCacheConfirm, setShowClearCacheConfirm] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheClearMessage, setCacheClearMessage] = useState<string | null>(null);
  const [cacheClearMessageType, setCacheClearMessageType] = useState<'success' | 'error' | null>(null);

  // Extracted sections own their own state.
  const webdav = useWebdavSettings();
  const onlineMusic = useOnlineMusicSettings({ enabled: qqMusicEnabled });

  // Initial load of appearance values + shared subscription.
  useEffect(() => {
    (async () => {
      await settingsManager.ensureLoaded();
      setBgBlurTrans(settingsManager.getBgBlurTrans());
      setQqMusicEnabled(settingsManager.getQqMusicEnabled());
      setNewUxEnabled(settingsManager.getNewUxEnabled());
      setFocusBgBlurRadius(settingsManager.getFocusBgBlurRadius());
      setFocusLyricsFontSize(settingsManager.getFocusLyricsFontSize());
      setFocusLyricLineSpacing(settingsManager.getFocusLyricLineSpacing());
      setFocusInactiveLyricBlur(settingsManager.getFocusInactiveLyricBlur());
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = settingsManager.subscribe(() => {
      setBgBlurTrans(settingsManager.getBgBlurTrans());
      setQqMusicEnabled(settingsManager.getQqMusicEnabled());
      setNewUxEnabled(settingsManager.getNewUxEnabled());
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
    getDesktopAPI()?.getAppVersion?.()
      .then(v => setAppVersion(v))
      .catch(e => logger.error('[SettingsPanel] getAppVersion failed:', e));
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
    i18nService.setLanguage(lang);
    setIsLangDropdownOpen(false);
  };

  const currentLanguageOption = LANGUAGE_OPTIONS.find(opt => opt.value === i18n.language);

  return (
    <>
      <aside className="new-ux-side-panel new-ux-side-panel--wide new-ux-panel-in">
        <header className="new-ux-side-panel__header">
          <div>
            <div className="new-ux-side-panel__eyebrow">{t('settings.title')}</div>
            <h2 className="new-ux-side-panel__title">{t('settings.description')}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onClose} aria-label="Close settings panel">
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>
          </div>
        </header>

        <div className="new-ux-side-panel__body new-ux-settings-panel__body">
          <div className="space-y-4">

            {/* Language + About */}
            <section>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="r-card p-3 border transition-colors" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="material-symbols-outlined text-lg" style={{ color: colors.primary }}>language</span>
                      <span className="text-sm truncate" style={{ color: colors.textPrimary }}>{t('settings.language')}</span>
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
                        className="new-ux-inline-popover absolute left-0 right-0 top-full overflow-hidden z-50"
                        style={{
                          transform: isLangDropdownOpen ? 'scaleY(1)' : 'scaleY(0)',
                          transformOrigin: 'top center',
                          opacity: isLangDropdownOpen ? 1 : 0,
                          pointerEvents: isLangDropdownOpen ? 'auto' : 'none',
                          transition: 'transform 0.25s ease, opacity 0.2s ease',
                          borderWidth: '0 1px 1px',
                          borderStyle: 'solid',
                          borderColor: isLangDropdownOpen ? colors.borderLight : 'transparent',
                          borderRadius: '0 0 var(--theme-card-radius) var(--theme-card-radius)',
                        }}
                      >
                        {LANGUAGE_OPTIONS.map((option) => {
                          const active = i18n.language === option.value;
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
                      <span className="text-sm" style={{ color: colors.textPrimary }}>{t('settings.about')}</span>
                      <span className="text-xs ml-2" style={{ color: colors.textMuted }}>v{appVersion || '…'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* WebDAV */}
            <WebdavSection
              theme={themeUtils}
              serverUrl={webdav.serverUrl}
              username={webdav.username}
              password={webdav.password}
              message={webdav.message}
              messageType={webdav.messageType}
              isTesting={webdav.isTesting}
              isSaving={webdav.isSaving}
              setServerUrl={webdav.setServerUrl}
              setUsername={webdav.setUsername}
              setPassword={webdav.setPassword}
              onTest={webdav.handleTest}
              onSave={webdav.handleSave}
            />

            {/* Experimental Features */}
            <section className="r-card p-4 border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: colors.textPrimary }}>
                <span className="material-symbols-outlined text-lg" style={{ color: colors.textMuted }}>science</span>
                {t('settings.experimental')}
              </h3>

              {/* 背景模糊透明度滑块 */}
              <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
                <span className="text-sm" style={{ color: colors.textSecondary }}>{t('settings.bgBlurTrans')}</span>
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
                    className={rangeClassName}
                    style={rangeStyle(bgBlurTrans * 100)}
                  />
                </div>
              </div>

              {/* Focus Mode 背景模糊半径 */}
              <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
                <span className="text-sm" style={{ color: colors.textSecondary }}>{t('settings.focusBgBlurRadius')}</span>
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
                    className={rangeClassName}
                    style={rangeStyle(((focusBgBlurRadius - 40) / 40) * 100)}
                  />
                </div>
              </div>

              {/* Focus Mode 滚动歌词字号 */}
              <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
                <span className="text-sm" style={{ color: colors.textSecondary }}>{t('settings.focusLyricsFontSize')}</span>
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
                    className={rangeClassName}
                    style={rangeStyle(((focusLyricsFontSize - 16) / 24) * 100)}
                  />
                </div>
              </div>

              {/* Focus Mode 滚动歌词行间距 */}
              <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
                <span className="text-sm" style={{ color: colors.textSecondary }}>{t('settings.focusLyricLineSpacing')}</span>
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
                    className={rangeClassName}
                    style={rangeStyle(((focusLyricLineSpacing - 12) / 36) * 100)}
                  />
                </div>
              </div>

              {/* Focus Mode 非当前歌词模糊 */}
              <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
                <span className="text-sm" style={{ color: colors.textSecondary }}>{t('settings.focusInactiveLyricBlur')}</span>
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
                    className={rangeClassName}
                    style={rangeStyle((focusInactiveLyricBlur / 12) * 100)}
                  />
                </div>
              </div>

              {/* 第三方音源开关 */}
              <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
                <span className="text-sm" style={{ color: colors.textSecondary }}>{t('settings.qqMusicEnabled')}</span>
                {isBrutalistTheme ? (
                  <RetroSwitch
                    checked={qqMusicEnabled}
                    ariaLabel={t('settings.qqMusicEnabled')}
                    onChange={(newValue) => {
                      setQqMusicEnabled(newValue);
                      settingsManager.setQqMusicEnabled(newValue);
                    }}
                  />
                ) : (
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
                )}
              </div>

              {/* 全新 UI/UX 开关 */}
              <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
                <div className="min-w-0 mr-3">
                  <span className="text-sm" style={{ color: colors.textSecondary }}>{t('settings.newUx')}</span>
                  <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>{t('settings.newUxDesc')}</p>
                </div>
                {isBrutalistTheme ? (
                  <RetroSwitch
                    checked={newUxEnabled}
                    ariaLabel={t('settings.newUx')}
                    onChange={(newValue) => {
                      setNewUxEnabled(newValue);
                      settingsManager.setNewUxEnabled(newValue);
                    }}
                  />
                ) : (
                  <button
                    onClick={() => {
                      const newValue = !newUxEnabled;
                      setNewUxEnabled(newValue);
                      settingsManager.setNewUxEnabled(newValue);
                    }}
                    className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0"
                    style={{ backgroundColor: newUxEnabled ? colors.primary : colors.borderLight }}
                    aria-label={t('settings.newUx')}
                    aria-pressed={newUxEnabled}
                  >
                    <span
                      className="inline-block size-5 rounded-full bg-white shadow-sm transform transition-transform duration-200"
                      style={{ transform: newUxEnabled ? 'translateX(22px)' : 'translateX(2px)' }}
                    />
                  </button>
                )}
              </div>

              {/* 清理孤儿缓存按钮 */}
              <div className="mt-3 pt-3 border-t flex items-center justify-between" style={{ borderColor: colors.borderLight }}>
                <div>
                  <span className="text-sm" style={{ color: colors.textSecondary }}>{t('settings.clearCache')}</span>
                  <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>{t('settings.clearCacheDesc')}</p>
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
                  {t('settings.clearCache')}
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
              <OnlineMusicSection
                theme={themeUtils}
                onlineSource={onlineMusic.onlineSource}
                cookie={onlineMusic.cookie}
                neteaseCookie={onlineMusic.neteaseCookie}
                downloadPath={onlineMusic.downloadPath}
                isQrLoggedIn={onlineMusic.isQrLoggedIn}
                qrScanning={onlineMusic.qrScanning}
                qrState={onlineMusic.qrState}
                qrImage={onlineMusic.qrImage}
                qrMsg={onlineMusic.qrMsg}
                isSaving={onlineMusic.isSaving}
                message={onlineMusic.message}
                messageType={onlineMusic.messageType}
                setOnlineSource={onlineMusic.setOnlineSource}
                setCookie={onlineMusic.setCookie}
                setNeteaseCookie={onlineMusic.setNeteaseCookie}
                setDownloadPath={onlineMusic.setDownloadPath}
                onSave={onlineMusic.handleSave}
                startQr={onlineMusic.startQr}
                onQrLogout={onlineMusic.handleQrLogout}
              />
            )}

          </div>
        </div>
      </aside>

      {/* 清理缓存二次确认弹窗 */}
      <GsapModal
        isOpen={showClearCacheConfirm}
        overlayClassName="z-50"
        overlayStyle={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        panelClassName="r-control p-6 max-w-md w-full mx-4 shadow-2xl"
        panelStyle={{ backgroundColor: colors.backgroundDark, border: `1px solid ${colors.borderLight}` }}
      >
          <h3 className="text-lg font-semibold mb-2" style={{ color: colors.textPrimary }}>{t('settings.clearCacheConfirmTitle')}</h3>
          <p className="mb-4" style={{ color: colors.textSecondary }}>{t('settings.clearCacheConfirmBody')}</p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowClearCacheConfirm(false)}
              disabled={isClearingCache}
              className="px-4 py-2 r-card transition-all"
              style={{ color: colors.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={async () => {
                if (!onClearOrphanCache) return;
                setIsClearingCache(true);
                setCacheClearMessage(null);
                try {
                  const result = await onClearOrphanCache();
                  if (result.errors.length > 0) {
                    setCacheClearMessage(`${t('settings.clearCacheDone')} ${result.metadataDeleted} metadata, ${result.coversDeleted} covers (${result.errors.length} errors)`);
                    setCacheClearMessageType('error');
                  } else {
                    setCacheClearMessage(`${t('settings.clearCacheDone')} ${result.metadataDeleted} metadata, ${result.coversDeleted} covers`);
                    setCacheClearMessageType('success');
                  }
                } catch (error) {
                  setCacheClearMessage(t('settings.clearCacheFailed'));
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
                  {t('settings.clearing')}
                </>
              ) : (
                t('settings.confirmClearCache')
              )}
            </button>
          </div>
      </GsapModal>
    </>
  );
};

export default SettingsPanel;
