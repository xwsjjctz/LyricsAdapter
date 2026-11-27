import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../logger';
import {
  normalizeMatchText,
  rankLyricsCandidates,
  lyricsSearchTerms,
  type LyricsMatchQuery,
} from '../../../src/domain/lyricsMatch';
import type { OnlineLyricsResult } from '../../../src/shared/onlineMusic';

/**
 * AMLL TTML DB (https://github.com/amll-dev/amll-ttml-db, CC0-1.0): a community
 * collection of hand-timed word-by-word lyrics. Its index lists every song with
 * its platform ids, and each id has the lyrics pre-converted to YRC and LRC.
 * The index is matched here, so a track's title never leaves the machine; only
 * the lyric file of a match is requested.
 */

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface AmllLyricsDbOptions {
  /** Where the downloaded index is kept between launches. */
  directory: string;
  fetcher: Fetcher;
  now?: () => number;
}

interface IndexEntry {
  title: string;
  artists: string[];
  album: string | undefined;
  /** `<platform folder>/<id>` of the first platform this song is filed under. */
  lyricPath: string;
}

/** The repository itself is the only source; no mirror is asked on the user's behalf. */
const SOURCE = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main';
const INDEX_PATH = 'metadata/raw-lyrics-index.jsonl';
const INDEX_FILE = 'amll-index.jsonl';
/** Platform id fields of an index entry and the folders their lyrics live in, in order of preference. */
const PLATFORMS: readonly (readonly [field: string, folder: string])[] = [
  ['ncmMusicId', 'ncm-lyrics'],
  ['qqMusicId', 'qq-lyrics'],
  ['appleMusicId', 'am-lyrics'],
  ['spotifyId', 'spotify-lyrics'],
];
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const INDEX_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const INDEX_RETRY_AFTER_MS = 10 * 60 * 1000;
const INDEX_MAX_BYTES = 32 * 1024 * 1024;
const INDEX_TIMEOUT_MS = 60_000;
const LYRIC_MAX_BYTES = 1024 * 1024;
const LYRIC_TIMEOUT_MS = 15_000;

function values(metadata: unknown, field: string): string[] {
  if (!Array.isArray(metadata)) return [];
  const pair = metadata.find((item): item is [string, unknown[]] =>
    Array.isArray(item) && item[0] === field && Array.isArray(item[1]));
  return pair ? pair[1].filter((value): value is string => typeof value === 'string' && value.trim() !== '') : [];
}

/** Entries by normalised title. Later lines supersede earlier ones for the same song, as the index is oldest first. */
export function parseAmllIndex(text: string): Map<string, IndexEntry[]> {
  const byTitle = new Map<string, IndexEntry[]>();
  const seen = new Set<string>();
  const lines = text.split('\n');
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!.trim();
    if (!line) continue;
    let metadata: unknown;
    try {
      metadata = (JSON.parse(line) as { metadata?: unknown }).metadata;
    } catch {
      continue;
    }
    const lyricPath = PLATFORMS
      .flatMap(([field, folder]) => values(metadata, field).filter(id => SAFE_ID.test(id)).map(id => `${folder}/${id}`))[0];
    if (!lyricPath || seen.has(lyricPath)) continue;
    seen.add(lyricPath);
    const artists = values(metadata, 'artists');
    const album = values(metadata, 'album')[0];
    for (const title of values(metadata, 'musicName')) {
      const key = normalizeMatchText(title);
      if (!key) continue;
      const entries = byTitle.get(key) ?? [];
      entries.push({ title, artists, album, lyricPath });
      byTitle.set(key, entries);
    }
  }
  return byTitle;
}

export class AmllLyricsDb {
  private readonly now: () => number;
  private index: Map<string, IndexEntry[]> | null = null;
  private loading: Promise<Map<string, IndexEntry[]> | null> | null = null;
  private refreshing = false;
  private retryAt = 0;

