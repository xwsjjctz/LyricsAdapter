import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { settingsManager } from '../../services/settingsManager';
import ShortcutsSettings from '../ShortcutsSettings';
import { Switch } from '../ui';
import { useOnlineMusicSettings } from './hooks/useOnlineMusicSettings';
import { useSettingValue } from './hooks/useSettingValue';
import { useWebdavSettings } from './hooks/useWebdavSettings';
import FocusModeSection from './sections/FocusModeSection';
import GeneralSection from './sections/GeneralSection';
import OnlineMusicSection from './sections/OnlineMusicSection';
import WebdavSection from './sections/WebdavSection';
import { useCurrentTheme, useSettingsTheme } from './shared';

export type SettingsSectionId = 'general' | 'online' | 'cloud' | 'focus' | 'shortcuts';

const SECTIONS: { id: SettingsSectionId; icon: string; labelKey: string }[] = [
  { id: 'general', icon: 'tune', labelKey: 'settings.nav.general' },
  { id: 'online', icon: 'language', labelKey: 'settings.nav.online' },
  { id: 'cloud', icon: 'cloud', labelKey: 'settings.nav.cloud' },
  { id: 'focus', icon: 'fullscreen', labelKey: 'settings.nav.focus' },
  { id: 'shortcuts', icon: 'keyboard', labelKey: 'settings.shortcuts.title' },
];

const readOnlineEnabled = () => settingsManager.getQqMusicEnabled();

interface SettingsViewProps {
  initialSection?: SettingsSectionId | undefined;
  bottomInset?: number;
}

/** Full settings page: section list on the left, one section at a time. */
export default function SettingsView({ initialSection = 'general', bottomInset = 0 }: SettingsViewProps) {
  const { t } = useTranslation();
  const themeUtils = useSettingsTheme(useCurrentTheme());
  const { colors } = themeUtils;
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const onlineEnabled = useSettingValue(readOnlineEnabled);
  const webdav = useWebdavSettings();
  const onlineMusic = useOnlineMusicSettings({ enabled: onlineEnabled });
  const activeLabel = t(SECTIONS.find(entry => entry.id === section)!.labelKey);

  return (
    <div className="library-view settings-view h-full flex flex-col">
      <header className="mb-6 flex-shrink-0">
        <h1 className="text-3xl" style={{ color: colors.textPrimary, fontWeight: 'var(--theme-text-heading-weight)', letterSpacing: 'var(--theme-heading-letter-spacing)' }}>
          {t('settings.title')}
        </h1>
        <p style={{ color: colors.textMuted }}>{t('settings.description')}</p>
      </header>

      <div className="settings-view__body flex-1 min-h-0">
        <nav aria-label={t('settings.title')} className="settings-nav">
          {SECTIONS.map(entry => {
            const current = entry.id === section;
            return (
              <button
                key={entry.id}
                type="button"
                aria-current={current ? 'page' : undefined}
                className={`settings-nav__item${current ? ' settings-nav__item--current' : ''}`}
                style={current ? { color: colors.textPrimary, backgroundColor: colors.backgroundCardHover } : { color: colors.textMuted }}
                onClick={() => setSection(entry.id)}
              >
                <span className="material-symbols-outlined" aria-hidden="true">{entry.icon}</span>
                <span>{t(entry.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        <section aria-label={activeLabel} className="settings-view__content no-scrollbar" style={{ paddingBottom: bottomInset }}>
          <h2 className="settings-view__section-title" style={{ color: colors.textPrimary }}>{activeLabel}</h2>

          {section === 'general' && <GeneralSection theme={themeUtils} />}

          {section === 'online' && (
            <div className="space-y-4">
              <div className="settings-card r-card border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
                <div className="settings-row">
                  <div className="min-w-0">
                    <div className="settings-row__label" style={{ color: colors.textPrimary }}>{t('settings.qqMusicEnabled')}</div>
                    <div id="online-music-description" className="mt-0.5 text-xs" style={{ color: colors.textMuted }}>
                      {t('settings.onlineMusicHint')}
                    </div>
                  </div>
                  <Switch checked={onlineEnabled} label={t('settings.qqMusicEnabled')} describedBy="online-music-description"
                    onChange={enabled => { void settingsManager.setQqMusicEnabled(enabled); }} />
                </div>
              </div>
              {onlineEnabled && (
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
          )}

          {section === 'cloud' && (
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
          )}

          {section === 'focus' && <FocusModeSection theme={themeUtils} />}

          {section === 'shortcuts' && <ShortcutsSettings layout="single" />}
        </section>
      </div>
    </div>
  );
}
