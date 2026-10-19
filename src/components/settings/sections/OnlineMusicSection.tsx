import React from 'react';
import { useTranslation } from 'react-i18next';
import { getDesktopAPI } from '@/services/desktopAdapter';
import type { SettingsTheme } from '../shared';
import { settingsManager } from '@/services/settingsManager';
import type { OnlineSource } from '@/services/settingsManager';
import type { QRLoginStatus } from '@/services/qrLogin';
import { sourceLabel, type MusicSourceLogin } from '@/services/musicSources';
import Button from '../../ui/Button';

// Panels inside the settings sheet are a faint wash of the text colour, so the
// sheet's glass shows through instead of an opaque slab.
const PANEL_FILL = (text: string) => `color-mix(in srgb, ${text} 6%, transparent)`;
const PANEL_BORDER = (text: string) => `color-mix(in srgb, ${text} 10%, transparent)`;

// Presentational provider settings section used by the application settings panel.

interface OnlineMusicSectionProps {
  theme: SettingsTheme;
  sources?: OnlineSource[];
  onlineSource: OnlineSource;
  login: MusicSourceLogin;
  cookie: string;
  cookieDirty: boolean;
  downloadPath: string;
  isQrLoggedIn: boolean;
  qrScanning: boolean;
  qrState: 'idle' | 'loading' | QRLoginStatus;
  qrImage: string | null;
  qrMsg: string;
  isSaving: boolean;
  message: string | null;
  messageType: 'success' | 'error' | null;
  setOnlineSource: (source: OnlineSource) => void;
  setCookie: (v: string) => void;
  setDownloadPath: (v: string) => void;
  onSaveCookie: () => void;
  startQr: (source: OnlineSource) => void;
  onQrLogout: () => void;
}

/**
 * Online music settings card. QR login appears for sources that support it;
 * every source accepts a cookie.
 * Pure presentational — all state and the QR lifecycle come from
 * useOnlineMusicSettings via props.
 */
