import type { SyncedLyricLine, Track } from '../types';
import {
  EMPTY_SYSTEM_LYRICS_STATE,
  SYSTEM_LYRICS_WINDOW_GRAPHEMES,
  type SystemLyricsState,
} from '../types/systemLyrics';
import { countGraphemes } from '../shared/graphemes';
import { normalizeSystemLyricsText } from '../shared/systemLyricsText';

const TRACK_ID_LIMIT = 4096;
const COVER_URL_LIMIT = 8192;
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

function safeCoverUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.length > COVER_URL_LIMIT) return '';

  try {
    const protocol = new URL(trimmed).protocol;
    return protocol === 'cover:' || protocol === 'https:' ? trimmed : '';
  } catch {
    return '';
  }
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

interface LineTiming {
  /** Zero-based grapheme that should anchor a scrolling lyric window. */
  cursor: number;
  /** Count of graphemes whose timing has completed. */
  progress: number;
}

/** Translate absolute QRC/YRC word timing to scrolling and karaoke positions. */
function findWordTimedPosition(
  line: SyncedLyricLine,
  currentTime: number,
  lineLength: number,
): LineTiming | null {
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
      return {
        cursor: clamp(cursor === 0 ? 0 : cursor - 1, 0, lastLineIndex),
        progress: clamp(cursor, 0, lineLength),
      };
    }

    if (word.duration === 0) {
      cursor = wordEnd;
      continue;
    }

    const progress = clamp((currentTime - word.time) / word.duration, 0, 1);
    if (progress < 1) {
      const completed = clamp(
        Math.floor(wordStart + (wordLength * progress)),
        0,
        lineLength,
      );
      return {
        cursor: clamp(completed, 0, lastLineIndex),
        progress: completed,
      };
    }
    cursor = wordEnd;
  }

  // Parsed QRC/YRC text is assembled from the same words. Finish at the
  // rendered line end so malformed provider data cannot move past it.
  return hasUsableTiming
    ? { cursor: lastLineIndex, progress: lineLength }
    : null;
}

function findLineTimedPosition(
  track: Track,
  lines: readonly SyncedLyricLine[],
  activeIndex: number,
  currentTime: number,
  lineLength: number,
): LineTiming {
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
  const completed = clamp(
    Math.floor(lineLength * progress),
    0,
    lineLength,
  );
  return {
    cursor: clamp(completed, 0, Math.max(0, lineLength - 1)),
    progress: completed,
  };
}

function buildLineTiming(
  track: Track,
  lines: readonly SyncedLyricLine[],
  activeIndex: number,
  currentTime: number,
  activeLine: string,
): { lineCursor: number | null; lineProgress: number | null } | null {
  if (activeIndex < 0 || !activeLine) return null;

  const lineLength = countGraphemes(activeLine);
  const activeLyric = lines[activeIndex];
  if (!activeLyric) return { lineCursor: null, lineProgress: null };
  const timing = findWordTimedPosition(activeLyric, currentTime, lineLength)
    ?? findLineTimedPosition(track, lines, activeIndex, currentTime, lineLength);
  return {
    lineCursor: lineLength > SYSTEM_LYRICS_WINDOW_GRAPHEMES
      ? timing.cursor
      : null,
    lineProgress: timing.progress,
  };
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
  const timing = buildLineTiming(track, lines, activeIndex, currentTime, activeLine);

  return {
    trackId: boundedText(track.id, TRACK_ID_LIMIT),
    coverUrl: safeCoverUrl(track.coverUrl),
    title,
    artist: boundedText(track.artist, METADATA_LIMIT, true),
    // Keep lyrics semantic: platform renderers may choose their own empty-line
    // fallback without receiving track metadata disguised as a lyric.
    line: activeLine,
    nextLine,
    lineCursor: timing?.lineCursor ?? null,
    lineProgress: timing?.lineProgress ?? null,
    isPlaying,
  };
}
