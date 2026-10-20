import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '../../../i18n';
import { getDesktopAPI, type UpdaterState } from '../../../services/desktopAdapter';
import { logger } from '../../../services/logger';
import { settingsManager } from '../../../services/settingsManager';
import type { CoverCacheInfo } from '../../../types/coverCache';
import { LANGUAGE_OPTIONS, type SettingsTheme } from '../shared';
import Button from '../../ui/Button';
import { formatBytes } from './PluginConfiguration';

interface GeneralSectionProps {
  theme: SettingsTheme;
}

/** The main process determines whether this installed build supports updates. */
function useAppUpdater(): UpdaterState | null {
  const [state, setState] = useState<UpdaterState | null>(null);
  useEffect(() => {
    const api = getDesktopAPI();
    if (!api) return;
    let live = true;
    let receivedEvent = false;
    const onEvent = (next: UpdaterState) => {
      if (!live) return;
      receivedEvent = true;
      setState(next);
    };
    api.onUpdaterEvent?.(onEvent);
    // The startup check usually finishes before this section mounts.
    api.getUpdaterState?.()
      .then(current => { if (live && !receivedEvent) setState(current); })
      .catch(error => logger.warn('[Settings] getUpdaterState failed:', error));
    return () => { live = false; api.offUpdaterEvent?.(onEvent); };
  }, []);
  return state;
}

/** Where online songs are saved. A preference, not a credential: it applies without a Save step. */
export function useDownloadPath() {
  const [path, setPath] = useState('');
  useEffect(() => {
    let live = true;
    void settingsManager.ensureLoaded().then(() => { if (live) setPath(settingsManager.getDownloadPath()); });
    return () => { live = false; };
  }, []);
  const store = (value: string) => {
    void settingsManager.setDownloadPath(value)
      .catch(error => logger.error('[Settings] setDownloadPath failed:', error));
  };
  const chooseFolder = async () => {
    const result = await getDesktopAPI()?.selectDownloadFolder?.();
    if (result?.success && result.path) { setPath(result.path); store(result.path); }
  };
  return { path, setPath, store, chooseFolder };
}

function DownloadPathRow({ theme }: { theme: SettingsTheme }) {
  const { t } = useTranslation();
  const { colors, inputStyle, inputFocus, inputBlur } = theme;
  const pathId = useId();
  const { path, setPath, store, chooseFolder } = useDownloadPath();
  return (
    <div className="settings-row settings-row--stacked" style={{ borderColor: colors.borderLight }}>
      <label htmlFor={pathId} className="settings-row__label" style={{ color: colors.textPrimary }}>{t('settingsDialog.savePath')}</label>
      <div className="flex gap-2">
        <input id={pathId} type="text" value={path} placeholder={t('settingsDialog.downloadFolderPath')}
          className="min-w-0 flex-1 r-control py-2 px-2.5 text-sm focus:outline-none focus:ring-0 transition-all"
          style={inputStyle} onFocus={inputFocus}
          onChange={event => setPath(event.target.value)}
          onBlur={event => { inputBlur(event); store(event.target.value.trim()); }} />
        <button type="button" onClick={() => void chooseFolder()} aria-label={t('settingsDialog.chooseDownloadFolder')}
          className="ui-btn ui-btn--secondary ui-btn--md flex-shrink-0">
          <span className="material-symbols-rounded text-base" aria-hidden="true">folder_open</span>
        </button>
      </div>
      <p className="text-xs" style={{ color: colors.textMuted }}>{t('settingsDialog.tip')}</p>
    </div>
  );
}

