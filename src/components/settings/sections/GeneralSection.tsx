import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '../../../i18n';
import { getDesktopAPI } from '../../../services/desktopAdapter';
import { logger } from '../../../services/logger';
import { LANGUAGE_OPTIONS, type SettingsTheme } from '../shared';

interface GeneralSectionProps {
  theme: SettingsTheme;
}

/** Language and version information. */
export default function GeneralSection({ theme }: GeneralSectionProps) {
  const { t, i18n } = useTranslation();
  const { colors } = theme;
  const [appVersion, setAppVersion] = useState('');
  const languageId = useId();

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
    </div>
  );
}
