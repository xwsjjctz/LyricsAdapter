import type { LyricLine as AmlLyricLine } from '@applemusic-like-lyrics/core';
import type { SyncedLyricLine, Track } from '../../types';

const PLAIN_LYRIC_TIMESTAMP = /^\[\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?\]/;
const DEFAULT_UNTIMED_LINE_SECONDS = 4;

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function toMilliseconds(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1000));
}

function plainLyricsToSynced(track: Track): SyncedLyricLine[] {
  if (!track.lyrics) return [];
  const texts = track.lyrics
    .split(/\r?\n/)
    .map((line) => decodeEntities(line.trim().replace(PLAIN_LYRIC_TIMESTAMP, '')))
    .filter((line) => line.length > 0 && line !== '//');
  if (texts.length === 0) return [];

  const segmentSeconds = track.duration > 0
    ? track.duration / texts.length
    : DEFAULT_UNTIMED_LINE_SECONDS;
  return texts.map((text, index) => ({
    time: segmentSeconds * index,
    text,
  }));
}

function focusLyricSource(track: Track): SyncedLyricLine[] {
  if (!track.syncedLyrics?.length) return plainLyricsToSynced(track);

  const lines = [...track.syncedLyrics];
  if (track.source === 'netease' && (track.title || track.artist)) {
    const title = [track.title, track.artist].filter(Boolean).join(' - ');
    if (title) lines.unshift({ time: 0, text: title });
  }
  return lines;
}

function nextDistinctStart(lines: SyncedLyricLine[], index: number, startTime: number): number | undefined {
  for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
    const nextLine = lines[nextIndex];
    if (!nextLine || !Number.isFinite(nextLine.time)) continue;
    const nextStart = toMilliseconds(nextLine.time);
    if (nextStart > startTime) return nextStart;
  }
  return undefined;
}

/** Convert the persisted LyricsAdapter shape to AMLL's immutable millisecond timeline. */
export function trackToAmlLyricLines(track: Track | null): AmlLyricLine[] {
  if (!track) return [];
  const sourceLines = focusLyricSource(track)
    .filter((line) => Number.isFinite(line.time) && line.text.trim())
    .sort((left, right) => left.time - right.time);
  const trackEndTime = track.duration > 0 ? toMilliseconds(track.duration) : undefined;

  return sourceLines.map((line, index) => {
    const startTime = toMilliseconds(line.time);
    const text = decodeEntities(line.text);
    const timedWords = line.words
      ?.filter((word) => word.text && Number.isFinite(word.time) && Number.isFinite(word.duration) && word.duration > 0)
      .map((word) => {
        const wordStart = toMilliseconds(word.time);
        return {
          word: decodeEntities(word.text),
          startTime: wordStart,
          endTime: Math.max(wordStart + 1, toMilliseconds(word.time + word.duration)),
        };
      }) ?? [];
    const lastWordEnd = timedWords.reduce((latest, word) => Math.max(latest, word.endTime), startTime);
    const nextStart = nextDistinctStart(sourceLines, index, startTime);
    const fallbackEnd = nextStart
      ?? (trackEndTime && trackEndTime > startTime ? trackEndTime : startTime + DEFAULT_UNTIMED_LINE_SECONDS * 1000);
    const endTime = Math.max(startTime + 1, lastWordEnd, fallbackEnd);

    return {
      words: timedWords.length > 0
        ? timedWords
        : [{ word: text, startTime, endTime }],
      translatedLyric: '',
      romanLyric: '',
      startTime,
      endTime,
      isBG: false,
      isDuet: false,
    };
  });
}
