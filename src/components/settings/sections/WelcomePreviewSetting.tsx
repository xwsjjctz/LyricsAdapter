import { useTranslation } from 'react-i18next';
import type { SettingsTheme } from '../shared';
import Button from '../../ui/Button';

/** Tries the empty-library welcome page on an installation that already has songs. */
export default function WelcomePreviewSetting({ theme, onPreview }: { theme: SettingsTheme; onPreview: () => void }) {
  const { t } = useTranslation();
  const { colors } = theme;
  return (
    <div className="settings-card r-card border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
      <div className="settings-row">
        <div className="min-w-0">
          <div className="settings-row__label" style={{ color: colors.textSecondary }}>{t('settings.welcomePreview')}</div>
          <div id="welcome-preview-description" className="mt-0.5 text-xs" style={{ color: colors.textMuted }}>
            {t('settings.welcomePreviewDesc')}
          </div>
        </div>
        <Button size="sm" className="flex-shrink-0" aria-describedby="welcome-preview-description" onClick={onPreview}>
          {t('settings.welcomePreviewAction')}
        </Button>
      </div>
    </div>
  );
}