const OnlineMusicSection: React.FC<OnlineMusicSectionProps> = ({
  theme,
  sources,
  onlineSource,
  login,
  cookie,
  cookieDirty,
  downloadPath,
  isQrLoggedIn,
  qrScanning,
  qrState,
  qrImage,
  qrMsg,
  isSaving,
  message,
  messageType,
  setOnlineSource,
  setCookie,
  setDownloadPath,
  onSaveCookie,
  startQr,
  onQrLogout,
}) => {
  const { t } = useTranslation();
  const { colors, inputStyle, inputFocus, inputBlur } = theme;
  // Re-derived each render so labels follow the current i18n language.
  const sourceOptions = (sources ?? [onlineSource]).map(value => ({ value, label: sourceLabel(value) }));
  const qrSupported = login === 'qq-qr' || login === 'netease-qr';

  return (
    <section className="r-card p-4 border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
      <div className="mb-3">
        <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: colors.textPrimary }}>
          <span className="material-symbols-rounded text-lg" style={{ color: colors.primary }}>music_note</span>
          {t('settingsDialog.onlineMusicTitle')}
        </h3>
      </div>


      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="text-xs mb-1.5" style={{ color: colors.textSecondary }}>
            {t('settingsDialog.onlineSource')}
          </div>
          <div
            className="h-44 overflow-y-auto no-scrollbar p-2 space-y-1"
            style={{
              backgroundColor: PANEL_FILL(colors.textPrimary),
              border: `1px solid ${PANEL_BORDER(colors.textPrimary)}`,
              borderRadius: 'var(--theme-card-radius)',
            }}
          >
            {sourceOptions.map((option) => {
              const active = onlineSource === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setOnlineSource(option.value)}
                  className="settings-source-option w-full px-3 py-2 text-left transition-colors text-xs flex items-center justify-between gap-2"
                  aria-pressed={active}
                >
                  <span className="truncate">{option.label}</span>
                  {active && <span className="material-symbols-rounded text-sm flex-shrink-0" style={{ color: colors.primary }}>check</span>}
                </button>
              );
            })}
          </div>
        </div>

        {qrSupported ? (
          <div className="min-w-0">
            <div className="text-xs mb-1.5 flex items-center justify-between gap-2" style={{ color: colors.textSecondary }}>
              <span>{t('settingsDialog.qrTitle')}</span>
              {(qrImage || qrState === 'error' || qrState === 'expired') && (
                <button
                  type="button"
                  onClick={() => startQr(onlineSource)}
                  aria-label={t('settingsDialog.qrRefresh')}
                  className="material-symbols-rounded text-xs leading-none opacity-60 hover:opacity-100 transition-opacity"
                  style={{ color: colors.textSecondary }}
                >
                  refresh
                </button>
              )}
            </div>
            <div
              className="h-44 w-full r-control relative flex flex-col items-center justify-center overflow-hidden"
              style={{
                backgroundColor: PANEL_FILL(colors.textPrimary),
                border: `1px solid ${PANEL_BORDER(colors.textPrimary)}`,
                color: colors.textMuted,
              }}
            >
              {/* Logged-in panel */}
              {isQrLoggedIn && !qrScanning ? (
                <div className="flex flex-col items-center gap-1.5 text-center px-2">
                  <span className="material-symbols-rounded text-5xl" style={{ color: '#22c55e' }}>check_circle</span>
                  <span className="text-xs" style={{ color: colors.textSecondary }}>{t('settingsDialog.qrLoggedIn')}</span>
                  <div className="flex gap-1.5 mt-0.5">
                    <button
                      type="button"
                      onClick={onQrLogout}
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                    >
                      {t('settingsDialog.qrLogout')}
                    </button>
                    <button
                      type="button"
                      onClick={() => startQr(onlineSource)}
                      className="px-2 py-1 text-xs transition-all"
                      style={{
                        backgroundColor: `${colors.primary}20`,
                        color: colors.primary,
                        border: `1px solid ${colors.primary}`,
                        borderRadius: 'var(--theme-control-radius)',
                      }}
                    >
                      {t('settingsDialog.qrReLogin')}
                    </button>
                  </div>
                </div>
              ) : qrState === 'loading' ? (
                <div className="flex flex-col items-center gap-2">
                  <span className="material-symbols-rounded text-5xl animate-spin">progress_activity</span>
                  <span className="text-xs" style={{ color: colors.textSecondary }}>{t('settingsDialog.qrLoading')}</span>
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
                      color: qrState === 'confirming' ? colors.primary : colors.textSecondary,
                    }}
                  >
                    {qrMsg || t('settingsDialog.qrWaiting')}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-center px-2">
                  <span className="material-symbols-rounded text-5xl">
                    {qrState === 'expired' ? 'qr_code_scanner' : 'error'}
                  </span>
                  <span className="text-xs" style={{ color: colors.textSecondary }}>
                    {qrState === 'expired'
                      ? t('settingsDialog.qrExpired')
                      : (qrMsg || t('settingsDialog.qrError'))}
                  </span>
                  <button
                    type="button"
                    onClick={() => startQr(onlineSource)}
                    className="mt-0.5 px-2 py-1 text-xs transition-all"
                    style={{
                      backgroundColor: `${colors.primary}20`,
                      color: colors.primary,
                      border: `1px solid ${colors.primary}`,
                      borderRadius: 'var(--theme-control-radius)',
                    }}
                  >
                    {t('settingsDialog.qrRefresh')}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="min-w-0 text-xs leading-relaxed" style={{ color: colors.textSecondary }}>
            {t(login === 'cookie' ? 'settingsDialog.cookieLoginHint' : 'settingsDialog.noLoginHint')}
          </div>
        )}

        <div className="min-w-0 space-y-3 sm:col-span-2">
          {/* Provider cookie */}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: colors.textSecondary }}>
              {login === 'netease-qr'
                ? t('settingsDialog.neteaseCookieLabel')
                : t('settingsDialog.cookie')}
            </label>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder={t('settingsDialog.pasteCookie')}
              className="w-full h-16 r-control p-2.5 text-sm focus:outline-none focus:ring-0 transition-all resize-none no-scrollbar cookie-textarea"
              style={inputStyle}
              onFocus={inputFocus}
              onBlur={inputBlur}
              disabled={isSaving}
            />
            {/* The cookie is a credential: it is checked with the source before it is stored. */}
            <div className="mt-1.5 flex items-center justify-end gap-3">
              {cookieDirty && <span className="text-xs" role="status" style={{ color: colors.textMuted }}>{t('settingsDialog.unsaved')}</span>}
              <Button variant="primary" size="sm" onClick={onSaveCookie} disabled={isSaving || (!cookieDirty && !cookie.trim())}>
                {isSaving ? (
                  <>
                    <span className="material-symbols-rounded animate-spin text-sm">refresh</span>
                    {t('settingsDialog.saving')}
                  </>
                ) : (
                  t('settingsDialog.cookieSave')
                )}
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1.5" style={{ color: colors.textSecondary }}>
              {t('settingsDialog.savePath')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
                placeholder={t('settingsDialog.downloadFolderPath')}
                className="min-w-0 flex-1 r-control py-2 px-2.5 text-sm focus:outline-none focus:ring-0 transition-all"
                style={inputStyle}
                onFocus={inputFocus}
                onBlur={(e) => {
                  inputBlur(e);
                  // A preference, not a credential: it applies without a Save step.
                  settingsManager.setDownloadPath(e.target.value.trim());
                }}
              />
              <button
                onClick={async () => {
                  const desktopAPI = getDesktopAPI();
                  if (desktopAPI?.selectDownloadFolder) {
                    const result = await desktopAPI.selectDownloadFolder();
                    if (result.success && result.path) {
                      setDownloadPath(result.path);
                      settingsManager.setDownloadPath(result.path);
                    }
                  }
                }}
                aria-label={t('settingsDialog.chooseDownloadFolder')}
                className="ui-btn ui-btn--secondary ui-btn--md flex-shrink-0"
              >
                <span className="material-symbols-rounded text-base">folder_open</span>
              </button>
            </div>
            <p className="mt-1 text-xs" style={{ color: colors.textMuted }}>
              {t('settingsDialog.tip')}
            </p>
          </div>

          {message && (
            <div className={`p-2 r-control text-xs ${
              messageType === 'success'
                ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}>
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-rounded text-xs">
                  {messageType === 'success' ? 'check' : 'error'}
                </span>
                {message}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default OnlineMusicSection;
