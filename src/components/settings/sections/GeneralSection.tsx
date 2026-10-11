import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '../../../i18n';
import { getDesktopAPI, type UpdaterState } from '../../../services/desktopAdapter';
import { logger } from '../../../services/logger';
import { LANGUAGE_OPTIONS, type SettingsTheme } from '../shared';
import Button from '../../ui/Button';

interface GeneralSectionProps {
  theme: SettingsTheme;
}

/** In-app updates are Windows-only; unsigned macOS builds cannot self-update. */
function useAppUpdater(enabled: boolean): UpdaterState {
  const [state, setState] = useState<UpdaterState>({ status: 'idle' });
  useEffect(() => {
    const api = getDesktopAPI();
    if (!enabled || !api) return;
    let live = true;
    // The startup check usually finishes before this section mounts.
    api.getUpdaterState?.()
      .then(current => { if (live) setState(current); })
      .catch(error => logger.warn('[Settings] getUpdaterState failed:', error));
    const onEvent = (next: UpdaterState) => setState(next);
    api.onUpdaterEvent?.(onEvent);
    return () => { live = false; api.offUpdaterEvent?.(onEvent); };
  }, [enabled]);
  return state;
}

/** Language, version information and (on Windows) app updates. */
export default function GeneralSection({ theme }: GeneralSectionProps) {
  const { t, i18n } = useTranslation();
  const { colors } = theme;
  const [appVersion, setAppVersion] = useState('');
  const languageId = useId();
  const canUpdate = getDesktopAPI()?.platform === 'win32';
  const updater = useAppUpdater(canUpdate);
  const updateBusy = updater.status === 'checking' || updater.status === 'available' || updater.status === 'downloading';

  const checkForUpdates = () => {
    getDesktopAPI()?.checkForUpdates?.()
      .catch(error => logger.error('[Settings] checkForUpdates failed:', error));
  };
  const restartToUpdate = () => {
    getDesktopAPI()?.quitAndInstall?.()
      .catch(error => logger.error('[Settings] quitAndInstall failed:', error));
  };
  const updateStatus = (() => {
    switch (updater.status) {
      case 'checking': return t('updater.checking');
      case 'not-available': return t('updater.upToDate');
      case 'available': return `${t('updater.available')} v${updater.info.version}`;
      case 'downloading': return `${t('updater.downloading')} v${updater.info.version}${updater.progress ? ` ${Math.round(updater.progress.percent)}%` : ''}`;
      case 'downloaded': return `${t('updater.downloaded')} v${updater.info.version}`;
      case 'error': return t('updater.failed');
      default: return '';
    }
  })();

  useEffect(() => {
    getDesktopAPI()?.getAppVersion?.()
      .then(setAppVersion)
      .catch(error => logger.error('[Settings] getAppVersion failed:', error));
  }, []);

  return (
    <div className="settings-card r-card border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
      <div className="settings-row">
        <label htmlFor={languageId} className="settings-row__label" style={{ color: colors.textPrimary }}>
          {t('settings.language')}
        </label>
        <select
          id={languageId}
          className="settings-select"
          value={i18n.language}
          style={{ ...theme.inputStyle, color: colors.textSecondary }}
          onChange={event => { void i18n.changeLanguage(event.target.value as Language); }}
        >
          {LANGUAGE_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.nativeLabel}</option>
          ))}
        </select>
      </div>
      <div className="settings-row" style={{ borderColor: colors.borderLight }}>
        <span className="settings-row__label" style={{ color: colors.textPrimary }}>{t('settings.about')}</span>
        <span className="text-sm tabular-nums" style={{ color: colors.textMuted }}>LyricsAdapter v{appVersion || '…'}</span>
      </div>
      {canUpdate && (
        <div className="settings-row" style={{ borderColor: colors.borderLight }} data-testid="app-updater">
          <span role="status" className="text-sm tabular-nums" style={{ color: colors.textSecondary }}
            title={updater.status === 'error' ? updater.message : undefined}>
            {updateStatus}
          </span>
          {updater.status === 'downloaded'
            ? <Button size="sm" variant="primary" onClick={restartToUpdate}>{t('updater.restart')}</Button>
            : <Button size="sm" disabled={updateBusy} onClick={checkForUpdates}>{t('updater.check')}</Button>}
        </div>
      )}
    </div>
  );
}
