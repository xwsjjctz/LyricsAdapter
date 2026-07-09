/**
 * i18n shim — backward-compatible facade over i18next.
 *
 * The real i18n runtime now lives in src/i18n/index.ts (i18next +
 * react-i18next). This module keeps the exact same API the rest of the app has
 * been calling for years so the ~450 existing call sites keep working without
 * changes:
 *
 *   import { i18n, type Language } from '../services/i18n';
 *   i18n.t('key')                  // string lookup
 *   i18n.getLanguage()             // current Language
 *   i18n.setLanguage(lang)         // change + persist
 *   i18n.subscribe(listener)       // () => void  (un-subscribe)
 *
 * Behaviour parity with the old I18nManager:
 *   - `t()` returns the key itself when missing (i18next `returnNull:false`),
 *     never null. Callers do their own `.replace('{count}', …)`, so we do NOT
 *     use i18next interpolation for those — the raw string with `{count}` is
 *     preserved and substituted by the caller, exactly as before.
 *   - `subscribe` listeners fire with the new Language on change.
 *
 * Migration target: gradually replace `i18n.t(...)` + manual `subscribe` with
 * react-i18next's `useTranslation()` hook (auto re-render, no boilerplate).
 * This shim can be deleted once no caller references it.
 */
import i18next from '../i18n';

export type Language = import('../i18n').Language;

interface I18nFacade {
  t(key: string): string;
  getLanguage(): Language;
  setLanguage(lang: Language): void;
  subscribe(listener: (lang: Language) => void): () => void;
}

const facade: I18nFacade = {
  t(key: string): string {
    // i18next.t can return the key or a complex object; we coerce to string to
    // preserve the old contract (always a string). returnNull:false ensures we
    // never get null; missing keys fall back to the key itself.
    return i18next.t(key) as string;
  },

  getLanguage(): Language {
    return i18next.language as Language;
  },

  setLanguage(lang: Language): void {
    void i18next.changeLanguage(lang);
  },

  subscribe(listener: (lang: Language) => void): () => void {
    const handler = (lng: string) => listener(lng as Language);
    i18next.on('languageChanged', handler);
    return () => {
      i18next.off('languageChanged', handler);
    };
  },
};

export const i18n = facade;

// Also re-export the initializer's default for callers that want the raw
// i18next instance (e.g. to read `isInitialized`), and keep a default export
// shape similar to typical i18next setups.
export default i18next;
