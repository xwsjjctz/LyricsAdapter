import type { Track } from '../types';
import type { LyricDocument, LyricLine, LyricTrackMetadata, TranslationResult, PluginProviderInfo } from '../shared/plugin';
import { validateTranslationResult } from '../shared/pluginValidation';
import { getDesktopAPI } from './desktopAdapter';

/** Offered when a provider does not declare its target languages (lyrics.translation 1.2). */
export const DEFAULT_TRANSLATION_LANGUAGES: readonly string[] = ['zh', 'en', 'ja', 'ko'];
export const translationLanguages = (provider: Pick<PluginProviderInfo, 'id' | 'languages'> | null | undefined): readonly string[] =>
  provider?.languages?.length ? provider.languages : DEFAULT_TRANSLATION_LANGUAGES;
/**
 * The preferred language when the provider supports it, else one with the same primary
 * subtag (zh → zh-Hans), else the provider's first language. The stored preference is left
 * as it is, so returning to a provider that supports it restores it.
 */
export function effectiveTranslationLanguage(provider: Pick<PluginProviderInfo, 'id' | 'languages'> | null | undefined, preferred: string): string {
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
const pending = new Map<string, { promise: Promise<TranslationResult>; requestId: string; references: number; reload: boolean }>();
const clearing = new Map<string, Promise<void>>();
const translationScope = (providerKey: string, documentId: string, language: string) => JSON.stringify([providerKey, documentId, language.toLowerCase()]);
const matchesScope = (key: string, providerKey: string, documentId: string, language: string) => {
  const [provider, , document, , target] = JSON.parse(key) as string[];
  return provider === providerKey && document === documentId && target?.toLowerCase() === language.toLowerCase();
};

function cancelPending(providerKey: string, documentId: string, language: string): void {
  for (const [key, entry] of pending) {
    if (!matchesScope(key, providerKey, documentId, language)) continue;
    pending.delete(key);
    getDesktopAPI()?.pluginCancel?.(entry.requestId);
  }
}
function evictResults(providerKey: string, documentId: string, language: string): void {
  for (const key of cache.keys()) if (matchesScope(key, providerKey, documentId, language)) cache.delete(key);
}

/** Remove this track/language across revisions and configuration scopes, without starting a translation. */
export function clearTranslation(provider: PluginProviderInfo, document: LyricDocument, targetLanguage: string): Promise<void> {
  const scope = translationScope(provider.key, document.id, targetLanguage);
  const existing = clearing.get(scope);
  if (existing) return existing;
  cancelPending(provider.key, document.id, targetLanguage);
  evictResults(provider.key, document.id, targetLanguage);
  const operation = Promise.resolve().then(async () => {
    const api = getDesktopAPI();
    if (!provider.cacheControl || !api?.pluginClearTranslation) throw new Error('Translation provider does not support clearing translations');
    await api.pluginClearTranslation({ requestId: crypto.randomUUID(), providerKey: provider.key, request: { document, targetLanguage } });
  }).finally(() => { if (clearing.get(scope) === operation) clearing.delete(scope); });
  clearing.set(scope, operation);
  return operation;
}

/** Lease shared work; reload keeps the last successful result until a replacement succeeds. */
export function acquireTranslation(provider: PluginProviderInfo, document: LyricDocument, targetLanguage: string, scope: string, reload = false) {
  const key = JSON.stringify([provider.key, provider.version, document.id, document.revision, targetLanguage, scope]);
  const barrier = clearing.get(translationScope(provider.key, document.id, targetLanguage));
  let entry = pending.get(key);
  if (reload && !entry?.reload) {
    cancelPending(provider.key, document.id, targetLanguage);
    entry = undefined;
  }
  const cached = cache.get(key);
  if (!reload && !barrier && !entry?.reload && cached) return { promise: Promise.resolve(cached), release: () => {} };
  if (!entry) {
    const requestId = crypto.randomUUID();
    const request = { document, targetLanguage, ...(reload ? { cacheMode: 'reload' as const } : {}) };
    const api = getDesktopAPI();
    const promise = Promise.resolve().then(async () => {
      if (barrier) await barrier;
      if (pending.get(key)?.requestId !== requestId) throw new Error('Translation request cancelled');
      if (reload && !provider.cacheControl) throw new Error('Translation provider does not support reload');
      if (!api?.pluginTranslate) throw new Error('Plugin platform is unavailable');
      const result = validateTranslationResult(await api.pluginTranslate({ requestId, providerKey: provider.key, request }), request);
      // A cancelled lease must not populate any cache even if the provider ignores cancellation.
      if (pending.get(key)?.requestId === requestId) {
        evictResults(provider.key, document.id, targetLanguage);
        cache.set(key, result); while (cache.size > 32) cache.delete(cache.keys().next().value!);
      }
      return result;
    }).finally(() => { if (pending.get(key)?.requestId === requestId) pending.delete(key); });
    entry = { promise, requestId, references: 0, reload }; pending.set(key, entry);
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
