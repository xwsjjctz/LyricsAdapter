import type { Track } from '../types';
import type { LyricDocument, LyricLine, TranslationResult, PluginProviderInfo } from '../shared/plugin';
import { validateTranslationResult } from '../shared/pluginValidation';
import { getDesktopAPI } from './desktopAdapter';

export async function lyricDocumentForTrack(track: Track): Promise<LyricDocument> {
  const lines: LyricLine[] = track.syncedLyrics?.length
    ? track.syncedLyrics.flatMap((line, index) => Number.isFinite(line.time) && line.text.trim() ? [{
      id: `line-${index}`, text: line.text, startMs: Math.max(0, Math.round(line.time * 1000)),
      ...(line.words?.length ? { words: line.words.filter(w => Number.isFinite(w.time) && Number.isFinite(w.duration) && w.duration > 0)
        .map(w => ({ text: w.text, startMs: Math.max(0, Math.round(w.time * 1000)), endMs: Math.max(0, Math.round((w.time + w.duration) * 1000)) })) } : {}),
    }] : [])
    : (track.lyrics ?? '').split(/\r?\n/).map(line => line.trim().replace(/^\[\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?\]/, ''))
      .filter(line => line && line !== '//').map((text, index) => ({ id: `line-${index}`, text }));
  const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const trackId = await hash(track.id);
  return { id: `lyrics-${trackId}`, trackId, revision: await hash(JSON.stringify({ parser: 1, lines })), lines };
}

const cache = new Map<string, TranslationResult>();
const pending = new Map<string, { promise: Promise<TranslationResult>; requestId: string; references: number }>();
/** Lease shared work; the final consumer cancels its IPC request when no result is cached. */
export function acquireTranslation(provider: PluginProviderInfo, document: LyricDocument, targetLanguage: string, scope: string) {
  const key = JSON.stringify([provider.key, provider.version, document.id, document.revision, targetLanguage, scope]);
  const cached = cache.get(key);
  if (cached) return { promise: Promise.resolve(cached), release: () => {} };
  let entry = pending.get(key);
  if (!entry) {
    const requestId = crypto.randomUUID();
    const request = { document, targetLanguage };
    const api = getDesktopAPI();
    const promise = Promise.resolve().then(async () => {
      if (pending.get(key)?.requestId !== requestId) throw new Error('Translation request cancelled');
      if (!api?.pluginTranslate) throw new Error('Plugin platform is unavailable');
      const result = validateTranslationResult(await api.pluginTranslate({ requestId, providerKey: provider.key, request }), request);
      // A cancelled lease must not populate the cache even if the provider ignores cancellation.
      if (pending.get(key)?.requestId === requestId) {
        cache.set(key, result); while (cache.size > 32) cache.delete(cache.keys().next().value!);
      }
      return result;
    }).finally(() => { if (pending.get(key)?.requestId === requestId) pending.delete(key); });
    entry = { promise, requestId, references: 0 }; pending.set(key, entry);
  }
  entry.references++;
  let released = false;
  const lease = entry;
  return { promise: entry.promise, release: () => {
    if (released) return; released = true;
    if (--lease.references === 0 && pending.get(key) === lease) {
      pending.delete(key); getDesktopAPI()?.pluginCancel?.(lease.requestId);
    }
  } };
}
