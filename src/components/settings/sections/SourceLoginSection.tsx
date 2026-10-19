import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { OnlineSource } from '@/services/settingsManager';
import type { SettingsTheme } from '../shared';
import { useSourceLogin } from '../hooks/useSourceLogin';
import Button from '../../ui/Button';
import SettingsMessage from '../SettingsMessage';

/**
 * A music source's sign-in inside its plugin card: QR login for the sources that support
 * it, and the cookie, which is a credential and so is checked before it is stored.
 */
export default function SourceLoginSection({ source, theme }: { source: OnlineSource; theme: SettingsTheme }) {
  const { t } = useTranslation();
  const { colors, inputStyle, inputFocus, inputBlur } = theme;
  const state = useSourceLogin(source);
  const cookieId = useId();
  const signedIn = state.signedIn && !state.qrScanning;
  const qrStatus = signedIn ? t('settingsDialog.qrLoggedIn')
    : state.qrState === 'loading' ? t('settingsDialog.qrLoading')
      : state.qrImage ? (state.qrMsg || t('settingsDialog.qrWaiting'))
        : state.qrState === 'expired' ? t('settingsDialog.qrExpired')
          : (state.qrMsg || t('settingsDialog.qrError'));

  return (
    <div className="space-y-3 text-xs" style={{ color: colors.textPrimary }}>
      {state.qrSupported && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">{t('settingsDialog.qrTitle')}</p>
              <p role="status" className="flex items-center gap-1"
                style={{ color: signedIn ? colors.textSecondary : state.qrState === 'confirming' ? colors.primary : colors.textMuted }}>
                {signedIn && <span className="material-symbols-rounded text-sm" style={{ color: '#22c55e' }} aria-hidden="true">check_circle</span>}
                {state.qrState === 'loading' && <span className="material-symbols-rounded text-sm animate-spin" aria-hidden="true">progress_activity</span>}
                {qrStatus}
              </p>
            </div>
            <div className="flex flex-shrink-0 gap-2">
              {signedIn ? (
                <>
                  <Button size="sm" onClick={() => void state.logout()}>{t('settingsDialog.qrLogout')}</Button>
                  <Button size="sm" onClick={() => void state.startQr()}>{t('settingsDialog.qrReLogin')}</Button>
                </>
              ) : state.qrState !== 'loading' && (
                <Button size="sm" onClick={() => void state.startQr()}>{t('settingsDialog.qrRefresh')}</Button>
              )}
            </div>
          </div>
          {!signedIn && state.qrImage && (
            <img src={state.qrImage} alt={t('settingsDialog.qrTitle')} className="size-32 mx-auto block rounded-md object-contain bg-white p-1"
              style={{ imageRendering: 'pixelated' }} />
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor={cookieId} className="block font-medium">
          {state.login === 'netease-qr' ? t('settingsDialog.neteaseCookieLabel') : t('settingsDialog.cookie')}
        </label>
        {!state.qrSupported && (
          <p style={{ color: colors.textMuted }}>
            {t(state.login === 'cookie' ? 'settingsDialog.cookieLoginHint' : 'settingsDialog.noLoginHint')}
          </p>
        )}
        <textarea
          id={cookieId}
          value={state.cookie}
          onChange={event => state.setCookie(event.target.value)}
          placeholder={t('settingsDialog.pasteCookie')}
          className="w-full h-16 r-control p-2.5 text-sm focus:outline-none focus:ring-0 transition-all resize-none no-scrollbar cookie-textarea"
          style={inputStyle}
          onFocus={inputFocus}
          onBlur={inputBlur}
          disabled={state.isSaving}
        />
        <div className="flex items-center justify-end gap-3">
          {state.cookieDirty && <span role="status" style={{ color: colors.textMuted }}>{t('settingsDialog.unsaved')}</span>}
          <Button variant="primary" size="sm" onClick={() => void state.saveCookie()}
            disabled={state.isSaving || (!state.cookieDirty && !state.cookie.trim())}>
            {state.isSaving ? (
              <>
                <span className="material-symbols-rounded animate-spin text-sm">refresh</span>
                {t('settingsDialog.saving')}
              </>
            ) : (
              t('settingsDialog.cookieSave')
            )}
          </Button>
        </div>
        {state.message && <SettingsMessage tone={state.message.tone}>{state.message.text}</SettingsMessage>}
      </div>
    </div>
  );
}
