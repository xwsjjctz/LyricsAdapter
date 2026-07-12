/**
 * LRC 歌词解析器（全项目唯一真身）。
 *
 * 渲染层主线程（src/services/metadataService.ts）、Web Worker
 *（src/services/workers/metadataWorker.ts）均直接引用本文件。
 *
 * 主进程也通过同一个第三方 AMLL 库解析 LRC；本文件中的旧实现仅作为
 * `@dead_code` 回滚参考保留，禁止再为它添加调用点。
 */
import { parseLrc, parseQrc, parseYrc, type LyricLine } from '@applemusic-like-lyrics/lyric';
import type { SyncedLyricLine } from '../types';

/** LRC metadata tags like [ti:Title], [ar:Artist] that should be filtered. */
const LRC_HEADER_TAG = /^\[(ti|ar|al|by|offset|re|ve|length|sign):/i;

/** LRC 时间戳：[mm:ss.xx]、[mm:ss]、或 [hh:mm:ss]。 */
const LRC_TIME_REGEX = /\[(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{2,3}))?\]/g;

export interface ParsedLrc {
  plainText: string;
  /** 时间戳为空时返回 undefined（渲染层调用方依赖此契约）。 */
  syncedLyrics?: SyncedLyricLine[] | undefined;
}

export type WordLyricsFormat = 'qrc' | 'yrc';

const WORD_LYRIC_LINE = /^\[(\d+),(\d+)\](.*)$/;
const YRC_WORD_TOKEN = /\((\d+),(\d+)(?:,\d+)?\)([^()]*)/g;
const QRC_WORD_TOKEN = /([^()]*?)\((\d+),(\d+)(?:,\d+)?\)/g;

/**
 * @deprecated @dead_code Retained as a reference implementation while AMLL is
 * the production parser. Do not add new callers; use `parseLyrics` instead.
 */
export function parseWordLyrics(raw: string, format: WordLyricsFormat): ParsedLrc | undefined {
  const content = format === 'qrc' ? extractQrcContent(raw) : raw;
  const syncedLyrics: SyncedLyricLine[] = [];

  for (const source of content.split(/\r?\n/)) {
    const line = source.trim();
    const lineMatch = line.match(WORD_LYRIC_LINE);
    if (!lineMatch) continue;

    const lineTime = Number(lineMatch[1]);
    const lineDuration = Number(lineMatch[2]);
    if (!Number.isFinite(lineTime) || !Number.isFinite(lineDuration)) continue;

    const words = format === 'qrc'
      ? parseQrcWords(lineMatch[3]!)
      : parseYrcWords(lineMatch[3]!);
    const trailingText = decodeXml(lineMatch[3]!.replace(format === 'qrc' ? QRC_WORD_TOKEN : YRC_WORD_TOKEN, '')).trim();
    const text = words.map((word) => word.text).join('') || trailingText;
    if (!text) continue;

    syncedLyrics.push({
      time: lineTime / 1000,
      text,
      ...(words.length > 0 ? { words } : {}),
    });
  }

  if (syncedLyrics.length === 0) return undefined;
  syncedLyrics.sort((a, b) => a.time - b.time);
  return {
    plainText: syncedLyrics.map((line) => line.text).join('\n'),
    syncedLyrics,
  };
}

function parseYrcWords(source: string) {
  return [...source.matchAll(YRC_WORD_TOKEN)]
    .map((match) => createWord(match[1], match[2], match[3] ?? ''))
    .filter((word): word is NonNullable<typeof word> => word !== undefined);
}

function parseQrcWords(source: string) {
  const matches = [...source.matchAll(QRC_WORD_TOKEN)];
  const words = matches
    .map((match) => createWord(match[2], match[3], match[1] ?? ''))
    .filter((word): word is NonNullable<typeof word> => word !== undefined);
  const lastMatch = matches[matches.length - 1];
  const trailing = lastMatch
    ? decodeXml(source.slice((lastMatch.index ?? 0) + lastMatch[0].length))
    : '';
  if (words.length > 0 && trailing) words[words.length - 1]!.text += trailing;
  return words;
}

function createWord(timeValue: string | undefined, durationValue: string | undefined, rawText: string) {
  const time = Number(timeValue);
  const duration = Number(durationValue);
  const text = decodeXml(rawText);
  return Number.isFinite(time) && Number.isFinite(duration) && text
    ? { time: time / 1000, duration: duration / 1000, text }
    : undefined;
}

