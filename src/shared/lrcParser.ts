/**
 * Shared lyrics parser. AMLL is the only implementation for LRC, QRC and YRC;
 * callers keep the app's persisted seconds-based shape at this boundary.
 */
import { parseLrc, parseQrc, parseYrc, type LyricLine } from '@applemusic-like-lyrics/lyric';
import type { SyncedLyricLine } from '../types';

const LRC_HEADER_TAG = /^\[(ti|ar|al|by|offset|re|ve|length|sign):/i;

export interface ParsedLrc {
  plainText: string;
  /** Undefined when AMLL finds no timed lyric lines. */
  syncedLyrics?: SyncedLyricLine[] | undefined;
}

export type WordLyricsFormat = 'qrc' | 'yrc';

/** Parse provider lyrics through AMLL's QRC/YRC/LRC implementations. */
export function parseLyrics(
  lyrics: string,
  wordLyrics?: string | null,
  wordLyricsFormat?: WordLyricsFormat | null,
): ParsedLrc {
  let parsedWordLyrics: ParsedLrc | undefined;
  if (wordLyrics && wordLyricsFormat === 'qrc') {
    parsedWordLyrics = fromAmlLines(parseQrc(extractQrcContent(wordLyrics)), wordLyrics, true);
  }
  if (wordLyrics && wordLyricsFormat === 'yrc') {
    parsedWordLyrics = fromAmlLines(parseYrc(wordLyrics), wordLyrics, true);
  }

  // Provider APIs occasionally label ordinary LRC or malformed text as QRC/YRC.
  // Keep a valid line-synchronised LRC as the fallback in that case.
  if (parsedWordLyrics?.syncedLyrics?.some((line) => line.words?.length)) {
    return parsedWordLyrics;
  }

  return parseLRCLyrics(lyrics);
}

function extractQrcContent(raw: string): string {
  // Apostrophes are valid lyric content, so anchor on the closing `"/>` instead
  // of treating either quote character as the end of LyricContent.
  const lyricContent = raw.match(/LyricContent\s*=\s*"([\s\S]*?)"\s*\/>/i)?.[1];
  return decodeXml(lyricContent ?? raw);
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

export function parseLRCLyrics(lrc: string): ParsedLrc {
  return fromAmlLines(parseLrc(lrc), lrc, false);
}

function fromAmlLines(lines: LyricLine[], fallbackText: string, includeWordTiming: boolean): ParsedLrc {
  const syncedLyrics = lines
    .filter((line) => line.words.some((word) => word.word.trim()))
    .map((line) => {
      const text = line.words.map((word) => word.word).join('');
      const words = includeWordTiming
        ? timedWordsPreservingSeparators(line.words)
        : [];
      return {
        time: line.startTime / 1000,
        text,
        ...(words.length > 0 ? { words } : {}),
      };
    })
    .filter((line) => Number.isFinite(line.time) && line.text);

  return {
    plainText: syncedLyrics.length > 0
      ? syncedLyrics.map((line) => line.text).join('\n')
      : plainLyricsText(fallbackText),
    syncedLyrics: syncedLyrics.length > 0 ? syncedLyrics : undefined,
  };
}

/**
 * QQ QRC commonly stores spaces between English words as zero-duration tokens.
 * AMLL needs positive-duration words, so fold those separators into the nearest
 * timed token instead of dropping them and rendering the whole line joined up.
 */
function timedWordsPreservingSeparators(words: LyricLine['words']): NonNullable<SyncedLyricLine['words']> {
  const timedWords: NonNullable<SyncedLyricLine['words']> = [];
  let prefix = '';

  for (const word of words) {
    if (!word.word) continue;
    const hasFiniteTiming = Number.isFinite(word.startTime) && Number.isFinite(word.endTime);
    const duration = hasFiniteTiming ? (word.endTime - word.startTime) / 1000 : 0;

    if (duration <= 0) {
      const previous = timedWords[timedWords.length - 1];
      if (previous) previous.text += word.word;
      else prefix += word.word;
      continue;
    }

    timedWords.push({
      time: word.startTime / 1000,
      duration,
      text: prefix + word.word,
    });
    prefix = '';
  }

  if (prefix && timedWords.length > 0) {
    timedWords[timedWords.length - 1]!.text += prefix;
  }

  return timedWords;
}

function plainLyricsText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !LRC_HEADER_TAG.test(line))
    .join('\n');
}
