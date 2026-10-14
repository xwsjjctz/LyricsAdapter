import { getDesktopAPI } from './desktopAdapter';

/**
 * Lyrics translation preference shared by the player and the settings window.
 * It lives outside React so settings sync can apply external changes; the
 * store module exposes it to components through `useSyncExternalStore`.
 */
export interface TranslationPreference {
  provider: string;
  language: string;
  loaded: boolean;
}

const PROVIDER_KEY = 'plugin_lyrics_provider';
const LANGUAGE_KEY = 'plugin_lyrics_language';
const DEFAULT_LANGUAGE = 'zh';

let state: TranslationPreference = { provider: '', language: DEFAULT_LANGUAGE, loaded: false };
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
  if (!replaced && !Object.hasOwn(entries, PROVIDER_KEY) && !Object.hasOwn(entries, LANGUAGE_KEY)) return;
  revision++;
  update({
    provider: Object.hasOwn(entries, PROVIDER_KEY) || replaced ? entries[PROVIDER_KEY] ?? '' : state.provider,
    language: Object.hasOwn(entries, LANGUAGE_KEY) || replaced ? entries[LANGUAGE_KEY] ?? DEFAULT_LANGUAGE : state.language,
    loaded: true,
  });
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
  return pending ??= Promise.all([readSetting(PROVIDER_KEY), readSetting(LANGUAGE_KEY)])
    .then(([provider, language]) => { if (revision === current) update({ provider: provider ?? '', language: language ?? DEFAULT_LANGUAGE, loaded: true }); })
    .catch(() => { if (revision === current) update({ ...state, loaded: true }); });
}

export async function setTranslationPreference(key: 'provider' | 'language', value: string): Promise<void> {
  const settings = getDesktopAPI()?.ipc?.settings;
  if (!settings) throw new Error('Desktop settings are unavailable');
  const result = await settings.set(key === 'provider' ? PROVIDER_KEY : LANGUAGE_KEY, value);
  if (!result.ok) throw new Error(result.error);
  revision++; update({ ...state, [key]: value, loaded: true });
}
