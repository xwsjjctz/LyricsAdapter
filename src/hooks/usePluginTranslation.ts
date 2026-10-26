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
import { getTrackTranslationAction, runTrackTranslationAction, subscribeTrackTranslationActions } from '../services/trackTranslationActions';

/** `unavailable`: no usable translation provider or no lyrics, so Focus Mode shows no control. */
export type PluginTranslationStatus = 'unavailable' | 'idle' | 'translating' | 'translated' | 'error';
type TranslatedLines = Readonly<Record<string, string>>;
type RequestState = { key: string; scope: string; track: Track; status: 'translating' | 'translated' | 'error'; lines: TranslatedLines; hasResult: boolean; clearRevision: number };

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
  const action = useSyncExternalStore(subscribeTrackTranslationActions, () => getTrackTranslationAction(requestKey));
  const [actionError, setActionError] = useState<{ key: string; kind: 'reload' | 'clear' }>();
  const [state, setState] = useState<RequestState>();
  useEffect(() => {
    if (!visible || !track || !info || !fresh || !requested || action.kind) return;
    let disposed = false;
    let release: (() => void) | undefined;
    const matches = (previous: RequestState | undefined) => previous?.key === requestKey && previous.scope === scope && previous.track === track && previous.clearRevision === action.clearRevision;
    setState(previous => ({ key: requestKey, scope, track, status: 'translating', clearRevision: action.clearRevision,
      lines: matches(previous) ? previous!.lines : EMPTY, hasResult: matches(previous) && previous!.hasResult }));
    const cancel = () => { disposed = true; release?.(); };
    void (async () => {
      const document = await lyricDocumentForTrack(track);
      if (disposed || !isTranslationRequested(requestKey)) return;
      if (!document.lines.length) throw new Error('The lyrics have no lines to translate');
      const lease = acquireTranslation(info, document, language, scope);
      release = lease.release;
      const result = await lease.promise;
      if (!disposed && getTrackTranslationAction(requestKey).clearRevision === action.clearRevision) {
        setState({ key: requestKey, scope, track, status: 'translated', hasResult: true, clearRevision: action.clearRevision,
          lines: Object.fromEntries(result.lines.map(line => [line.lineId, line.text])) });
      }
    })().catch(error => {
      if (disposed) return;
      logger.warn('[Plugins] Lyrics translation failed', error);
      setState(previous => ({ key: requestKey, scope, track, clearRevision: action.clearRevision,
        status: matches(previous) && previous!.hasResult ? 'translated' : 'error',
        lines: matches(previous) ? previous!.lines : EMPTY, hasResult: matches(previous) && previous!.hasResult }));
    });
    return cancel;
  }, [track, visible, info, fresh, requested, requestKey, language, scope, attempt, action]);

  const current = state && state.key === requestKey && state.scope === scope && state.track === track && state.clearRevision === action.clearRevision ? state : undefined;
  const status: PluginTranslationStatus = !track || !info ? 'unavailable' : action.kind === 'reload' ? 'translating' : !requested ? 'idle' : current?.status ?? 'translating';
  // Idle starts a translation, translated returns to the original lines (the result stays
  // cached), and an error retries; a running translation ignores further presses.
  const toggle = useCallback(() => {
    if (!requestKey || status === 'translating' || action.kind === 'clear') return;
    setActionError(undefined);
    if (status === 'error') setAttempt(value => value + 1);
    else setTranslationRequested(requestKey, status === 'idle');
  }, [requestKey, status, action.kind]);
  const runAction = useCallback(async (kind: 'reload' | 'clear') => {
    if (!requestKey || !track || !info?.cacheControl) return;
    setActionError(undefined);
    try {
      if (await runTrackTranslationAction(track, info, language, scope, kind)) setActionError(undefined);
    }
    catch (error) {
      logger.warn('[Plugins] Song translation action failed', error);
      setActionError({ key: requestKey, kind });
    }
  }, [requestKey, track, info, language, scope]);
  const refresh = useCallback(() => { void runAction('reload'); }, [runAction]);
  const clear = useCallback(() => runAction('clear'), [runAction]);
  return { status, lines: requested && current?.hasResult ? current.lines : EMPTY, toggle, refresh, clear,
    canManage: !!info?.cacheControl, clearing: action.kind === 'clear',
    actionError: actionError?.key === requestKey ? actionError.kind : undefined, language };
}
