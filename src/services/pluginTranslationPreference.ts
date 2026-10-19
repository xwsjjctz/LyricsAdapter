import { getDesktopAPI } from './desktopAdapter';

/**
 * Lyrics translation preference shared by the player and the settings window.
 * It lives outside React so settings sync can apply external changes; the
 * store module exposes it to components through `useSyncExternalStore`.
 * The provider is not a preference: Focus Mode uses the enabled translation plugin.
 */
export interface TranslationPreference {
  language: string;
  loaded: boolean;
}

export const TRANSLATION_LANGUAGE_KEY = 'plugin_lyrics_language';
const DEFAULT_LANGUAGE = 'zh';

let state: TranslationPreference = { language: DEFAULT_LANGUAGE, loaded: false };
const listeners = new Set<() => void>();
let pending: Promise<void> | undefined;
let revision = 0;
const update = (next: TranslationPreference) => { state = next; listeners.forEach(listener => listener()); };

export const subscribeTranslationPreference = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const getTranslationPreference = () => state;

export function applyExternalTranslationPreference(entries: Record<string, string | null>, replaced = false): void {
  if (!replaced && !Object.hasOwn(entries, TRANSLATION_LANGUAGE_KEY)) return;
  revision++;
  update({ language: entries[TRANSLATION_LANGUAGE_KEY] ?? DEFAULT_LANGUAGE, loaded: true });
}

async function readSetting(key: string): Promise<string | undefined> {
  const settings = getDesktopAPI()?.ipc?.settings;
  if (!settings) return undefined;
  const result = await settings.get(key);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export function hydrateTranslationPreference(): Promise<void> {
  if (state.loaded) return Promise.resolve();
  const current = revision;
  return pending ??= readSetting(TRANSLATION_LANGUAGE_KEY)
    .then(language => { if (revision === current) update({ language: language ?? DEFAULT_LANGUAGE, loaded: true }); })
    .catch(() => { if (revision === current) update({ ...state, loaded: true }); });
}

export async function setTranslationLanguage(value: string): Promise<void> {
  const settings = getDesktopAPI()?.ipc?.settings;
  if (!settings) throw new Error('Desktop settings are unavailable');
  const result = await settings.set(TRANSLATION_LANGUAGE_KEY, value);
  if (!result.ok) throw new Error(result.error);
  revision++; update({ ...state, language: value, loaded: true });
}
