/**
 * Editing support for word-timed (QRC/YRC) lyrics. Users edit the timed lyric
 * body directly; QRC keeps its original XML envelope so re-saving never
 * changes anything but `LyricContent`.
 */
import type { SyncedLyricLine } from '../types';
import { extractQrcContent, parseLyrics, type WordLyricsFormat } from './lrcParser';

const QRC_LYRIC_CONTENT = /(LyricContent\s*=\s*")[\s\S]*?("\s*\/>)/i;

export type EditedWordLyricsResult =
  | {
    ok: true;
    /** Payload to persist: QRC XML or YRC text. */
    wordLyrics: string;
    /** Plain line text, the same shape parsed file/provider lyrics use. */
    lyrics: string;
    syncedLyrics: SyncedLyricLine[];
  }
  | { ok: false };

/** The text shown in the editor for a stored QRC/YRC payload. */
export function editableWordLyricsText(wordLyrics: string, format: WordLyricsFormat): string {
  return format === 'qrc' ? extractQrcContent(wordLyrics) : wordLyrics;
}

/**
 * Rebuild the stored payload from edited text. Fails when the text no longer
 * yields word timing, so a save can never silently downgrade karaoke lyrics.
 */
export function applyEditedWordLyrics(
  text: string,
  format: WordLyricsFormat,
  originalWordLyrics?: string,
): EditedWordLyricsResult {
  const wordLyrics = format === 'qrc' ? wrapQrcContent(text, originalWordLyrics) : text;
  const parsed = parseLyrics('', wordLyrics, format);
  const syncedLyrics = parsed.syncedLyrics;
  if (!syncedLyrics?.some(line => line.words?.length)) return { ok: false };
  return { ok: true, wordLyrics, lyrics: parsed.plainText, syncedLyrics };
}

function wrapQrcContent(text: string, original: string | undefined): string {
  const encoded = encodeXmlAttribute(text);
  if (original && QRC_LYRIC_CONTENT.test(original)) {
    // A replacer function keeps `$` sequences in lyrics literal.
    return original.replace(QRC_LYRIC_CONTENT, (_match, open: string, close: string) => open + encoded + close);
  }
  return '<?xml version="1.0" encoding="utf-8"?>\n<QrcInfos>\n'
    + '<QrcHeadInfo SaveTime="0" Version="100"/>\n<LyricInfo LyricCount="1">\n'
    + `<Lyric_1 LyricType="1" LyricContent="${encoded}"/>\n</LyricInfo>\n</QrcInfos>`;
}

function encodeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
