// @vitest-environment node
import { describe, it, expect } from 'vitest';

/**
 * Helper: build a synchsafe integer (7 bits per byte, used in ID3v2 sizes).
 */
function toSynchsafe(value: number): number {
  let result = 0;
  for (let i = 0; i < 4; i++) {
    result = (result << 8) | ((value >> ((3 - i) * 7)) & 0x7F);
  }
  return result >>> 0;
}

/**
 * Build an ID3v2.3 frame: frameId(4) + size(4) + flags(2) + data.
 * ID3v2.3 uses non-synchsafe frame sizes.
 */
function buildID3v2Frame(frameId: string, data: Buffer): Buffer {
  const header = Buffer.alloc(10);
  header.write(frameId, 0, 4, 'ascii');
  header.writeUInt32BE(data.length, 4);  // v2.3: non-synchsafe
  // flags (2 bytes, zeros)
  return Buffer.concat([header, data]);
}

/**
 * Encode text as ISO-8859-1 ID3v2 text frame payload: encoding byte(0x00) + text.
 */
function encodeTextFramePayload(text: string): Buffer {
  const textBuf = Buffer.from(text, 'latin1');
  return Buffer.concat([Buffer.from([0x00]), textBuf]);
}

/**
 * Encode USLT frame payload: encoding(1) + lang(3) + null descriptor + text.
 */
function encodeUSLTPayload(text: string): Buffer {
  const lang = Buffer.from('eng', 'ascii');
  const textBuf = Buffer.from(text, 'utf-8');
  return Buffer.concat([
    Buffer.from([0x03]),        // UTF-8 encoding
    lang,                        // language (3 bytes)
    Buffer.from([0x00]),         // null-terminated content descriptor
    textBuf,                     // lyrics text
  ]);
}

/**
 * Helper: convert a Buffer to a properly sized ArrayBuffer for the parser.
 * The parser uses `buffer.byteLength` on the received ArrayBuffer, so we need
 * a correctly sized view, not the potentially oversized underlying buffer.
 */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

import { parseMetadataFromBuffer } from '../../services/metadataService';

// =====================
// ID3v2 / MP3 tests
// =====================

describe('ID3v2 header parsing', () => {
  it('should decode synchsafe size and find TIT2 frame', () => {
    const frameData = encodeTextFramePayload('TestTitle');
    const frame = buildID3v2Frame('TIT2', frameData);
    const buffer = buildMinimalID3v2([frame]);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.mp3');
    expect(result.title).toBe('TestTitle');
  });

  it('should return empty result for non-ID3v2 data', () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.mp3');
    expect(result.title).toBeUndefined();
    expect(result.artist).toBeUndefined();
  });
});

describe('decodeTextFrame', () => {
  it('should decode ISO-8859-1 text frame', () => {
    const frameData = encodeTextFramePayload('Hello World');
    const frame = buildID3v2Frame('TIT2', frameData);
    const buffer = buildMinimalID3v2([frame]);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.mp3');
    expect(result.title).toBe('Hello World');
  });

  it('should handle empty text gracefully', () => {
    const frameData = Buffer.from([0x00]); // encoding byte + no text
    const frame = buildID3v2Frame('TIT2', frameData);
    const buffer = buildMinimalID3v2([frame]);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.mp3');
    expect(result.title).toBeUndefined();
  });
});

describe('parseID3v2 - basic metadata', () => {
  it('should parse TIT2, TPE1, TALB frames', () => {
    const frames = [
      buildID3v2Frame('TIT2', encodeTextFramePayload('Test Song')),
      buildID3v2Frame('TPE1', encodeTextFramePayload('Test Artist')),
      buildID3v2Frame('TALB', encodeTextFramePayload('Test Album')),
    ];
    const buffer = buildMinimalID3v2(frames);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.mp3');
    expect(result.title).toBe('Test Song');
    expect(result.artist).toBe('Test Artist');
    expect(result.album).toBe('Test Album');
  });

  it('should skip unknown frames and continue parsing', () => {
    const frames = [
      buildID3v2Frame('WXXX', Buffer.from([0x00, 0x00])), // unknown frame
      buildID3v2Frame('TIT2', encodeTextFramePayload('KnownTitle')),
    ];
    const buffer = buildMinimalID3v2(frames);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.mp3');
    expect(result.title).toBe('KnownTitle');
  });

  it('should not parse non-MP3 without ID3 header', () => {
    const buffer = Buffer.from([0xFF, 0xFB, 0x90, 0x00]); // MPEG sync, not ID3
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.mp3');
    expect(result.title).toBeUndefined();
  });

  it('should handle padding (zero bytes) after frames', () => {
    const titleFrame = buildID3v2Frame('TIT2', encodeTextFramePayload('Title'));
    const padding = Buffer.alloc(16, 0);
    // Build manually: header + titleFrame + padding, all included in tag size
    const allFrames = Buffer.concat([titleFrame, padding]);
    const synchsafeSize = toSynchsafe(allFrames.length);
    const id3Header = Buffer.alloc(10);
    id3Header.write('ID3', 0, 3, 'ascii');
    id3Header[3] = 0x03;
    id3Header.writeUInt32BE(synchsafeSize, 6);
    const buffer = Buffer.concat([id3Header, allFrames]);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.mp3');
    expect(result.title).toBe('Title');
  });
});

