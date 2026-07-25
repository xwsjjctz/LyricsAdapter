/**
 * FLAC Vorbis comment field read/rewrite.
 *
 * Why this exists: `music-tag-native` (lofty 0.24) only exposes named
 * properties — it has no generic accessor for arbitrary Vorbis keys, so we
 * cannot persist QRC/YRC word-lyric payloads through it. We rewrite the
 * VORBIS_COMMENT metadata block directly instead.
 *
 * Format reference: https://xiph.org/flac/format.html
 *  - stream begins with `fLaC` (4 bytes)
 *  - STREAMINFO is always block type 0 and must be first
 *  - each metadata block header: 1 byte (bit 7 = is-last-flag, bits 0..6 =
 *    block type) + 3 bytes big-endian length (length of the block *body*,
 *    header excluded)
 *  - type 4 = VORBIS_COMMENT; type 1 = PADDING
 *  - VORBIS_COMMENT body: vendor_length (LE u32) + vendor (UTF-8) +
 *    comment_count (LE u32) + N × (comment_length LE u32 + comment UTF-8),
 *    where each comment is `FIELD=value` (FIELD is case-insensitive ASCII).
 *
 * Audio frames after the metadata block chain are untouched byte-for-byte.
 * STREAMINFO's MD5 checksums the *unencoded audio samples*, not the
 * metadata, so editing the comment block never invalidates it.
 *
 * This writer mirrors the read side in `src/services/metadataService.ts`
 * (`parseVorbisComment`) so written fields round-trip cleanly.
 */
import fs from 'fs';
import { logger } from '../logger';

// ── Block type constants ──────────────────────────────────────────────────
const BLOCK_STREAMINFO = 0;
const BLOCK_PADDING = 1;
const BLOCK_VORBIS_COMMENT = 4;

const FLAC_MAGIC = Buffer.from('fLaC');

/** Field names LyricsAdapter persists word-by-word lyrics under. */
export const WORD_LYRICS_FIELDS = ['QRC', 'YRC'] as const;
export type WordLyricsField = (typeof WORD_LYRICS_FIELDS)[number];

interface ParsedBlock {
  /** Full byte offset of the 4-byte block header in the file buffer. */
  headerOffset: number;
  /** Byte offset of the block body (header + 4). */
  bodyOffset: number;
  /** 7-bit block type (is-last flag stripped). */
  type: number;
  /** Body length in bytes (excludes the 4-byte header). */
  length: number;
  /** Whether this is the last metadata block before audio frames. */
  isLast: boolean;
}

/** Locate every metadata block header up to (and including) the is-last one. */
function parseMetadataBlocks(buf: Buffer): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  let offset = FLAC_MAGIC.length; // skip `fLaC`
  while (offset + 4 <= buf.length) {
    const flagByte = buf[offset]!;
    const type = flagByte & 0x7f;
    const isLast = (flagByte & 0x80) !== 0;
    const length = (buf[offset + 1]! << 16) | (buf[offset + 2]! << 8) | buf[offset + 3]!;
    blocks.push({ headerOffset: offset, bodyOffset: offset + 4, type, length, isLast });
    offset += 4 + length;
    if (isLast) break;
  }
  return blocks;
}

/** Build a metadata block header (4 bytes): is-last flag + type + body length. */
function buildBlockHeader(type: number, bodyLength: number, isLast: boolean): Buffer {
  const header = Buffer.alloc(4);
  header[0] = (type & 0x7f) | (isLast ? 0x80 : 0);
  header[1] = (bodyLength >> 16) & 0xff;
  header[2] = (bodyLength >> 8) & 0xff;
  header[3] = bodyLength & 0xff;
  return header;
}

/** Write a little-endian u32. */
function writeLeU32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

/** Encode a Vorbis comment body (vendor + comments), mirroring parseVorbisComment. */
function encodeVorbisComment(vendor: string, comments: string[]): Buffer {
  const vendorBuf = Buffer.from(vendor, 'utf-8');
  const parts: Buffer[] = [
    writeLeU32(vendorBuf.length),
    vendorBuf,
    writeLeU32(comments.length),
  ];
  for (const comment of comments) {
    const c = Buffer.from(comment, 'utf-8');
    parts.push(writeLeU32(c.length), c);
  }
  return Buffer.concat(parts);
}

