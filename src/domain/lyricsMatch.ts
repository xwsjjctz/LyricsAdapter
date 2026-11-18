/**
 * Decides whether a song found elsewhere is the same recording as a local
 * track, so its lyrics can be used. Wrong lyrics are worse than none: a match
 * needs the title to agree and either the artist or the duration to confirm it.
 */

export interface LyricsMatchQuery {
  title: string;
  artist: string;
  album?: string | undefined;
  /** Seconds; 0 or absent when unknown. */
  duration?: number | undefined;
}

export interface LyricsMatchCandidate {
  title: string;
  artists: readonly string[];
  album?: string | undefined;
  /** Seconds; 0 or absent when the source does not say. */
  duration?: number | undefined;
}

const UNKNOWN_ARTISTS = new Set(['', 'unknown', 'unknownartist', 'variousartists', '未知艺术家', '未知歌手', '群星']);
const BRACKETED = /[(（[【〈《「『][^)）\]】〉》」』]*[)）\]】〉》」』]/g;
const ARTIST_SEPARATORS = /\s*(?:[/／,，、;；&＆×]|\b(?:feat|ft|vs)\.?(?![a-z])|\bwith\b|\sx\s)\s*/i;
/** Titles of recordings without sung words; lyrics of the vocal version do not belong on them. */
const INSTRUMENTAL = /instrumental|\binst\b|off\s?vocal|karaoke|伴奏|纯音乐|純音樂|カラオケ|インスト/i;

const DURATION_EXACT_SECONDS = 3;
const DURATION_CLOSE_SECONDS = 6;

/** Case, width, spacing and punctuation never tell two songs apart. */
export function normalizeMatchText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * A tag title without a leading track number: `03. Song` and `03 - Song` name
 * the song `Song`. Titles that are themselves numbers (`99.9`, `1-800-273-8255`) stay whole.
 */
function withoutTrackNumber(title: string): string {
  return title.replace(/^\s*\d{1,3}(?:\s*[.、]\s*|\s*[-_]\s+)(?=[^\d\s])/, '');
}

export function splitArtists(artist: string): string[] {
  return artist.split(ARTIST_SEPARATORS).map(name => name.trim()).filter(Boolean);
}

function knownArtists(artist: string): string[] {
  return splitArtists(artist).map(normalizeMatchText).filter(name => !UNKNOWN_ARTISTS.has(name));
}

export function isInstrumentalTitle(title: string): boolean {
  return INSTRUMENTAL.test(title);
}

/**
 * The title and artist to look a track up by. Files tagged only by name often
 * read `Artist - Song`; when the tag has no artist that prefix is the artist.
 */
export function lyricsSearchTerms(query: LyricsMatchQuery): { title: string; artist: string } {
  const title = withoutTrackNumber(query.title).trim();
  const artists = splitArtists(query.artist).filter(name => !UNKNOWN_ARTISTS.has(normalizeMatchText(name)));
  const separator = title.indexOf(' - ');
  if (separator > 0) {
    const left = title.slice(0, separator).trim();
    const right = title.slice(separator + 3).trim();
    if (right && artists.length === 0) return { title: right, artist: left };
    if (right && artists.some(name => normalizeMatchText(name) === normalizeMatchText(left))) {
      return { title: right, artist: artists[0]! };
    }
  }
  return { title, artist: artists[0] ?? '' };
}

/** 1 for the same title, 0.85 when only bracketed notes differ, 0 otherwise. */
function titleScore(query: string, candidate: string): number {
  const full = normalizeMatchText(query);
  if (!full) return 0;
  if (full === normalizeMatchText(candidate)) return 1;
  const core = normalizeMatchText(query.replace(BRACKETED, ' '));
  return core && core === normalizeMatchText(candidate.replace(BRACKETED, ' ')) ? 0.85 : 0;
}

/** null when the local track names no artist, so the artist can neither confirm nor refute. */
function artistScore(query: string, candidates: readonly string[]): number | null {
  const wanted = knownArtists(query);
  if (wanted.length === 0) return null;
  const offered = candidates.flatMap(splitArtists).map(normalizeMatchText).filter(Boolean);
  const overlaps = wanted.some(name => offered.some(other =>
    name === other || (Math.min(name.length, other.length) >= 2 && (name.includes(other) || other.includes(name)))));
  return overlaps ? 1 : 0;
}

/** null when either side has no duration. */
function durationScore(query: number | undefined, candidate: number | undefined): number | null {
  if (!query || !candidate || query <= 0 || candidate <= 0) return null;
  const difference = Math.abs(query - candidate);
  if (difference <= DURATION_EXACT_SECONDS) return 1;
  return difference <= DURATION_CLOSE_SECONDS ? 0.5 : 0;
}

/**
 * How well a candidate fits, or null when it must not be used: a different
 * title, a different artist, a clearly different length (another version), or
 * nothing but the title to go on.
 */
export function scoreLyricsCandidate(query: LyricsMatchQuery, candidate: LyricsMatchCandidate): number | null {
  const terms = lyricsSearchTerms(query);
  const title = titleScore(terms.title, candidate.title);
  if (title === 0) return null;
  const artist = artistScore(terms.artist, candidate.artists);
  const duration = durationScore(query.duration, candidate.duration);
  if (artist === 0 || duration === 0) return null;
  // Without an artist, only an exact title of the same length is trusted.
  if (artist === null && (title < 1 || duration !== 1)) return null;
  const sameAlbum = Boolean(query.album && candidate.album
    && normalizeMatchText(query.album) === normalizeMatchText(candidate.album));
  return title * 2 + (artist ?? 0.5) * 2 + (duration ?? 0.5) * 2 + (sameAlbum ? 0.5 : 0);
}

/** Usable candidates, best first; ties keep the source's own order. */
export function rankLyricsCandidates<T>(
  query: LyricsMatchQuery,
  candidates: readonly T[],
  describe: (candidate: T) => LyricsMatchCandidate,
): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: scoreLyricsCandidate(query, describe(candidate)) }))
    .filter((entry): entry is { candidate: T; index: number; score: number } => entry.score !== null)
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .map(entry => entry.candidate);
}
