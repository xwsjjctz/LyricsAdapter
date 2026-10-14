import { useEffect, useSyncExternalStore } from 'react';
import {
  getTranslationPreference,
  hydrateTranslationPreference,
  subscribeTranslationPreference,
} from '../services/pluginTranslationPreference';

export { setTranslationPreference } from '../services/pluginTranslationPreference';

export function useTranslationPreference() {
  const snapshot = useSyncExternalStore(subscribeTranslationPreference, getTranslationPreference);
  useEffect(() => { void hydrateTranslationPreference(); }, []);
  return snapshot;
}