/** Parse provider lyrics through AMLL's maintained QRC/YRC/LRC implementations. */
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

  // Provider APIs occasionally return a non-empty karaoke payload that is
  // actually ordinary LRC, malformed XML, or an unsupported variant. Never let
  // that optional payload discard a valid line-synchronised LRC fallback.
  if (parsedWordLyrics?.syncedLyrics?.some((line) => line.words?.length)) {
    return parsedWordLyrics;
  }

  return parseLRCLyrics(lyrics);
}

function extractQrcContent(raw: string): string {
  const lyricContent = raw.match(/LyricContent\s*=\s*["']([\s\S]*?)["']/i)?.[1];
  return decodeXml(lyricContent ?? raw);
}

function detectWordLyricsFormat(raw: string): WordLyricsFormat | undefined {
  if (/LyricContent\s*=/i.test(raw)) return 'qrc';
  const firstPayload = raw.match(/^\[\d+,\d+\](.*)$/m)?.[1]?.trim();
  if (!firstPayload) return undefined;
  return firstPayload.startsWith('(') ? 'yrc' : 'qrc';
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

/** Parse LRC through AMLL; existing callers keep their stable return shape. */
export function parseLRCLyrics(lrc: string): ParsedLrc {
  return fromAmlLines(parseLrc(lrc), lrc, false);
}

function fromAmlLines(lines: LyricLine[], fallbackText: string, includeWordTiming: boolean): ParsedLrc {
  const syncedLyrics = lines
    .filter((line) => line.words.some((word) => word.word.trim()))
    .map((line) => {
      const text = line.words.map((word) => word.word).join('');
      const words = includeWordTiming
        ? line.words
          .filter((word) => word.word && Number.isFinite(word.startTime) && Number.isFinite(word.endTime))
          .map((word) => ({
            time: word.startTime / 1000,
            duration: Math.max(0, (word.endTime - word.startTime) / 1000),
            text: word.word,
          }))
          .filter((word) => word.duration > 0)
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

function plainLyricsText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !LRC_HEADER_TAG.test(line))
    .join('\n');
}

/**
 * @deprecated @dead_code Superseded by `parseLRCLyrics`, which delegates to
 * `@applemusic-like-lyrics/lyric`. Retained temporarily for rollback reference.
 */
export function parseLRCLyricsLegacy(lrc: string): ParsedLrc {
  const wordLyricsFormat = detectWordLyricsFormat(lrc);
  if (wordLyricsFormat) {
    const parsedWords = parseWordLyrics(lrc, wordLyricsFormat);
    if (parsedWords) return parsedWords;
  }

  const lines = lrc.split(/\r?\n/);
  const syncedLyrics: SyncedLyricLine[] = [];
  const plainTextLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Skip LRC header metadata tags ([ti:…], [ar:…], etc.)
    if (LRC_HEADER_TAG.test(trimmedLine)) continue;

    // Extract all timestamps and text from the line
    const matches = [...trimmedLine.matchAll(LRC_TIME_REGEX)];
    const textWithoutTimestamps = trimmedLine.replace(LRC_TIME_REGEX, '').trim();

    // Skip placeholder lines like "//"
    if (textWithoutTimestamps === '//') continue;

    if (matches.length > 0 && textWithoutTimestamps) {
      // Parse each timestamp and add to synced lyrics
      for (const match of matches) {
        const minutes = parseInt(match[1]!, 10);
        const seconds = parseInt(match[2]!, 10);
        // match[3] is seconds in [hh:mm:ss] format, match[4] is milliseconds
        const hoursOrSeconds = match[3];
        const milliseconds = match[4] ? parseInt(match[4].padEnd(3, '0'), 10) : 0;

        let timeInSeconds: number;
        if (hoursOrSeconds) {
          // [hh:mm:ss] format: match[1]=hours, match[2]=minutes, match[3]=seconds
          const hours = minutes;
          const mins = seconds;
          const secs = parseInt(hoursOrSeconds, 10);
          timeInSeconds = hours * 3600 + mins * 60 + secs;
        } else {
          // [mm:ss.xx] or [mm:ss] format
          timeInSeconds = minutes * 60 + seconds + milliseconds / 1000;
        }

        syncedLyrics.push({
          time: timeInSeconds,
          text: textWithoutTimestamps,
        });
      }
      plainTextLines.push(trimmedLine); // Keep original line with timestamps
    } else if (textWithoutTimestamps) {
      // Line without timestamp, just add to plain text
      plainTextLines.push(trimmedLine);
    }
  }

  // Sort synced lyrics by time
  syncedLyrics.sort((a, b) => a.time - b.time);

  return {
    plainText: plainTextLines.join('\n'),
    syncedLyrics: syncedLyrics.length > 0 ? syncedLyrics : undefined,
  };
}