describe('USLT - Unsynchronized Lyrics', () => {
  it('should parse plain lyrics from USLT frame', () => {
    const lyrics = 'First line\nSecond line\nThird line';
    const frame = buildID3v2Frame('USLT', encodeUSLTPayload(lyrics));
    const buffer = buildMinimalID3v2([frame]);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.mp3');
    expect(result.lyrics).toBeDefined();
    expect(result.lyrics!.length).toBeGreaterThan(0);
  });
});

// =====================
// FLAC tests
// =====================

describe('FLAC metadata parsing', () => {
  it('should detect FLAC signature and not crash on minimal data', () => {
    const buffer = Buffer.from('fLaC');
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.flac');
    expect(result).toBeDefined();
  });

  it('should parse STREAMINFO for duration', () => {
    const buffer = buildMinimalFLAC(44100, 88200); // 2 seconds
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.flac');
    expect(result.duration).toBeCloseTo(2.0, 1);
  });

  it('should parse VORBIS_COMMENT for title/artist/album', () => {
    const buffer = buildFLACWithVorbis(44100, 44100, [
      'TITLE=Flac Song',
      'ARTIST=Flac Artist',
      'ALBUM=Flac Album',
    ]);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.flac');
    expect(result.title).toBe('Flac Song');
    expect(result.artist).toBe('Flac Artist');
    expect(result.album).toBe('Flac Album');
  });

  it('should handle non-FLAC data gracefully', () => {
    const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'test.flac');
    expect(result).toEqual({});
  });
});

// =====================
// parseMetadataFromBuffer
// =====================

describe('parseMetadataFromBuffer dispatch', () => {
  it('should dispatch to MP3 parser for .mp3 extension', () => {
    const frame = buildID3v2Frame('TIT2', encodeTextFramePayload('MP3 Title'));
    const buffer = buildMinimalID3v2([frame]);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'song.mp3');
    expect(result.title).toBe('MP3 Title');
  });

  it('should dispatch to FLAC parser for .flac extension', () => {
    const buffer = buildFLACWithVorbis(48000, 96000, ['TITLE=FLAC Title']);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'song.flac');
    expect(result.title).toBe('FLAC Title');
  });

  it('should handle unknown extension gracefully', () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02]);
    const result = parseMetadataFromBuffer(toArrayBuffer(buffer), 'song.txt');
    expect(result).toEqual({});
  });

  it('should detect truncated cover and set coverNeededRange', () => {
    // Build an APIC frame with data larger than what fits in the ID3v2 tag area.
    // APIC payload ≈ 514 bytes, APIC frame ≈ 524 bytes (10 header + 514 data).
    const largeImageData = Buffer.alloc(500, 0xAB);

    const mimeBuf = Buffer.from('image/jpeg', 'ascii');
    const apicPayload = Buffer.concat([
      Buffer.from([0x00]),       // encoding
      mimeBuf,
      Buffer.from([0x00]),       // null after MIME
      Buffer.from([0x03]),       // picture type (front cover)
      Buffer.from([0x00]),       // null description
      largeImageData,
    ]);

    const apicFrame = buildID3v2Frame('APIC', apicPayload); // ≈ 524 bytes

    // Build a buffer where:
    // - buffer.byteLength >= frameSize (to not trigger early break)
    // - ID3v2 declared tag size < offset + 10 + frameSize (frameAvailable=false)
    const tagDataSize = 60;         // declared tag size (smaller than APIC frame)
    const synchsafeSize = toSynchsafe(tagDataSize);
    const id3Header = Buffer.alloc(10);
    id3Header.write('ID3', 0, 3, 'ascii');
    id3Header[3] = 0x03;
    id3Header.writeUInt32BE(synchsafeSize, 6);

    // Full buffer: ID3 header + complete APIC frame (so frameSize <= buffer.byteLength)
    const fullBuffer = Buffer.concat([id3Header, apicFrame]);

    const result = parseMetadataFromBuffer(toArrayBuffer(fullBuffer), 'test.mp3');
    expect(result.coverNeededRange).toBeDefined();
    expect(result.coverNeededRange!.length).toBeGreaterThan(0);
  });
});

// =====================
// Test helpers - binary data builders
// =====================

/**
 * Build a minimal valid ID3v2.3 tag with given frames (no extended header).
 */
