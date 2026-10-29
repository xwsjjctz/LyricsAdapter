import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { Track } from '../types';
import type { PluginProviderInfo } from '../shared/plugin';
import { useMusicPlugins } from '../stores/musicPluginStore';
import { useTranslationPreference } from '../stores/pluginTranslationStore';
import { effectiveTranslationLanguage, languageDisplayName, translationRequestKey } from '../services/pluginTranslation';
import { getTrackTranslationAction, getTrackTranslationVersion, runTrackTranslationAction, subscribeTrackTranslationActions, type TrackTranslationAction } from '../services/trackTranslationActions';
import { notify } from '../services/notificationService';
import { logger } from '../services/logger';
import { getDesktopAPI } from '../services/desktopAdapter';

/** Song-menu actions share the enabled provider and target language with the lyric viewer. */
export function useTrackTranslationActions() {
  const { plugins } = useMusicPlugins();
  const preference = useTranslationPreference();
  const { t } = useTranslation();
  const revision = useSyncExternalStore(subscribeTrackTranslationActions, getTrackTranslationVersion);
  const scope = useMemo(() => JSON.stringify(plugins), [plugins]);
  const [lookup, setLookup] = useState<{ scope: string; provider: PluginProviderInfo | undefined }>();
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const providers = await getDesktopAPI()?.pluginProviders?.('lyrics.translation') ?? [];
      if (!disposed) setLookup({ scope, provider: providers[0] });
    })().catch(error => {
      logger.warn('[Plugins] Song translation provider unavailable', error);
      if (!disposed) setLookup({ scope, provider: undefined });
    });
    return () => { disposed = true; };
  }, [scope]);
  const provider = lookup?.scope === scope ? lookup.provider : undefined;
  const language = effectiveTranslationLanguage(provider, preference.language);
  const contextFor = useCallback((track: Track) => ({
    canTranslate: !!provider?.cacheControl && preference.loaded && Boolean(track.lyrics?.trim() || track.syncedLyrics?.some(line => line.text.trim())),
    translationAction: provider ? getTrackTranslationAction(translationRequestKey(track.id, provider.key, language)).kind : undefined,
  // Subscribe to jobs so reopening a menu shows progress rather than offering duplicate work.
  }), [provider, preference.loaded, language, revision]);
  const run = useCallback(async (track: Track, kind: TrackTranslationAction) => {
    if (!provider?.cacheControl || !preference.loaded) return;
    const labels = { title: track.title, language: languageDisplayName(language) };
    try {
      const completed = await runTrackTranslationAction(track, provider, language, scope, kind);
      if (completed) await notify(t('plugins.translationActions'), t(kind === 'reload' ? 'plugins.trackRetranslated' : 'plugins.trackTranslationCleared', labels), { silent: true });
    } catch (error) {
      logger.warn('[Plugins] Song translation action failed', error);
      await notify(t('plugins.translationActions'), t(kind === 'reload' ? 'plugins.trackRetranslateFailed' : 'plugins.trackTranslationClearFailed', labels), { silent: true });
    }
  }, [provider, preference.loaded, language, scope, t]);
  return { contextFor, run };
}