/** Online covers kept on disk by the main process; null where nothing uses them. Shared by both sheets. */
export function useCoverCache() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<CoverCacheInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const api = getDesktopAPI();
    // Only macOS's native surfaces (AppKit draws their covers) fill this cache today.
    if (api?.platform !== 'darwin' || !api.coverCacheInfo) return;
    let live = true;
    api.coverCacheInfo()
      .then(next => { if (live) setInfo(next); })
      .catch(cause => logger.warn('[Settings] coverCacheInfo failed:', cause));
    return () => { live = false; };
  }, []);
  const clear = async () => {
    const api = getDesktopAPI();
    if (!api?.clearCoverCache) return;
    setBusy(true); setError('');
    try {
      setInfo(await api.clearCoverCache());
    } catch (cause) {
      logger.error('[Settings] clearCoverCache failed:', cause);
      setError(t('settings.coverCacheClearFailed'));
    } finally {
      setBusy(false);
    }
  };
  return { info, size: info ? formatBytes(info.bytes) : '', busy, error, clear };
}

function CoverCacheRow({ theme }: { theme: SettingsTheme }) {
  const { t } = useTranslation();
  const { colors } = theme;
  const descriptionId = useId();
  const { info, size, busy, error, clear } = useCoverCache();
  if (!info) return null;
  return (
    <div className="settings-row" style={{ borderColor: colors.borderLight }}>
      <div className="min-w-0">
        <div className="settings-row__label" style={{ color: colors.textPrimary }}>{t('settings.coverCache')}</div>
        <div id={descriptionId} className="mt-0.5 text-xs" style={{ color: colors.textMuted }}>{t('settings.coverCacheDesc')}</div>
        {error && <div role="alert" className="mt-0.5 text-xs" style={{ color: colors.error }}>{error}</div>}
      </div>
      <div className="flex flex-shrink-0 items-center gap-3">
        <span className="text-sm tabular-nums" style={{ color: colors.textMuted }} data-testid="cover-cache-size">{size}</span>
        <Button size="sm" disabled={busy || !info.entries} aria-describedby={descriptionId} onClick={() => void clear()}>
          {t('settings.coverCacheClear')}
        </Button>
      </div>
    </div>
  );
}

/** Version information and installed-app updates, shared by the web and native sheets. */
export function useGeneralSettings() {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState('');
  const updater = useAppUpdater();
  const canUpdate = updater !== null && updater.status !== 'unavailable';
  const updateBusy = updater?.status === 'checking' || updater?.status === 'available' || updater?.status === 'downloading';

  const checkForUpdates = () => {
    getDesktopAPI()?.checkForUpdates?.()
      .catch(error => logger.error('[Settings] checkForUpdates failed:', error));
  };
  const restartToUpdate = () => {
    getDesktopAPI()?.quitAndInstall?.()
      .catch(error => logger.error('[Settings] quitAndInstall failed:', error));
  };
  const updateStatus = (() => {
    switch (updater?.status) {
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

  return { appVersion, updater, canUpdate, updateBusy, updateStatus, checkForUpdates, restartToUpdate };
}

/** Language, download folder, cover cache, version information and installed-app updates. */
export default function GeneralSection({ theme }: GeneralSectionProps) {
  const { t, i18n } = useTranslation();
  const { colors } = theme;
  const languageId = useId();
  const { appVersion, updater, canUpdate, updateBusy, updateStatus, checkForUpdates, restartToUpdate } = useGeneralSettings();

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
      <DownloadPathRow theme={theme} />
      <CoverCacheRow theme={theme} />
      <div className="settings-row" style={{ borderColor: colors.borderLight }}>
        <span className="settings-row__label" style={{ color: colors.textPrimary }}>{t('settings.about')}</span>
        <span className="text-sm tabular-nums" style={{ color: colors.textMuted }}>LyricsAdapter v{appVersion || '…'}</span>
      </div>
      {canUpdate && updater && (
        <div className="settings-row" style={{ borderColor: colors.borderLight }} data-testid="app-updater">
          <span role="status" className="text-sm tabular-nums break-words" style={{ color: colors.textSecondary }}>
            {updateStatus}
            {updater.status === 'error' && <span className="block text-xs">{updater.message}</span>}
          </span>
          {updater.status === 'downloaded'
            ? <Button size="sm" variant="primary" onClick={restartToUpdate}>{t('updater.restart')}</Button>
            : <Button size="sm" disabled={updateBusy} onClick={checkForUpdates}>{t('updater.check')}</Button>}
        </div>
      )}
    </div>
  );
}
