import type { Track } from '../types';
import type { LyricDocument, LyricLine, LyricTrackMetadata, TranslationResult, PluginProviderInfo } from '../shared/plugin';
import { validateTranslationResult } from '../shared/pluginValidation';
import { getDesktopAPI } from './desktopAdapter';

/** Offered when a provider does not declare its target languages (lyrics.translation 1.2). */
export const DEFAULT_TRANSLATION_LANGUAGES: readonly string[] = ['zh', 'en', 'ja', 'ko'];
export const translationLanguages = (provider: Pick<PluginProviderInfo, 'languages'> | null | undefined): readonly string[] =>
  provider?.languages?.length ? provider.languages : DEFAULT_TRANSLATION_LANGUAGES;
/**
 * The preferred language when the provider supports it, else one with the same primary
 * subtag (zh → zh-Hans), else the provider's first language. The stored preference is left
 * as it is, so returning to a provider that supports it restores it.
 */
export function effectiveTranslationLanguage(provider: Pick<PluginProviderInfo, 'languages'> | null | undefined, preferred: string): string {
  const languages = translationLanguages(provider);
  const wanted = preferred.toLowerCase();
  const primary = wanted.split('-')[0];
  return languages.find(tag => tag.toLowerCase() === wanted)
    ?? languages.find(tag => tag.toLowerCase().split('-')[0] === primary)
    ?? languages[0]!;
}
/** A language tag named in its own language, such as 日本語 for `ja`. */
export function languageDisplayName(tag: string): string {
  try { return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) ?? tag; } catch { return tag; }
}

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
  const metadata = Object.fromEntries(([['title', track.title], ['artist', track.artist], ['album', track.album]] as const)
    .flatMap(([key, value]) => value?.trim() ? [[key, value.trim().slice(0, 1024)]] : [])) as LyricTrackMetadata;
  return { id: `lyrics-${trackId}`, trackId, revision: await hash(JSON.stringify({ parser: 1, lines })),
    ...(Object.keys(metadata).length ? { metadata } : {}), lines };
}

/**
 * Translations the listener asked for in this session, by track, provider and target
 * language. Focus Mode translates only on request; remembering it keeps the result shown
 * when Focus Mode reopens or the track comes back. Never persisted.
 */
const requested = new Set<string>();
const requestListeners = new Set<() => void>();
export const translationRequestKey = (trackId: string, providerKey: string, targetLanguage: string) =>
  JSON.stringify([trackId, providerKey, targetLanguage]);
export const isTranslationRequested = (key: string) => requested.has(key);
export function subscribeTranslationRequests(listener: () => void): () => void {
  requestListeners.add(listener);
  return () => { requestListeners.delete(listener); };
}
export function setTranslationRequested(key: string, value: boolean): void {
  if (requested.has(key) === value) return;
  if (value) { requested.add(key); while (requested.size > 256) requested.delete(requested.values().next().value!); }
  else requested.delete(key);
  requestListeners.forEach(listener => listener());
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