/** Decode a VORBIS_COMMENT body into { vendor, comments[] }. */
function decodeVorbisComment(body: Buffer): { vendor: string; comments: string[] } | null {
  try {
    let offset = 0;
    const vendorLen = body.readUInt32LE(offset);
    offset += 4;
    const vendor = body.subarray(offset, offset + vendorLen).toString('utf-8');
    offset += vendorLen;
    const count = body.readUInt32LE(offset);
    offset += 4;
    const comments: string[] = [];
    for (let i = 0; i < count; i++) {
      const len = body.readUInt32LE(offset);
      offset += 4;
      comments.push(body.subarray(offset, offset + len).toString('utf-8'));
      offset += len;
    }
    return { vendor, comments };
  } catch (e) {
    logger.warn('[FlacVorbis] Failed to decode VORBIS_COMMENT:', e);
    return null;
  }
}

/** Pull a case-insensitive FIELD from a `FIELD=value` comment list. */
function getFieldValue(comments: string[], field: string): string | undefined {
  const needle = field.toUpperCase();
  for (const comment of comments) {
    const eq = comment.indexOf('=');
    if (eq > 0 && comment.substring(0, eq).toUpperCase() === needle) {
      return comment.substring(eq + 1);
    }
  }
  return undefined;
}

/**
 * Read a single case-insensitive Vorbis field from a FLAC file.
 * Returns undefined if the file has no VORBIS_COMMENT block or no such field.
 */
export function readVorbisField(filePath: string, field: string): string | undefined {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < FLAC_MAGIC.length || buf.subarray(0, FLAC_MAGIC.length).equals(FLAC_MAGIC) === false) {
      return undefined;
    }
    const blocks = parseMetadataBlocks(buf);
    const vorbis = blocks.find((b) => b.type === BLOCK_VORBIS_COMMENT);
    if (!vorbis) return undefined;
    const body = buf.subarray(vorbis.bodyOffset, vorbis.bodyOffset + vorbis.length);
    const decoded = decodeVorbisComment(body);
    return decoded ? getFieldValue(decoded.comments, field) : undefined;
  } catch (e) {
    logger.warn(`[FlacVorbis] readVorbisField('${field}') failed:`, e);
    return undefined;
  }
}

/**
 * Set or remove a case-insensitive Vorbis field on a FLAC file.
 *
 * - When `value` is undefined → the field is removed entirely.
 * - When `value` is a string → the field is inserted/updated; all existing
 *   entries with the same FIELD (case-insensitive) are dropped first so there
 *   is exactly one entry afterward.
 *
 * The VORBIS_COMMENT block is rewritten in place. If it shrinks the file
 * needs a PADDING block added so the audio frame offsets don't move; if it
 * grows we consume an existing PADDING block or insert a new one. is-last
 * flags are recomputed so exactly one block carries the flag.
 */
