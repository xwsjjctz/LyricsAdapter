import { useEffect, useSyncExternalStore } from 'react';
import { getDesktopAPI } from '../services/desktopAdapter';

let state = { provider: '', language: 'zh', loaded: false };
const listeners = new Set<() => void>();
let pending: Promise<void> | undefined;
let revision = 0;
const update = (next: typeof state) => { state = next; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => state;
export function applyExternalTranslationPreference(entries: Record<string, string | null>, replaced = false): void {
  if (!replaced && !Object.hasOwn(entries, 'plugin_lyrics_provider') && !Object.hasOwn(entries, 'plugin_lyrics_language')) return;
  revision++;
  update({
    provider: Object.hasOwn(entries, 'plugin_lyrics_provider') || replaced ? entries['plugin_lyrics_provider'] ?? '' : state.provider,
    language: Object.hasOwn(entries, 'plugin_lyrics_language') || replaced ? entries['plugin_lyrics_language'] ?? 'zh' : state.language,
    loaded: true,
  });
}
async function hydrate() {
  if (state.loaded) return;
  const current = revision;
  return pending ??= Promise.all([getDesktopAPI()?.settingsGet?.('plugin_lyrics_provider'), getDesktopAPI()?.settingsGet?.('plugin_lyrics_language')])
    .then(([provider, language]) => { if (revision === current) update({ provider: provider ?? '', language: language ?? 'zh', loaded: true }); })
    .catch(() => { if (revision === current) update({ ...state, loaded: true }); });
}
export async function setTranslationPreference(key: 'provider' | 'language', value: string): Promise<void> {
  const api = getDesktopAPI();
  if (!api?.settingsSet) throw new Error('Desktop settings are unavailable');
  await api.settingsSet(key === 'provider' ? 'plugin_lyrics_provider' : 'plugin_lyrics_language', value);
  revision++; update({ ...state, [key]: value, loaded: true });
}
export function useTranslationPreference() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => { void hydrate(); }, []);
  return snapshot;
}
