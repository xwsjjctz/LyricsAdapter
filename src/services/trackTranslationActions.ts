import type { Track } from '../types';
import type { PluginProviderInfo } from '../shared/plugin';
import {
  acquireTranslation, clearTranslation, lyricDocumentForTrack,
  setTranslationRequested, translationRequestKey,
} from './pluginTranslation';

export type TrackTranslationAction = 'reload' | 'clear';
interface ActionSnapshot { version: number; clearRevision: number; kind?: TrackTranslationAction }
interface Job { kind: TrackTranslationAction; cancel: () => void; promise: Promise<boolean> }
const IDLE: ActionSnapshot = { version: 0, clearRevision: 0 };
const snapshots = new Map<string, ActionSnapshot>();
const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();
let version = 0;
export const subscribeTrackTranslationActions = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const getTrackTranslationVersion = () => version;
export const getTrackTranslationAction = (key: string): ActionSnapshot => snapshots.get(key) ?? IDLE;
const publish = (key: string, snapshot: Omit<ActionSnapshot, 'version'>) => {
  snapshots.set(key, { ...snapshot, version: ++version });
  listeners.forEach(listener => listener());
};

/** Menu work belongs to the selected song, survives closing the menu, and never changes playback. */
export function runTrackTranslationAction(track: Track, provider: PluginProviderInfo, language: string, scope: string, kind: TrackTranslationAction): Promise<boolean> {
  if (!provider.cacheControl) return Promise.reject(new Error('Translation provider does not support cache control'));
  const key = translationRequestKey(track.id, provider.key, language);
  const existing = jobs.get(key);
  if (existing?.kind === kind) return existing.promise;
  if (existing?.kind === 'clear') return Promise.reject(new Error('Translation is being cleared'));
  existing?.cancel();
  let cancelled = false;
  let release: (() => void) | undefined;
  const cancel = () => { cancelled = true; release?.(); };
  const previous = getTrackTranslationAction(key);
  const clearRevision = previous.clearRevision + (kind === 'clear' ? 1 : 0);
  if (kind === 'clear') setTranslationRequested(key, false);
  const job: Job = { kind, cancel, promise: Promise.resolve(false) };
  // Yield before hashing so callers and every mounted lyric view see the same job first.
  job.promise = Promise.resolve().then(async () => {
    const document = await lyricDocumentForTrack(track);
    if (cancelled || jobs.get(key) !== job) return false;
    if (kind === 'clear') {
      await clearTranslation(provider, document, language);
    } else {
      if (!document.lines.length) throw new Error('The lyrics have no lines to translate');
      const lease = acquireTranslation(provider, document, language, scope, true);
      release = lease.release;
      await lease.promise;
      if (cancelled || jobs.get(key) !== job) return false;
      setTranslationRequested(key, true);
    }
    return true;
  }).catch(error => {
    if (cancelled || jobs.get(key) !== job) return false;
    throw error;
  }).finally(() => {
    release?.();
    if (jobs.get(key) === job) {
      jobs.delete(key);
      publish(key, { clearRevision });
    }
  });
  jobs.set(key, job);
  publish(key, { kind, clearRevision });
  return job.promise;
}
