import { getDesktopAPI } from './desktopAdapter';
import { appStorage } from './appStorage';
import { settingsManager } from './settingsManager';
import { themeManager } from './themeManager';
import { shortcutManager } from './shortcuts';
import { webdavClient } from './webdavClient';
import i18next, { LANGUAGES, type Language } from '../i18n';
import { cookieManager, neteaseCookieManager } from './cookieManager';
import { applyExternalTranslationPreference } from '../stores/pluginTranslationStore';

/** Keep the player and the native settings renderer on the same preferences. */
export function installSettingsSync(): (() => void) | undefined {
  return getDesktopAPI()?.ipc?.settings.onChanged?.((entries, replaced) => {
    appStorage.applyExternalChanges(entries, replaced);
    const changed = (key: string) => replaced || Object.hasOwn(entries, key);
    if (replaced || Object.keys(entries).some(key => key.startsWith('la_'))) settingsManager.reload();
    if (changed('app-theme')) themeManager.reload();
    if (changed('app-shortcuts')) shortcutManager.reload();
    if (replaced || Object.keys(entries).some(key => key.startsWith('webdav'))) webdavClient.reloadConfig();
    if (changed('qq_music_cookie') || changed('qq_music_cookie_last_check')) cookieManager.reload();
    if (changed('netease_cookie') || changed('netease_cookie_last_check')) neteaseCookieManager.reload();
    if (changed('plugin_lyrics_provider') || changed('plugin_lyrics_language')) {
      applyExternalTranslationPreference({
        plugin_lyrics_provider: appStorage.getItem('plugin_lyrics_provider'),
        plugin_lyrics_language: appStorage.getItem('plugin_lyrics_language'),
      });
    }
    const savedLanguage = appStorage.getItem('app-language') as Language | null;
    const language = savedLanguage && LANGUAGES.includes(savedLanguage) ? savedLanguage : 'zh';
    if (changed('app-language') && language !== i18next.language) void i18next.changeLanguage(language);
  });
}
