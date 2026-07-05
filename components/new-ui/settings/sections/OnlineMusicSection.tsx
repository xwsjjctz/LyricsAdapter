import React from 'react';
import { i18n } from '@/services/i18n';
import { getDesktopAPI } from '@/services/desktopAdapter';
import { SOURCE_OPTIONS } from '../shared';
import type { SettingsTheme } from '../shared';
import type { OnlineSource } from '@/services/settingsManager';
import type { QRLoginStatus } from '@/services/qrLogin';

interface OnlineMusicSectionProps {
  theme: SettingsTheme;
  onlineSource: OnlineSource;
  cookie: string;
  neteaseCookie: string;
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
  setNeteaseCookie: (v: string) => void;
  setDownloadPath: (v: string) => void;
  onSave: () => void;
  startQr: (source: OnlineSource) => void;
  onQrLogout: () => void;
}

/**
 * Third-party (QQ/NetEase) online music settings card, including QR scan-login.
 * Pure presentational — all state and the QR lifecycle come from
 * useOnlineMusicSettings via props.
 */
const OnlineMusicSection: React.FC<OnlineMusicSectionProps> = ({
  theme,
  onlineSource,
  cookie,
  neteaseCookie,
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
  setNeteaseCookie,
  setDownloadPath,
  onSave,
  startQr,
  onQrLogout,
}) => {
  const { colors, inputStyle, inputFocus, inputBlur } = theme;

  return (
    <section className="r-card p-4 border mb-4" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: colors.textPrimary }}>
          <span className="material-symbols-outlined text-lg" style={{ color: colors.primary }}>music_note</span>
          {i18n.t('settingsDialog.onlineMusicTitle')}
        </h3>
        <button
          onClick={onSave}
          disabled={isSaving}
          className="px-4 py-2 text-sm transition-all disabled:opacity-50 flex items-center gap-2 flex-shrink-0"
          style={{ backgroundColor: colors.primary, color: '#fff', border: `1px solid ${colors.borderLight}`, borderRadius: 'var(--theme-card-radius)' }}
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

      <div className="grid grid-cols-1 md:grid-cols-[190px_176px_minmax(220px,1fr)] gap-6">
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
            {SOURCE_OPTIONS.map((option) => {
              const active = onlineSource === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setOnlineSource(option.value)}
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
                onClick={() => startQr(onlineSource)}
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
                    onClick={onQrLogout}
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
                    onClick={() => startQr(onlineSource)}
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
                  onClick={() => startQr(onlineSource)}
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
              className="w-full h-16 r-control p-2.5 text-sm focus:outline-none focus:ring-0 transition-all resize-none no-scrollbar cookie-textarea"
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
                className="min-w-0 flex-1 r-control py-2 px-2.5 text-sm focus:outline-none focus:ring-0 transition-all"
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

          {message && (
            <div className={`p-2 r-control text-xs ${
              messageType === 'success'
                ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}>
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-xs">
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
