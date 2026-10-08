import { useEffect, useMemo, useState } from 'react';
import type { Track } from '../types';
import { useMusicPlugins } from '../stores/musicPluginStore';
import { useTranslationPreference } from '../stores/pluginTranslationStore';
import { acquireTranslation, lyricDocumentForTrack } from '../services/pluginTranslation';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';

const EMPTY: Readonly<Record<string, string>> = {};
export function usePluginTranslation(track: Track | null, visible: boolean) {
  const { plugins } = useMusicPlugins();
  const preference = useTranslationPreference();
  const scope = useMemo(() => JSON.stringify(plugins), [plugins]);
  const [state, setState] = useState<{ scope: string; track: Track | null; provider: string; language: string; lines: Readonly<Record<string, string>>; error: boolean }>();
  useEffect(() => {
    if (!visible || !track || !preference.loaded || !preference.provider) return;
    let disposed = false;
    let release: (() => void) | undefined;
    void (async () => {
      const providers = await getDesktopAPI()?.pluginProviders?.('lyrics.translation') ?? [];
      const provider = providers.find(p => p.key === preference.provider);
      if (!provider || disposed) return;
      const document = await lyricDocumentForTrack(track);
      if (!document.lines.length || disposed) return;
      const lease = acquireTranslation(provider, document, preference.language, scope);
      release = lease.release;
      const result = await lease.promise;
      if (!disposed) setState({ scope, track, provider: preference.provider, language: preference.language,
        lines: Object.fromEntries(result.lines.map(line => [line.lineId, line.text])), error: false });
    })().catch(error => {
      if (!disposed) {
        logger.warn('[Plugins] Lyrics translation failed', error);
        setState({ scope, track, provider: preference.provider, language: preference.language, lines: EMPTY, error: true });
      }
    });
    return () => { disposed = true; release?.(); };
  }, [track, visible, preference.provider, preference.language, preference.loaded, scope]);
  return state && state.scope === scope && state.track === track && state.provider === preference.provider && state.language === preference.language && visible
    ? { lines: state.lines, error: state.error } : { lines: EMPTY, error: false };
}
