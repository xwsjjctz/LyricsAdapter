import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ShortcutsSettings from '../ShortcutsSettings';
import { useSectionScroll } from './hooks/useSectionScroll';
import { useWebdavSettings } from './hooks/useWebdavSettings';
import FocusModeSection from './sections/FocusModeSection';
import GeneralSection from './sections/GeneralSection';
import MusicPluginManager from './sections/MusicPluginManager';
import WebdavSection from './sections/WebdavSection';
import WelcomePreviewSetting from './sections/WelcomePreviewSetting';
import { useCurrentTheme, useSettingsTheme } from './shared';

import type { SettingsSectionId } from '../../types/settingsPanel';
export type { SettingsSectionId } from '../../types/settingsPanel';

/** `navKey` labels the short link in the bar; `titleKey` heads the section in the list. */
export const SETTINGS_SECTIONS: { id: SettingsSectionId; icon: string; navKey: string; titleKey: string }[] = [
  { id: 'general', icon: 'tune', navKey: 'settings.nav.general', titleKey: 'settings.nav.general' },
  { id: 'plugins', icon: 'extension', navKey: 'settings.nav.plugins', titleKey: 'settings.nav.plugins' },
  { id: 'cloud', icon: 'cloud', navKey: 'settings.nav.cloudShort', titleKey: 'settings.nav.cloud' },
  // Focus Mode's settings, presented as experimental.
  { id: 'focus', icon: 'science', navKey: 'settings.nav.experimentalShort', titleKey: 'settings.nav.experimental' },
  { id: 'shortcuts', icon: 'keyboard', navKey: 'settings.nav.shortcutsShort', titleKey: 'settings.shortcuts.title' },
];
const SECTION_IDS = SETTINGS_SECTIONS.map(entry => entry.id);

interface SettingsViewProps {
  initialSection?: SettingsSectionId | undefined;
  onClose: () => void;
  usePaletteMaterial?: boolean;
  /** Shows the first-launch welcome page; absent where there is no player to show it in. */
  onPreviewWelcome?: (() => void) | undefined;
}

/**
 * Settings as a glass sheet floating over the poster wall: every section in one scrolling
 * list of fixed height, with a bar that jumps to a section and follows the one being read.
 * Esc, the close button or a click outside returns to the wall.
 */
export default function SettingsView({ initialSection = 'general', onClose, usePaletteMaterial = false, onPreviewWelcome }: SettingsViewProps) {
  const { t } = useTranslation();
  const themeUtils = useSettingsTheme(useCurrentTheme());
  const webdav = useWebdavSettings();
  // The WebDAV draft is kept while the sheet is open; the dot shows it is waiting.
  const unsaved: Partial<Record<SettingsSectionId, boolean>> = { cloud: webdav.isDirty };
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { active, scrollTo } = useSectionScroll(contentRef, SECTION_IDS, initialSection);

  useEffect(() => { sheetRef.current?.focus(); }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const content: Record<SettingsSectionId, ReactNode> = {
    general: <GeneralSection theme={themeUtils} />,
    plugins: <MusicPluginManager theme={themeUtils} />,
    cloud: (
      <WebdavSection
        theme={themeUtils}
        serverUrl={webdav.serverUrl}
        username={webdav.username}
        password={webdav.password}
        message={webdav.message}
        isTesting={webdav.isTesting}
        isSaving={webdav.isSaving}
        isDirty={webdav.isDirty}
        setServerUrl={webdav.setServerUrl}
        setUsername={webdav.setUsername}
        setPassword={webdav.setPassword}
        onSave={webdav.handleSave}
      />
    ),
    focus: (
      <div className="space-y-5">
        <FocusModeSection theme={themeUtils} />
        {onPreviewWelcome && <WelcomePreviewSetting theme={themeUtils} onPreview={onPreviewWelcome} />}
      </div>
    ),
    shortcuts: <ShortcutsSettings layout="single" />,
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
          <nav aria-label={t('settings.title')} className="settings-sheet__tabs no-scrollbar">
            {SETTINGS_SECTIONS.map(entry => (
              <a
                key={entry.id}
                href={`#settings-section-${entry.id}`}
                aria-current={entry.id === active ? 'location' : undefined}
                className="settings-sheet__tab"
                onClick={event => { event.preventDefault(); scrollTo(entry.id); }}
              >
                <span className="material-symbols-rounded" aria-hidden="true">{entry.icon}</span>
                <span>{t(entry.navKey)}</span>
                {unsaved[entry.id] && <span className="settings-sheet__tab-dot" role="img" aria-label={t('settingsDialog.unsaved')} />}
              </a>
            ))}
          </nav>
          <button type="button" className="wall-float__button settings-sheet__close" onClick={onClose} aria-label={t('common.close')}>
            <span className="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </header>

        <div ref={contentRef} className="settings-sheet__content no-scrollbar">
          {SETTINGS_SECTIONS.map(entry => (
            <section key={entry.id} id={`settings-section-${entry.id}`} data-settings-section={entry.id}
              aria-labelledby={`settings-heading-${entry.id}`} className="settings-section">
              <h2 id={`settings-heading-${entry.id}`} className="settings-section__title">{t(entry.titleKey)}</h2>
              {content[entry.id]}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
