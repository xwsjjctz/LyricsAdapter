import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '../../../i18n';
import { getDesktopAPI } from '../../../services/desktopAdapter';
import { logger } from '../../../services/logger';
import { settingsManager } from '../../../services/settingsManager';
import Switch from '../../ui/Switch';
import { useSettingValue } from '../hooks/useSettingValue';
import { LANGUAGE_OPTIONS, type SettingsTheme } from '../shared';

const readListDensity = () => settingsManager.getListDensity();

interface GeneralSectionProps {
  theme: SettingsTheme;
}

/** Language, list density and version information. */
export default function GeneralSection({ theme }: GeneralSectionProps) {
  const { t, i18n } = useTranslation();
  const { colors } = theme;
  const [appVersion, setAppVersion] = useState('');
  const languageId = useId();
  const compactDescriptionId = useId();
  const isCompact = useSettingValue(readListDensity) === 'compact';

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
        <div className="min-w-0">
          <div className="settings-row__label" style={{ color: colors.textPrimary }}>{t('settings.compactList')}</div>
          <div id={compactDescriptionId} className="mt-0.5 text-xs" style={{ color: colors.textMuted }}>
            {t('settings.compactListDesc')}
          </div>
        </div>
        <Switch checked={isCompact} label={t('settings.compactList')} describedBy={compactDescriptionId}
          onChange={enabled => { void settingsManager.setListDensity(enabled ? 'compact' : 'comfortable'); }} />
      </div>
      <div className="settings-row" style={{ borderColor: colors.borderLight }}>
        <span className="settings-row__label" style={{ color: colors.textPrimary }}>{t('settings.about')}</span>
        <span className="text-sm tabular-nums" style={{ color: colors.textMuted }}>LyricsAdapter v{appVersion || '…'}</span>
      </div>
    </div>
  );
}
