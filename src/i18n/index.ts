/**
 * i18next initialization for LyricsAdapter.
 *
 * This replaces the hand-rolled `I18nManager` in src/services/i18n.ts. The
 * translation data was split (by scripts/extract-locales.cjs) from the old
 * single inline object into one JSON file per language under ./locales/.
 *
 * Migration strategy (see refactor plan): the old `i18n` singleton in
 * services/i18n.ts is kept as a thin shim over this i18next instance so the
 * ~400 existing `i18n.t('key')` call sites keep working unchanged. Components
 * are then incrementally switched to `useTranslation()` (auto re-render on
 * language change, removing the manual `i18n.subscribe(...)` boilerplate).
 *
 * Notes on behaviour parity:
 * - Default/fallback language is `zh` (matches the old manager default).
 * - The saved language is read from the same `app-language` storage key the old
 *   manager used, so existing user preferences carry over.
 * - `returnNull: false` + `missingKeyHandler` keep `t()` returning the key (not
 *   null) for missing translations, matching the old manager's behaviour.
 */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { appStorage } from '../services/appStorage';
import { logger } from '../services/logger';

import zh from './locales/zh.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import de from './locales/de.json';
import fr from './locales/fr.json';

export type Language = 'zh' | 'en' | 'ja' | 'ko' | 'de' | 'fr';

export const LANGUAGES: Language[] = ['zh', 'en', 'ja', 'ko', 'de', 'fr'];

/** Resolve the initial language from the same key the old I18nManager used. */
function getInitialLanguage(): Language {
  const saved = appStorage.getItem('app-language') as Language | null;
  if (saved && LANGUAGES.includes(saved)) {
    return saved;
  }
  return 'zh';
}

void i18next
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
      ja: { translation: ja },
      ko: { translation: ko },
      de: { translation: de },
      fr: { translation: fr },
    },
    lng: getInitialLanguage(),
    fallbackLng: 'zh',
    // Missing translations return the key itself (old manager behaviour),
    // never null/empty — callers do `.replace('{x}', …)` on the result.
    returnNull: false,
    returnEmptyString: false,
    interpolation: {
      // react-i18next escapes values by default; the old code returned raw
      // strings and callers did their own `.replace('{count}', …)`. Keep that
      // working by NOT having i18next interpolate `{count}`-style placeholders
      // (we'd migrate callers to real interpolation later).
      escapeValue: false,
    },
    saveMissing: true,
    missingKeyHandler: (_lngs, _ns, key) => {
      logger.warn('[i18n] Missing translation for key:', key);
    },
  });

// Persist language changes to the same storage the old manager wrote to, so
// preferences survive reloads and the desktop settings-store sync.
i18next.on('languageChanged', (lng) => {
  if (!LANGUAGES.includes(lng as Language)) return;
  const lang = lng as Language;
  appStorage.setItem('app-language', lang).catch(() => {});
});

export default i18next;
