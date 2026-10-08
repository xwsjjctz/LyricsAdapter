import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
import MusicPluginManager from './sections/MusicPluginManager';
import { useMusicPlugins } from '../../stores/musicPluginStore';
import WebdavSection from './sections/WebdavSection';
import { useCurrentTheme, useSettingsTheme } from './shared';

export type SettingsSectionId = 'general' | 'plugins' | 'online' | 'cloud' | 'focus' | 'shortcuts';

const SECTIONS: { id: SettingsSectionId; icon: string; labelKey: string }[] = [
  { id: 'general', icon: 'tune', labelKey: 'settings.nav.general' },
  { id: 'plugins', icon: 'extension', labelKey: 'settings.nav.plugins' },
  { id: 'online', icon: 'language', labelKey: 'settings.nav.online' },
  { id: 'cloud', icon: 'cloud', labelKey: 'settings.nav.cloud' },
  { id: 'focus', icon: 'fullscreen', labelKey: 'settings.nav.focus' },
  { id: 'shortcuts', icon: 'keyboard', labelKey: 'settings.shortcuts.title' },
];

const readOnlineEnabled = () => settingsManager.getQqMusicEnabled();

interface SettingsViewProps {
  initialSection?: SettingsSectionId | undefined;
  onClose: () => void;
}

/**
 * Settings as a glass sheet floating over the poster wall. Sections are tabs;
 * Esc, the close button or a click outside returns to the wall.
 */
export default function SettingsView({ initialSection = 'general', onClose }: SettingsViewProps) {
  const { t } = useTranslation();
  const themeUtils = useSettingsTheme(useCurrentTheme());
  const { colors } = themeUtils;
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const onlineEnabled = useSettingValue(readOnlineEnabled);
  const { sources } = useMusicPlugins();
  const hasMusicPlugins = sources.length > 0;
  const activeSection = section === 'online' && !hasMusicPlugins ? 'plugins' : section;
  const webdav = useWebdavSettings();
  const onlineMusic = useOnlineMusicSettings({ enabled: onlineEnabled && hasMusicPlugins && activeSection === 'online', sources });
  const activeLabel = t(SECTIONS.find(entry => entry.id === activeSection)!.labelKey);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setSection(initialSection); }, [initialSection]);
  useEffect(() => { sheetRef.current?.focus(); }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div className="settings-sheet-backdrop" data-controlbar-passthrough onMouseDown={onClose}>
      <div
        ref={sheetRef}
        className="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        tabIndex={-1}
        onMouseDown={event => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className="settings-sheet__header">
          <h1 className="settings-sheet__title">{t('settings.title')}</h1>
          <div role="tablist" aria-label={t('settings.title')} className="settings-sheet__tabs no-scrollbar">
            {SECTIONS.filter(entry => entry.id !== 'online' || hasMusicPlugins).map(entry => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={entry.id === activeSection}
                className="settings-sheet__tab"
                onClick={() => setSection(entry.id)}
              >
                <span className="material-symbols-outlined" aria-hidden="true">{entry.icon}</span>
                <span>{t(entry.labelKey)}</span>
              </button>
            ))}
          </div>
          <button type="button" className="wall-float__button settings-sheet__close" onClick={onClose} aria-label={t('common.close')}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>

        <section role="tabpanel" aria-label={activeLabel} className="settings-sheet__content no-scrollbar">
          {activeSection === 'general' && <GeneralSection theme={themeUtils} />}
          {activeSection === 'plugins' && <MusicPluginManager theme={themeUtils} />}

          {activeSection === 'online' && (
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
                  sources={sources}
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
