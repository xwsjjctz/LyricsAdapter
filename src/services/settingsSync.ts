import { getDesktopAPI } from './desktopAdapter';
import { appStorage } from './appStorage';
import { settingsManager } from './settingsManager';
import { themeManager } from './themeManager';
import { shortcutManager } from './shortcuts';
import { webdavClient } from './webdavClient';
import i18next, { LANGUAGES, type Language } from '../i18n';
import { reloadCookieStores } from './musicSources';
import { applyExternalTranslationPreference, TRANSLATION_LANGUAGE_KEY } from './pluginTranslationPreference';

/** Keep the player and the native settings renderer on the same preferences. */
export function installSettingsSync(): (() => void) | undefined {
  return getDesktopAPI()?.ipc?.settings.onChanged?.((entries, replaced) => {
    appStorage.applyExternalChanges(entries, replaced);
    const changed = (key: string) => replaced || Object.hasOwn(entries, key);
    if (replaced || Object.keys(entries).some(key => key.startsWith('la_'))) settingsManager.reload();
    if (changed('app-theme')) themeManager.reload();
    if (changed('app-shortcuts')) shortcutManager.reload();
    if (replaced || Object.keys(entries).some(key => key.startsWith('webdav'))) webdavClient.reloadConfig();
    reloadCookieStores(changed);
    if (changed(TRANSLATION_LANGUAGE_KEY)) {
      applyExternalTranslationPreference({ [TRANSLATION_LANGUAGE_KEY]: appStorage.getItem(TRANSLATION_LANGUAGE_KEY) });
    }
    const savedLanguage = appStorage.getItem('app-language') as Language | null;
    const language = savedLanguage && LANGUAGES.includes(savedLanguage) ? savedLanguage : 'zh';
    if (changed('app-language') && language !== i18next.language) void i18next.changeLanguage(language);
  });
}