  constructor(private readonly options: AmllLyricsDbOptions) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Lyrics for the track, or null when the collection has none that certainly
   * belong to it. Throws while the index or a matched lyric file cannot be
   * fetched, which is not an answer: the caller may try the track again later.
   */
  async match(query: LyricsMatchQuery): Promise<OnlineLyricsResult | null> {
    const index = await this.loadIndex();
    if (!index) throw new Error('The community lyrics index is unavailable');
    // The collection gives no durations, so the artist has to confirm an exactly matching title.
    const terms = lyricsSearchTerms(query);
    if (!terms.artist) return null;
    const candidates = index.get(normalizeMatchText(terms.title)) ?? [];
    const best = rankLyricsCandidates({ ...query, duration: undefined }, candidates, entry => entry)[0];
    if (!best) return null;

    const [wordLyrics, lyrics] = await Promise.all([
      this.fetchText(`${best.lyricPath}.yrc`, LYRIC_MAX_BYTES, LYRIC_TIMEOUT_MS),
      this.fetchText(`${best.lyricPath}.lrc`, LYRIC_MAX_BYTES, LYRIC_TIMEOUT_MS),
    ]);
    if (!wordLyrics?.trim() && !lyrics?.trim()) return null;
    logger.info('[AmllLyricsDb] Matched', best.lyricPath, 'for', terms.title);
    return {
      lyrics: lyrics ?? '',
      ...(wordLyrics?.trim() ? { wordLyrics, wordLyricsFormat: 'yrc' as const } : {}),
    };
  }

  private get indexFile(): string {
    return path.join(this.options.directory, INDEX_FILE);
  }

  private loadIndex(): Promise<Map<string, IndexEntry[]> | null> {
    if (this.index) return Promise.resolve(this.index);
    this.loading ??= this.readOrDownloadIndex().finally(() => { this.loading = null; });
    return this.loading;
  }

  private async readOrDownloadIndex(): Promise<Map<string, IndexEntry[]> | null> {
    try {
      const stats = await fs.promises.stat(this.indexFile);
      this.index = parseAmllIndex(await fs.promises.readFile(this.indexFile, 'utf8'));
      // A stale copy still answers now, while a newer one downloads in the background.
      if (this.now() - stats.mtimeMs > INDEX_MAX_AGE_MS) void this.refreshIndex();
      return this.index;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('[AmllLyricsDb] Cannot read the saved index:', error);
      }
    }
    if (this.now() < this.retryAt) return null;
    const text = await this.downloadIndex();
    if (!text) return null;
    this.index = parseAmllIndex(text);
    return this.index;
  }

  private async refreshIndex(): Promise<void> {
    if (this.refreshing || this.now() < this.retryAt) return;
    this.refreshing = true;
    try {
      const text = await this.downloadIndex();
      if (text) this.index = parseAmllIndex(text);
    } finally {
      this.refreshing = false;
    }
  }

  /** Downloads and saves the index; null (and a pause before the next try) when it cannot be fetched. */
  private async downloadIndex(): Promise<string | null> {
    const text = await this.fetchText(INDEX_PATH, INDEX_MAX_BYTES, INDEX_TIMEOUT_MS).catch(() => null);
    if (!text) {
      this.retryAt = this.now() + INDEX_RETRY_AFTER_MS;
      return null;
    }
    try {
      await fs.promises.mkdir(this.options.directory, { recursive: true });
      const temporary = `${this.indexFile}.${process.pid}.tmp`;
      await fs.promises.writeFile(temporary, text, 'utf8');
      await fs.promises.rename(temporary, this.indexFile);
    } catch (error) {
      logger.warn('[AmllLyricsDb] Cannot save the index:', error);
    }
    return text;
  }

  /** The file's text, or null when the repository has no such file. Throws when it cannot be fetched. */
  private async fetchText(relativePath: string, maxBytes: number, timeoutMs: number): Promise<string | null> {
    const url = `${SOURCE}/${relativePath}`;
    try {
      const response = await this.options.fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
        await response.body?.cancel();
        throw new Error('Response is too large');
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > maxBytes) throw new Error('Response is too large');
      return new TextDecoder('utf-8').decode(bytes);
    } catch (error) {
      logger.warn('[AmllLyricsDb] Request failed:', url, error);
      throw error;
    }
  }
}
