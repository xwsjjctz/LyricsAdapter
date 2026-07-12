/**
 * LRC 歌词解析器（全项目唯一真身）。
 *
 * 渲染层主线程（src/services/metadataService.ts）、Web Worker
 *（src/services/workers/metadataWorker.ts）均直接引用本文件。
 *
 * 主进程（electron/services/audioMetadataService.ts）因 vite 分包隔离无法
 * 跨 src/ 引用，保留一份逐字拷贝并标注「与 src/shared/lrcParser.ts 同步」。
 * 修改本文件时务必同步那边，避免再次出现三份实现各自漂移、hh:mm:ss 解析
 * 不一致的回归（见该文件的修正历史）。
 */
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
 * Parse the QRC/YRC karaoke formats used by QQ Music and NetEase Cloud Music.
 * Both formats use millisecond line timestamps followed by timed text tokens.
 * QRC may be returned as XML, whose LyricContent attribute contains the lines.
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

/** Prefer word timings where a provider returned them, otherwise parse LRC. */
export function parseLyrics(
  lyrics: string,
  wordLyrics?: string | null,
  wordLyricsFormat?: WordLyricsFormat | null,
): ParsedLrc {
  if (wordLyrics && wordLyricsFormat) {
    const parsedWords = parseWordLyrics(wordLyrics, wordLyricsFormat);
    if (parsedWords) return parsedWords;
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

/**
 * Parse LRC format lyrics (with timestamps like [00:12.34] or [00:00:00]).
 *
 * 支持同一行多时间戳、[hh:mm:ss] 三段式格式、毫秒补零到三位。
 */
export function parseLRCLyrics(lrc: string): ParsedLrc {
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
