import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import ShortcutsSettings from '../ShortcutsSettings';
import { useOnlineMusicSettings } from './hooks/useOnlineMusicSettings';
import { useWebdavSettings } from './hooks/useWebdavSettings';
import FocusModeSection from './sections/FocusModeSection';
import GeneralSection from './sections/GeneralSection';
import OnlineMusicSection from './sections/OnlineMusicSection';
import MusicPluginManager from './sections/MusicPluginManager';
import { useMusicPlugins } from '../../stores/musicPluginStore';
import WebdavSection from './sections/WebdavSection';
import { useCurrentTheme, useSettingsTheme } from './shared';

import type { SettingsSectionId } from '../../types/settingsPanel';
export type { SettingsSectionId } from '../../types/settingsPanel';

const SECTIONS: { id: SettingsSectionId; icon: string; labelKey: string }[] = [
  { id: 'general', icon: 'tune', labelKey: 'settings.nav.general' },
  { id: 'plugins', icon: 'extension', labelKey: 'settings.nav.plugins' },
  { id: 'online', icon: 'language', labelKey: 'settings.nav.online' },
  { id: 'cloud', icon: 'cloud', labelKey: 'settings.nav.cloud' },
  { id: 'focus', icon: 'fullscreen', labelKey: 'settings.nav.focus' },
  { id: 'shortcuts', icon: 'keyboard', labelKey: 'settings.shortcuts.title' },
];

interface SettingsViewProps {
  initialSection?: SettingsSectionId | undefined;
  onClose: () => void;
  usePaletteMaterial?: boolean;
}

/**
 * Settings as a glass sheet floating over the poster wall. Sections are tabs;
 * Esc, the close button or a click outside returns to the wall.
 */
export default function SettingsView({ initialSection = 'general', onClose, usePaletteMaterial = false }: SettingsViewProps) {
  const { t } = useTranslation();
  const themeUtils = useSettingsTheme(useCurrentTheme());
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const { sources } = useMusicPlugins();
  const hasMusicPlugins = sources.length > 0;
  const activeSection = section === 'online' && !hasMusicPlugins ? 'plugins' : section;
  const webdav = useWebdavSettings();
  const onlineMusic = useOnlineMusicSettings({ enabled: hasMusicPlugins && activeSection === 'online', sources });
  // Credential drafts survive tab switches; the dot shows where one is waiting.
  const unsaved: Partial<Record<SettingsSectionId, boolean>> = {
    online: hasMusicPlugins && onlineMusic.cookieDirty,
    cloud: webdav.isDirty,
  };
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
    <div className="settings-sheet-backdrop" data-settings-material={usePaletteMaterial ? 'palette' : undefined} data-controlbar-passthrough onMouseDown={onClose}>
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
                <span className="material-symbols-rounded" aria-hidden="true">{entry.icon}</span>
                <span>{t(entry.labelKey)}</span>
                {unsaved[entry.id] && <span className="settings-sheet__tab-dot" role="img" aria-label={t('settingsDialog.unsaved')} />}
              </button>
            ))}
          </div>
          <button type="button" className="wall-float__button settings-sheet__close" onClick={onClose} aria-label={t('common.close')}>
            <span className="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </header>

        <section role="tabpanel" aria-label={activeLabel} className="settings-sheet__content no-scrollbar">
          {activeSection === 'general' && <GeneralSection theme={themeUtils} />}
          {activeSection === 'plugins' && <MusicPluginManager theme={themeUtils} />}

          {activeSection === 'online' && (
            <OnlineMusicSection
              theme={themeUtils}
              sources={sources}
              onlineSource={onlineMusic.onlineSource}
              login={onlineMusic.login}
              cookie={onlineMusic.cookie}
              cookieDirty={onlineMusic.cookieDirty}
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
              setDownloadPath={onlineMusic.setDownloadPath}
              onSaveCookie={onlineMusic.saveCookie}
              startQr={onlineMusic.startQr}
              onQrLogout={onlineMusic.handleQrLogout}
            />
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
              isDirty={webdav.isDirty}
              setServerUrl={webdav.setServerUrl}
              setUsername={webdav.setUsername}
              setPassword={webdav.setPassword}
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
