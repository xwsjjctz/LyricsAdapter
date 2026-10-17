import { createHash } from 'node:crypto';
import type { JsonValue, LyricDocument, PluginContext } from '@lyrics-adapter/plugin-sdk';

/**
 * Translations are cached per song (one cache entry per opaque track id) and, inside it,
 * per target language and prompt signature. A changed lyric revision makes the entry stale.
 */
interface CachedVariant {
  revision: string;
  model: string;
  createdAt: string;
  lines: Record<string, string>;
}
interface CachedTrack {
  version: 1;
  variants: Record<string, CachedVariant>;
}

const MAX_VARIANTS_PER_TRACK = 8;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Host track ids are SHA-256 hex; anything else is hashed so it always forms a valid cache key. */
function cacheKey(trackId: string): string {
  return `track-${/^[a-f0-9]{64}$/.test(trackId) ? trackId : sha256(trackId)}`;
}

export function variantKey(targetLanguage: string, signature: string): string {
  return `${targetLanguage.toLowerCase()}|${sha256(signature).slice(0, 16)}`;
}

function readTrack(value: JsonValue | undefined): CachedTrack {
  if (value && typeof value === 'object' && !Array.isArray(value) && value['version'] === 1
    && value['variants'] && typeof value['variants'] === 'object' && !Array.isArray(value['variants'])) {
    return value as unknown as CachedTrack;
  }
  return { version: 1, variants: {} };
}

export async function readCachedTranslation(context: PluginContext, document: LyricDocument, variant: string): Promise<Record<string, string> | undefined> {
  const cached = readTrack(await context.cache.get(cacheKey(document.trackId))).variants[variant];
  if (!cached || cached.revision !== document.revision || !cached.lines || typeof cached.lines !== 'object') return undefined;
  const known = new Set(document.lines.map(line => line.id));
  return Object.fromEntries(Object.entries(cached.lines).filter(([id, text]) => known.has(id) && typeof text === 'string'));
}

export async function writeCachedTranslation(context: PluginContext, document: LyricDocument, variant: string, model: string, lines: Record<string, string>): Promise<void> {
  const key = cacheKey(document.trackId);
  const track = readTrack(await context.cache.get(key));
  const entries = Object.entries({ ...track.variants, [variant]: { revision: document.revision, model, createdAt: new Date().toISOString(), lines } })
    .sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_VARIANTS_PER_TRACK);
  const next: CachedTrack = { version: 1, variants: Object.fromEntries(entries) };
  await context.cache.set(key, next as unknown as JsonValue);
}