export function writeVorbisField(filePath: string, field: string, value: string | undefined): void {
  const buf = fs.readFileSync(filePath);
  if (buf.length < FLAC_MAGIC.length || buf.subarray(0, FLAC_MAGIC.length).equals(FLAC_MAGIC) === false) {
    throw new Error('Not a FLAC stream (missing fLaC magic)');
  }
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from('ID3 '))) {
    // An ID3v2 tag prepended to a FLAC stream. node-id3 owns that region;
    // rewriting here would require shifting it, which is out of scope.
    throw new Error('FLAC stream has a prepended ID3v2 tag; custom Vorbis write unsupported');
  }

  const blocks = parseMetadataBlocks(buf);
  if (blocks.length === 0 || blocks[0]!.type !== BLOCK_STREAMINFO) {
    throw new Error('FLAC stream missing STREAMINFO as the first block');
  }

  const vorbisIndex = blocks.findIndex((b) => b.type === BLOCK_VORBIS_COMMENT);
  let vendor = 'reference libFLAC 1.x'; // sensible default if we have to create one
  let comments: string[] = [];
  if (vorbisIndex >= 0) {
    const v = blocks[vorbisIndex]!;
    const decoded = decodeVorbisComment(buf.subarray(v.bodyOffset, v.bodyOffset + v.length));
    if (decoded) {
      vendor = decoded.vendor;
      comments = decoded.comments;
    }
  }

  // Apply the requested change: drop every matching FIELD, then re-add one.
  const needle = field.toUpperCase();
  comments = comments.filter((c) => {
    const eq = c.indexOf('=');
    return !(eq > 0 && c.substring(0, eq).toUpperCase() === needle);
  });
  if (value !== undefined) {
    comments.push(`${field.toUpperCase()}=${value}`);
  }

  const newBody = encodeVorbisComment(vendor, comments);

  // Rebuild the metadata block chain. When a VORBIS_COMMENT already exists we
  // rewrite it; otherwise we insert a fresh one right after STREAMINFO (the
  // spec requires STREAMINFO first, but VORBIS_COMMENT may follow it).
  const outParts: Buffer[] = [];
  let wroteVorbis = false;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;

    // Emit the original block as-is unless it's the vorbis block we own.
    if (block.type === BLOCK_VORBIS_COMMENT && i === vorbisIndex) {
      // Replace with the rewritten body; is-last flag computed at the end.
      outParts.push(buildBlockHeader(BLOCK_VORBIS_COMMENT, newBody.length, false));
      outParts.push(newBody);
      wroteVorbis = true;
      continue;
    }

    // Drop the existing PADDING; we'll re-emit one (possibly resized) so the
    // total chain length matches and audio offsets stay stable. This keeps the
    // rewrite a single contiguous replace rather than a fragile in-place edit.
    if (block.type === BLOCK_PADDING) {
      continue;
    }

    outParts.push(buildBlockHeader(block.type, block.length, false));
    outParts.push(buf.subarray(block.bodyOffset, block.bodyOffset + block.length));
  }

  if (!wroteVorbis) {
    // No existing VORBIS_COMMENT: splice a new block in right after STREAMINFO
    // (position 1 in outParts = header + body of block 0).
    const header = buildBlockHeader(BLOCK_VORBIS_COMMENT, newBody.length, false);
    const head = outParts.splice(0, 2); // STREAMINFO header + body
    outParts.unshift(header, newBody, ...head);
  }

  // Recompute total metadata size vs. original to size the trailing padding.
  const flacHeader = buf.subarray(0, FLAC_MAGIC.length);
  const originalMetadataEnd = blocks.length > 0
    ? blocks[blocks.length - 1]!.bodyOffset + blocks[blocks.length - 1]!.length
    : FLAC_MAGIC.length;
  const audioStart = originalMetadataEnd;
  const newMetadataLength = Buffer.concat(outParts).length;
  const originalMetadataPayload = audioStart - FLAC_MAGIC.length;

  // Keep at least 8 KB of padding when possible so future small edits don't
  // force an audio-frame shift; never go negative.
  const desiredPadding = Math.max(8192, originalMetadataPayload - newMetadataLength);
  if (desiredPadding > 0) {
    outParts.push(buildBlockHeader(BLOCK_PADDING, desiredPadding, false));
    outParts.push(Buffer.alloc(desiredPadding));
  }

  // Ensure exactly one block carries the is-last flag (the final one).
  fixIsLastFlags(outParts);

  const tail = buf.subarray(audioStart); // untouched audio frames
  const result = Buffer.concat([flacHeader, ...outParts, tail]);

  // Atomic write: build to a temp file then rename, so a crash mid-write can't
  // leave a half-rewritten FLAC.
  const tmp = `${filePath}.vorbis-tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, result, 0, result.length, 0);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

/**
 * Flip the is-last bit on the final metadata block header and clear it on
 * every other header in `parts`. Operates on the header buffers in place.
 *
 * Headers are the 4-byte buffers produced by `buildBlockHeader`; bodies are
 * always larger, so a 4-byte buffer unambiguously identifies a header.
 */
function fixIsLastFlags(parts: Buffer[]): void {
  let lastHeaderIndex = -1;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (Buffer.isBuffer(part) && part.length === 4) {
      part[0] = part[0]! & 0x7f; // clear is-last
      lastHeaderIndex = i;
    }
  }
  if (lastHeaderIndex >= 0) {
    const header = parts[lastHeaderIndex] as Buffer;
    header[0] = header[0]! | 0x80;
  }
}
