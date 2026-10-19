import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Track } from '../types';
import type { PluginProviderInfo } from '../shared/plugin';
import { useMusicPlugins } from '../stores/musicPluginStore';
import { useTranslationPreference } from '../stores/pluginTranslationStore';
import {
  acquireTranslation,
  effectiveTranslationLanguage,
  isTranslationRequested,
  lyricDocumentForTrack,
  setTranslationRequested,
  subscribeTranslationRequests,
  translationRequestKey,
} from '../services/pluginTranslation';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';

/** `unavailable`: no usable translation provider or no lyrics, so Focus Mode shows no control. */
export type PluginTranslationStatus = 'unavailable' | 'idle' | 'translating' | 'translated' | 'error';
type TranslatedLines = Readonly<Record<string, string>>;
type RequestState = { key: string; scope: string; track: Track; status: 'translating' | 'translated' | 'error'; lines: TranslatedLines };

const EMPTY: TranslatedLines = {};
const sameProvider = (a: PluginProviderInfo | null, b: PluginProviderInfo | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Focus Mode lyric translation, started only through `toggle`; `track` is null when it has
 * no lyrics. Until a result arrives `lines` stays the same empty object, so the lyric
 * renderers keep their layout and the finished translation replaces them in one update.
 */
export function usePluginTranslation(track: Track | null, visible: boolean) {
  const { plugins } = useMusicPlugins();
  const preference = useTranslationPreference();
  const scope = useMemo(() => JSON.stringify(plugins), [plugins]);
  // The enabled translation plugin provides the button; disabling it removes the button.
  // Plugin changes re-read the providers. Keeping the same info object while the provider
  // is unchanged stops that refresh from cancelling and restarting a running translation.
  const [lookup, setLookup] = useState<{ scope: string; info: PluginProviderInfo | null }>();
  useEffect(() => {
    if (!visible || !preference.loaded) return;
    let disposed = false;
    const settle = (found: PluginProviderInfo | null) => {
      if (!disposed) setLookup(previous => ({ scope, info: previous && sameProvider(previous.info, found) ? previous.info : found }));
    };
    void (async () => {
      const providers = await getDesktopAPI()?.pluginProviders?.('lyrics.translation') ?? [];
      settle(providers[0] ?? null);
    })().catch(error => {
      logger.warn('[Plugins] Translation providers unavailable', error);
      settle(null);
    });
    return () => { disposed = true; };
  }, [visible, preference.loaded, scope]);

  const info = preference.loaded && lookup ? lookup.info : null;
  const fresh = lookup?.scope === scope;
  // A preference the provider does not support falls back to one of its declared languages.
  const language = effectiveTranslationLanguage(info, preference.language);
  const requestKey = track && info ? translationRequestKey(track.id, info.key, language) : '';
  const requested = useSyncExternalStore(subscribeTranslationRequests, () => requestKey !== '' && isTranslationRequested(requestKey));
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RequestState>();
  useEffect(() => {
    if (!visible || !track || !info || !fresh || !requested) return;
    let disposed = false;
    let release: (() => void) | undefined;
    const settle = (status: RequestState['status'], lines: TranslatedLines = EMPTY) => {
      if (!disposed) setState({ key: requestKey, scope, track, status, lines });
    };
    settle('translating');
    void (async () => {
      const document = await lyricDocumentForTrack(track);
      if (disposed) return;
      if (!document.lines.length) throw new Error('The lyrics have no lines to translate');
      const lease = acquireTranslation(info, document, language, scope);
      release = lease.release;
      const result = await lease.promise;
      settle('translated', Object.fromEntries(result.lines.map(line => [line.lineId, line.text])));
    })().catch(error => {
      if (disposed) return;
      logger.warn('[Plugins] Lyrics translation failed', error);
      settle('error');
    });
    return () => { disposed = true; release?.(); };
  }, [track, visible, info, fresh, requested, requestKey, language, scope, attempt]);

  const current = state && state.key === requestKey && state.scope === scope && state.track === track ? state : undefined;
  const status: PluginTranslationStatus = !track || !info ? 'unavailable' : !requested ? 'idle' : current?.status ?? 'translating';
  // Idle starts a translation, translated returns to the original lines (the result stays
  // cached), and an error retries; a running translation ignores further presses.
  const toggle = useCallback(() => {
    if (!requestKey || status === 'translating') return;
    if (status === 'error') setAttempt(value => value + 1);
    else setTranslationRequested(requestKey, status === 'idle');
  }, [requestKey, status]);
  return { status, lines: requested && current?.status === 'translated' ? current.lines : EMPTY, toggle };
}
