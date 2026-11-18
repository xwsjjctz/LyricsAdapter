import { useEffect, useSyncExternalStore } from 'react';
import {
  getTranslationPreference,
  hydrateTranslationPreference,
  subscribeTranslationPreference,
} from '../services/translation/pluginTranslationPreference';

export { setTranslationLanguage } from '../services/translation/pluginTranslationPreference';

export function useTranslationPreference() {
  const snapshot = useSyncExternalStore(subscribeTranslationPreference, getTranslationPreference);
  useEffect(() => { void hydrateTranslationPreference(); }, []);
  return snapshot;
}