function buildMinimalID3v2(frames: Buffer[]): Buffer {
  const framesBuf = Buffer.concat(frames);
  const tagSize = toSynchsafe(framesBuf.length);

  const header = Buffer.alloc(10);
  header.write('ID3', 0, 3, 'ascii');
  header[3] = 0x03;          // major version 2.3
  header[4] = 0x00;          // revision
  header[5] = 0x00;          // flags (none)
  header.writeUInt32BE(tagSize, 6); // synchsafe size

  return Buffer.concat([header, framesBuf]);
}

/**
 * Build a FLAC STREAMINFO block (34 bytes) with the given sample rate and
 * total samples count, then wrap in a metadata block header (block type 0).
 */
function buildStreamInfoBlock(sampleRate: number, totalSamples: number): Buffer {
  const buf = Buffer.alloc(34);
  buf.fill(0);

  // Minimum block size (16 bits) - use 4096
  buf.writeUInt16BE(4096, 0);
  // Maximum block size (16 bits) - use 4096
  buf.writeUInt16BE(4096, 2);

  // Sample rate (20 bits) at byte offset 10:
  //   byte10[7:0] = sampleRate[7:0]
  //   byte11[7:4] = sampleRate[11:8]
  //   byte11[3:0] = (other - audio channels etc)
  //   byte12[7:4] = sampleRate[15:12]
  // Reader does: (sampleRate >> 4) as Uint16 at offset 10, OR with (byte12 >> 4)
  // So sampleRate = ((bytes10-11 as Uint16) << 4) | (byte12 >> 4)
  // Reverse: ((sampleRate >> 4) & 0xFFFF) -> bytes 10-11, (sampleRate & 0x0F) << 4 -> byte12 high nibble

  const srShifted = sampleRate >> 4;     // drops the lowest 4 bits
  buf.writeUInt16BE(srShifted & 0xFFFF, 10);
  buf[12] = (sampleRate & 0x0F) << 4;    // lowest 4 bits go to byte12 high nibble

  // Total samples (36 bits) at byte 13-17
  // Reader: byte13 low nibble = totalSamples >> 32, bytes 14-17 = totalSamples low 32
  // NOTE: JS >>32 === >>0 (mod 32), so use Math.floor for >32-bit shift
  const totalHigh = Math.floor(totalSamples / 0x100000000) & 0x0F;
  buf[13] = ((buf[13]!) & 0xF0) | totalHigh;
  buf.writeUInt32BE(totalSamples >>> 0, 14);

  return buf;
}

/**
 * Build a VORBIS_COMMENT block data (without block header).
 * Format: vendorLen(4LE) + vendorString + commentCount(4LE) + [len(4LE) + string]*N
 */
function buildVorbisData(comments: string[]): Buffer {
  const vendorStr = Buffer.from('reference libFLAC', 'utf-8');
  const vendorLen = Buffer.alloc(4);
  vendorLen.writeUInt32LE(vendorStr.length, 0);

  const commentCount = Buffer.alloc(4);
  commentCount.writeUInt32LE(comments.length, 0);

  const commentBuffers = comments.map(c => {
    const cBuf = Buffer.from(c, 'utf-8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(cBuf.length, 0);
    return Buffer.concat([lenBuf, cBuf]);
  });

  return Buffer.concat([vendorLen, vendorStr, commentCount, ...commentBuffers]);
}

/**
 * Build a minimal FLAC buffer with only a STREAMINFO metadata block.
 */
function buildMinimalFLAC(sampleRate: number, totalSamples: number): Buffer {
  const streamInfo = buildStreamInfoBlock(sampleRate, totalSamples);

  // Metadata block header: type=0 (STREAMINFO), not-last
  const header = Buffer.alloc(4);
  header[0] = 0x80;          // block type 0 + IS_LAST (to stop parsing)
  header.writeUIntBE(34, 1, 3); // block size in 3 bytes big-endian

  return Buffer.concat([
    Buffer.from('fLaC', 'ascii'),
    header,
    streamInfo,
  ]);
}

/**
 * Build a FLAC buffer with STREAMINFO + VORBIS_COMMENT blocks.
 */
function buildFLACWithVorbis(
  sampleRate: number,
  totalSamples: number,
  comments: string[],
): Buffer {
  const parts: Buffer[] = [];

  // FLAC signature
  parts.push(Buffer.from('fLaC', 'ascii'));

  // STREAMINFO block (type 0, not last)
  const streamInfo = buildStreamInfoBlock(sampleRate, totalSamples);
  const siHeader = Buffer.alloc(4);
  siHeader[0] = 0x00;          // block type 0, not last
  siHeader.writeUIntBE(34, 1, 3); // 3 bytes big-endian
  parts.push(siHeader);
  parts.push(streamInfo);

  // VORBIS_COMMENT block (type 4, last)
  const vorbisData = buildVorbisData(comments);
  const vcHeader = Buffer.alloc(4);
  vcHeader[0] = 0x84;          // block type 4 + IS_LAST (0x80)
  vcHeader.writeUIntBE(vorbisData.length, 1, 3); // 3 bytes big-endian
  parts.push(vcHeader);
  parts.push(vorbisData);

  return Buffer.concat(parts);
}
