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
 *
 * A music-tag-native save removes the FLAC fields, so metadata writes take a
 * snapshotWordLyrics before saving and restoreWordLyrics after.
 */
import fs from 'fs';
import path from 'path';
import NodeID3 from 'node-id3';
import { readVorbisFields, readVorbisFieldsAsync, writeVorbisField } from './flacVorbisWriter';
import { logger } from '../../logger';

export type WordLyricsFormat = 'qrc' | 'yrc';

/** Every word-lyrics payload stored in a file, by format. */
export type StoredWordLyrics = Partial<Record<WordLyricsFormat, string>>;

const WORD_LYRICS_FORMATS: readonly WordLyricsFormat[] = ['qrc', 'yrc'];

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
    const fields = readVorbisFields(filePath, WORD_LYRICS_FORMATS.map(fieldName));
    if (fields['QRC']) return { wordLyrics: fields['QRC'], wordLyricsFormat: 'qrc' };
    if (fields['YRC']) return { wordLyrics: fields['YRC'], wordLyricsFormat: 'yrc' };
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
 * Async variant of {@link readWordLyrics} for bulk imports: reads only the
 * FLAC VORBIS_COMMENT block or MP3 ID3v2 header without blocking the main
 * process event loop or loading audio frames into memory.
 */
export async function readWordLyricsAsync(filePath: string): Promise<{
  wordLyrics?: string;
  wordLyricsFormat?: WordLyricsFormat;
}> {
  const ext = extOf(filePath);
  if (ext === '.flac') {
    const fields = await readVorbisFieldsAsync(filePath, WORD_LYRICS_FORMATS.map(fieldName));
    if (fields['QRC']) return { wordLyrics: fields['QRC'], wordLyricsFormat: 'qrc' };
    if (fields['YRC']) return { wordLyrics: fields['YRC'], wordLyricsFormat: 'yrc' };
    return {};
  }
  if (ext === '.mp3') {
    const udt = await readMp3UserDefinedTextAsync(filePath);
    const qrc = udt['QRC'];
    if (qrc) return { wordLyrics: qrc, wordLyricsFormat: 'qrc' };
    const yrc = udt['YRC'];
    if (yrc) return { wordLyrics: yrc, wordLyricsFormat: 'yrc' };
    return {};
  }
  return {};
}

/** Both payloads as stored: readWordLyrics picks one, but a save must keep both. */
export function snapshotWordLyrics(filePath: string): StoredWordLyrics {
  const ext = extOf(filePath);
  const fields: Record<string, string> = ext === '.flac'
    ? readVorbisFields(filePath, WORD_LYRICS_FORMATS.map(fieldName))
    : ext === '.mp3' ? readMp3UserDefinedText(filePath) : {};
  const stored: StoredWordLyrics = {};
  for (const format of WORD_LYRICS_FORMATS) {
    const value = fields[fieldName(format)];
    if (value) stored[format] = value;
  }
  return stored;
}

/**
 * Write back the stored payloads a metadata save removed, except `replaced`,
 * which the caller writes itself. music-tag-native saves through lofty's
 * generic tag, which for FLAC drops every Vorbis comment lofty has no key
 * for, QRC/YRC included. MP3 keeps its TXXX frames, so nothing is rewritten.
 */
export function restoreWordLyrics(filePath: string, stored: StoredWordLyrics, replaced?: WordLyricsFormat): void {
  const present = snapshotWordLyrics(filePath);
  for (const format of WORD_LYRICS_FORMATS) {
    const value = stored[format];
    if (format !== replaced && value && !present[format]) {
      writeWordLyrics(filePath, value, format);
    }
  }
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

const MAX_ID3V2_TAG_BYTES = 64 * 1024 * 1024;

function extractUserDefinedTextMap(tags: NodeID3.Tags | null | undefined): Record<string, string> {
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
}

/** Read all TXXX frames as a { description: value } map (last write wins). */
function readMp3UserDefinedText(filePath: string): Record<string, string> {
  try {
    return extractUserDefinedTextMap(NodeID3.read(filePath));
  } catch (e) {
    logger.warn('[WordLyrics] node-id3 read failed:', e);
    return {};
  }
}

/** Read only the ID3v2 header region asynchronously, then parse TXXX frames via node-id3. */
async function readMp3UserDefinedTextAsync(filePath: string): Promise<Record<string, string>> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const header = Buffer.allocUnsafe(10);
    const headerRead = await handle.read(header, 0, 10, 0);
    if (
      headerRead.bytesRead < 10
      || header[0] !== 0x49 // 'I'
      || header[1] !== 0x44 // 'D'
      || header[2] !== 0x33 // '3'
    ) {
      return {};
    }

    const tagSize =
      ((header[6]! & 0x7f) << 21)
      | ((header[7]! & 0x7f) << 14)
      | ((header[8]! & 0x7f) << 7)
      | (header[9]! & 0x7f);
    const hasFooter = (header[5]! & 0x10) !== 0;
    const totalSize = 10 + tagSize + (hasFooter ? 10 : 0);
    if (totalSize <= 10 || totalSize > MAX_ID3V2_TAG_BYTES) {
      return {};
    }

    const tagBuffer = Buffer.allocUnsafe(totalSize);
    header.copy(tagBuffer, 0, 0, 10);
    const bodySize = totalSize - 10;
    let bytesReadTotal = 0;
    while (bytesReadTotal < bodySize) {
      const { bytesRead } = await handle.read(
        tagBuffer,
        10 + bytesReadTotal,
        bodySize - bytesReadTotal,
        10 + bytesReadTotal,
      );
      if (bytesRead === 0) break;
      bytesReadTotal += bytesRead;
    }

    const slice = bytesReadTotal === bodySize ? tagBuffer : tagBuffer.subarray(0, 10 + bytesReadTotal);
    return extractUserDefinedTextMap(NodeID3.read(slice));
  } catch (e) {
    logger.warn('[WordLyrics] async node-id3 read failed:', e);
    return {};
  } finally {
    await handle?.close().catch(() => undefined);
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
