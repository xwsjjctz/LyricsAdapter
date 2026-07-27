/**
 * Word-lyrics (QRC/YRC) custom-tag persistence.
 *
 * QRC and YRC carry per-word karaoke timing that the standard `lyrics` tag
 * (line-level LRC) cannot represent. `music-tag-native` exposes no generic
 * custom-field accessor, so we persist them as format-native user-defined
 * text fields and read them back here:
 *
 *  - FLAC → Vorbis comment fields `QRC` / `YRC` (via flacVorbisWriter).
 *  - MP3  → ID3v2 `TXXX:QRC` / `TXXX:YRC` frames (via node-id3).
 *  - M4A and others → unsupported, silently skipped (online re-fetch still
 *    works for QQ/NetEase tracks with a known `songmid`).
 *
 * The stored payload is the **plaintext** the lyric parser consumes:
 *  - QQ QRC: decrypted `<QrcInfos>` XML (decryptQrc output).
 *  - NetEase YRC: plaintext YRC text.
 * Both round-trip back through `parseLyrics(..., wordLyrics, format)` cleanly.
 */
import fs from 'fs';
import path from 'path';
import NodeID3 from 'node-id3';
import { readVorbisField, writeVorbisField } from './flacVorbisWriter';
import { logger } from '../logger';

export type WordLyricsFormat = 'qrc' | 'yrc';

/** The single field name for a given format, uppercase on disk. */
function fieldName(format: WordLyricsFormat): 'QRC' | 'YRC' {
  return format === 'qrc' ? 'QRC' : 'YRC';
}

function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/**
 * Read whichever word-lyrics payload is embedded in the file, if any.
 * If both QRC and YRC exist, QRC wins (it is the richer QQ format).
 */
export function readWordLyrics(filePath: string): {
  wordLyrics?: string;
  wordLyricsFormat?: WordLyricsFormat;
} {
  const ext = extOf(filePath);
  if (ext === '.flac') {
    const qrc = readVorbisField(filePath, 'QRC');
    if (qrc) return { wordLyrics: qrc, wordLyricsFormat: 'qrc' };
    const yrc = readVorbisField(filePath, 'YRC');
    if (yrc) return { wordLyrics: yrc, wordLyricsFormat: 'yrc' };
    return {};
  }
  if (ext === '.mp3') {
    const udt = readMp3UserDefinedText(filePath);
    const qrc = udt['QRC'];
    if (qrc) return { wordLyrics: qrc, wordLyricsFormat: 'qrc' };
    const yrc = udt['YRC'];
    if (yrc) return { wordLyrics: yrc, wordLyricsFormat: 'yrc' };
    return {};
  }
  return {};
}

/**
 * Write (or remove) a word-lyrics payload. No-op on unsupported formats.
 * `wordLyrics === undefined` removes the field; a string upserts it.
 */
export function writeWordLyrics(
  filePath: string,
  wordLyrics: string | undefined,
  format: WordLyricsFormat | undefined,
): void {
  if (!format) return; // nothing to write without a format
  const ext = extOf(filePath);
  try {
    if (ext === '.flac') {
      writeVorbisField(filePath, fieldName(format), wordLyrics);
      return;
    }
    if (ext === '.mp3') {
      upsertMp3UserDefinedText(filePath, fieldName(format), wordLyrics);
      return;
    }
    logger.debug(`[WordLyrics] Unsupported extension '${ext}', skipping`);
  } catch (e) {
    // Never let word-lyric persistence break the main metadata write that
    // already succeeded upstream. Surface and continue.
    logger.warn(`[WordLyrics] Failed to write ${format} to ${filePath}:`, e);
  }
}

// ── MP3 (node-id3) helpers ────────────────────────────────────────────────

type UDT = { description: string; value: string };

/** Read all TXXX frames as a { description: value } map (last write wins). */
function readMp3UserDefinedText(filePath: string): Record<string, string> {
  try {
    const tags = NodeID3.read(filePath);
    const result: Record<string, string> = {};
    const udt = tags?.userDefinedText;
    if (Array.isArray(udt)) {
      for (const entry of udt) {
        if (entry && entry.description) {
          result[entry.description.toUpperCase()] = entry.value ?? '';
        }
      }
    }
    return result;
  } catch (e) {
    logger.warn('[WordLyrics] node-id3 read failed:', e);
    return {};
  }
}

/**
 * Upsert or remove a single TXXX description, preserving every other TXXX
 * frame. node-id3's `update()` *merges* multiple frames keyed by
 * `updateCompareKey: 'description'` and never drops un-passed entries, so we
 * read the full tag set, rebuild `userDefinedText` ourselves, and `write()`
 * the whole thing back.
 */
function upsertMp3UserDefinedText(
  filePath: string,
  description: 'QRC' | 'YRC',
  value: string | undefined,
): void {
  // Read existing tags as a plain object (excluding `raw`, which is the raw
  // frame dump node-id3 would otherwise re-serialize and could conflict).
  const existing = NodeID3.read(filePath);
  if (!existing) {
    // No tag at all. If we're removing, there's nothing to do; if writing,
    // create a fresh minimal tag.
    if (value === undefined) return;
    const created = NodeID3.create({ userDefinedText: [{ description, value }] });
    fs.writeFileSync(filePath, created);
    return;
  }

  const { raw: _raw, ...tags } = existing;

  // Rebuild userDefinedText: keep every non-target description, then append
  // the target entry only when we have a value to write.
  const kept: UDT[] = [];
  const source = Array.isArray(existing.userDefinedText) ? existing.userDefinedText : [];
  for (const entry of source) {
    if (entry && entry.description && entry.description.toUpperCase() !== description) {
      kept.push({ description: entry.description, value: entry.value ?? '' });
    }
  }
  if (value !== undefined) {
    kept.push({ description, value });
  }
  if (kept.length > 0) {
    tags.userDefinedText = kept;
  } else {
    // `exactOptionalPropertyTypes` forbids assigning undefined; delete instead.
    delete tags.userDefinedText;
  }

  // write() fully replaces the ID3v2 tag, so unrelated frames survive only if
  // they're in `tags`. We read back the full set above, so they do.
  const buffer = NodeID3.write(tags as NodeID3.Tags, filePath);
  if (buffer instanceof Error) {
    throw buffer;
  }
}
