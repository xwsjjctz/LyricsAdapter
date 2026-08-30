import type { SyncedLyricLine, Track } from '../types';
import {
  EMPTY_SYSTEM_LYRICS_STATE,
  type SystemLyricsState,
} from '../types/systemLyrics';

const TRACK_ID_LIMIT = 4096;
const METADATA_LIMIT = 512;
const LYRIC_LINE_LIMIT = 4096;

function boundedText(value: string, limit: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;

  let result = '';
  for (const character of trimmed) {
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

export function buildSystemLyricsState(
  track: Track | null,
  currentTime: number,
  isPlaying: boolean,
): SystemLyricsState {
  if (!track) return EMPTY_SYSTEM_LYRICS_STATE;

  const lines = track.syncedLyrics ?? [];
  const activeIndex = findActiveLyricIndex(lines, currentTime);
  const title = boundedText(track.title, METADATA_LIMIT);
  const activeLine = activeIndex >= 0
    ? boundedText(lines[activeIndex]?.text ?? '', LYRIC_LINE_LIMIT)
    : '';
  const nextLine = boundedText(lines[activeIndex + 1]?.text ?? '', LYRIC_LINE_LIMIT);

  return {
    trackId: boundedText(track.id, TRACK_ID_LIMIT),
    title,
    artist: boundedText(track.artist, METADATA_LIMIT),
    // Before the first timestamp (or for line-unsynchronised tracks), keep the
    // surface useful without pretending an arbitrary lyric is the active line.
    line: activeLine || title,
    nextLine,
    isPlaying,
  };
}
