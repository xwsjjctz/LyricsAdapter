import type { SyncedLyricLine, Track } from '../types';
import {
  EMPTY_SYSTEM_LYRICS_STATE,
  SYSTEM_LYRICS_WINDOW_GRAPHEMES,
  type SystemLyricsState,
} from '../types/systemLyrics';
import { countGraphemes } from '../shared/graphemes';
import { normalizeSystemLyricsText } from '../shared/systemLyricsText';

const TRACK_ID_LIMIT = 4096;
const METADATA_LIMIT = 512;
const LYRIC_LINE_LIMIT = 4096;
const LAST_LINE_FALLBACK_SECONDS = 5;

function boundedText(
  value: string,
  limit: number,
  normalizeWhitespace = false,
): string {
  const normalized = normalizeWhitespace
    ? normalizeSystemLyricsText(value)
    : value.trim();
  if (normalized.length <= limit) return normalized;

  let result = '';
  for (const character of normalized) {
    if (result.length + character.length > limit) break;
    result += character;
  }
  return result;
}

/** Return the last line whose timestamp is not after the playback clock. */
export function findActiveLyricIndex(
  lines: readonly SyncedLyricLine[],
  currentTime: number,
): number {
  if (lines.length === 0 || !Number.isFinite(currentTime)) return -1;

  let low = 0;
  let high = lines.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const line = lines[middle];
    if (line && line.time <= currentTime) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Translate absolute QRC/YRC word timing to a user-visible character cursor.
 * Returning an integer keeps the 50ms native-surface sampler deduplicable.
 */
function findWordTimedCursor(
  line: SyncedLyricLine,
  currentTime: number,
  lineLength: number,
): number | null {
  const words = line.words;
  if (!words?.length) return null;

  const lastLineIndex = Math.max(0, lineLength - 1);
  let rawWordPrefix = '';
  let cursor = 0;
  let hasUsableTiming = false;
  for (const word of words) {
    const wordStart = countGraphemes(normalizeSystemLyricsText(rawWordPrefix));
    rawWordPrefix += word.text;
    const wordEnd = countGraphemes(normalizeSystemLyricsText(rawWordPrefix));
    const wordLength = Math.max(0, wordEnd - wordStart);
    if (wordLength === 0) continue;
    if (!Number.isFinite(word.time) || !Number.isFinite(word.duration) || word.duration < 0) {
      return null;
    }

    hasUsableTiming = true;
    if (currentTime < word.time) {
      // Before the first word, keep the first grapheme selected. In a gap
      // between words, keep the final grapheme of the completed word selected
      // until the next word actually starts.
      return clamp(cursor === 0 ? 0 : cursor - 1, 0, lastLineIndex);
    }

    if (word.duration === 0) {
      cursor = wordEnd;
      continue;
    }

    const progress = clamp((currentTime - word.time) / word.duration, 0, 1);
    if (progress < 1) {
      return clamp(
        Math.floor(wordStart + (wordLength * progress)),
        0,
        lastLineIndex,
      );
    }
    cursor = wordEnd;
  }

  // Parsed QRC/YRC text is assembled from the same words. Finish at the
  // rendered line end so malformed provider data cannot move past it.
  return hasUsableTiming ? lastLineIndex : null;
}

function findLineTimedCursor(
  track: Track,
  lines: readonly SyncedLyricLine[],
  activeIndex: number,
  currentTime: number,
  lineLength: number,
): number {
  const lineStart = lines[activeIndex]?.time ?? currentTime;
  const nextLineTime = lines[activeIndex + 1]?.time;
  let lineEnd = typeof nextLineTime === 'number'
    && Number.isFinite(nextLineTime)
    && nextLineTime > lineStart
    ? nextLineTime
    : Number.NaN;

  if (!Number.isFinite(lineEnd)) {
    if (Number.isFinite(track.duration) && track.duration > lineStart) {
      lineEnd = track.duration;
    } else {
      const previousLineTime = lines[activeIndex - 1]?.time;
      const previousSpan = typeof previousLineTime === 'number'
        && Number.isFinite(previousLineTime)
        && lineStart > previousLineTime
        ? lineStart - previousLineTime
        : LAST_LINE_FALLBACK_SECONDS;
      lineEnd = lineStart + previousSpan;
    }
  }

  const duration = Math.max(Number.EPSILON, lineEnd - lineStart);
  const progress = clamp((currentTime - lineStart) / duration, 0, 1);
  return clamp(
    Math.floor(lineLength * progress),
    0,
    Math.max(0, lineLength - 1),
  );
}

function buildLineCursor(
  track: Track,
  lines: readonly SyncedLyricLine[],
  activeIndex: number,
  currentTime: number,
  activeLine: string,
): number | null {
  if (activeIndex < 0 || !activeLine) return null;

  const lineLength = countGraphemes(activeLine);
  if (lineLength <= SYSTEM_LYRICS_WINDOW_GRAPHEMES) return null;

  const activeLyric = lines[activeIndex];
  if (!activeLyric) return null;
  return findWordTimedCursor(activeLyric, currentTime, lineLength)
    ?? findLineTimedCursor(track, lines, activeIndex, currentTime, lineLength);
}

export function buildSystemLyricsState(
  track: Track | null,
  currentTime: number,
  isPlaying: boolean,
): SystemLyricsState {
  if (!track) return EMPTY_SYSTEM_LYRICS_STATE;

  const lines = track.syncedLyrics ?? [];
  const activeIndex = findActiveLyricIndex(lines, currentTime);
  const title = boundedText(track.title, METADATA_LIMIT, true);
  const activeLine = activeIndex >= 0
    ? boundedText(lines[activeIndex]?.text ?? '', LYRIC_LINE_LIMIT, true)
    : '';
  const nextLine = boundedText(
    lines[activeIndex + 1]?.text ?? '',
    LYRIC_LINE_LIMIT,
    true,
  );
  const lineCursor = buildLineCursor(track, lines, activeIndex, currentTime, activeLine);

  return {
    trackId: boundedText(track.id, TRACK_ID_LIMIT),
    title,
    artist: boundedText(track.artist, METADATA_LIMIT, true),
    // Before the first timestamp (or for line-unsynchronised tracks), keep the
    // surface useful without pretending an arbitrary lyric is the active line.
    line: activeLine || title,
    nextLine,
    lineCursor,
    isPlaying,
  };
}
