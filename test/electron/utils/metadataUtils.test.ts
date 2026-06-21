// @vitest-environment node
import { describe, it, expect } from 'vitest';

// electron must be mocked before importing the module under test
vi.mock('electron', () => ({
  app: {
    getPath: () => '/mock/userData',
    isPackaged: false,
  },
}));

import {
  escapeFfmetadataValue,
  buildFfmetadataContent,
  createVorbisComment,
  createPictureBlock,
} from '@/electron/utils/metadataUtils';

// ========== escapeFfmetadataValue ==========
describe('escapeFfmetadataValue', () => {
  it('should escape backslashes', () => {
    expect(escapeFfmetadataValue('a\\b')).toBe('a\\\\b');
  });

  it('should escape equals signs', () => {
    expect(escapeFfmetadataValue('key=value')).toBe('key\\=value');
  });

  it('should escape semicolons', () => {
    expect(escapeFfmetadataValue('a;b')).toBe('a\\;b');
  });

  it('should escape hash symbols', () => {
    expect(escapeFfmetadataValue('#comment')).toBe('\\#comment');
  });

  it('should normalize CRLF to LF', () => {
    expect(escapeFfmetadataValue('line1\r\nline2')).toBe('line1\\\nline2');
  });

  it('should handle multi-line values with continuation', () => {
    const result = escapeFfmetadataValue('line1\nline2');
    expect(result).toBe('line1\\\nline2');
  });

  it('should handle empty string', () => {
    expect(escapeFfmetadataValue('')).toBe('');
  });

  it('should escape all special characters', () => {
    const result = escapeFfmetadataValue('a\\b=c;d#e\nf');
    expect(result).toBe('a\\\\b\\=c\\;d\\#e\\\nf');
  });
});

// ========== buildFfmetadataContent ==========
describe('buildFfmetadataContent', () => {
  it('should build header with all fields', () => {
    const result = buildFfmetadataContent({
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      lyrics: 'line1\nline2',
    });
    expect(result).toContain(';FFMETADATA1');
    expect(result).toContain('TITLE=Song');
    expect(result).toContain('ARTIST=Artist');
    expect(result).toContain('ALBUM=Album');
    expect(result).toContain('LYRICS=');
    expect(result).toContain('UNSYNCEDLYRICS=');
    expect(result).toContain('LYRIC=');
    expect(result.endsWith('\n')).toBe(true);
  });

  it('should omit missing fields', () => {
    const result = buildFfmetadataContent({ title: 'Only Title' });
    expect(result).toContain('TITLE=Only Title');
    expect(result).not.toContain('ARTIST');
    expect(result).not.toContain('ALBUM');
    expect(result).not.toContain('LYRICS');
  });

  it('should produce just the header for empty metadata', () => {
    const result = buildFfmetadataContent({});
    expect(result).toBe(';FFMETADATA1\n');
  });

  it('should escape special characters in values', () => {
    const result = buildFfmetadataContent({ title: 'Val=ue;With#Special\\Chars' });
    expect(result).toContain('TITLE=Val\\=ue\\;With\\#Special\\\\Chars');
  });

  it('should handle multiline lyrics with escape', () => {
    const result = buildFfmetadataContent({ lyrics: 'line1\nline2' });
    expect(result).toContain('line1');
    expect(result).toContain('line2');
    // The newline should be escaped within the value
    expect(result).toContain('line1\\\nline2');
  });
});

// ========== createVorbisComment ==========
describe('createVorbisComment', () => {
  it('should produce a Buffer with block type 4', () => {
    const result = createVorbisComment(['TITLE=Test']);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result[0]).toBe(4); // block type 4 = VORBIS_COMMENT
  });

  it('should include vendor string "LyricsAdapter"', () => {
    const result = createVorbisComment([]);
    const vendorLen = result.readUInt32LE(4);
    const vendorStr = result.toString('utf-8', 8, 8 + vendorLen);
    expect(vendorStr).toBe('LyricsAdapter');
  });

  it('should encode multiple comments', () => {
    const result = createVorbisComment(['TITLE=Title', 'ARTIST=Artist']);
    // Block header (4) + vendorLen (4) + vendorStr + count (4) + 2×(len(4)+data)
    expect(result.length).toBeGreaterThan(40);
  });

  it('should handle empty comments list', () => {
    const result = createVorbisComment([]);
    expect(result[0]).toBe(4);
    // Header(4) + vendorLen(4) + "LyricsAdapter"(12) + count(4) = 24 bytes
    expect(result.length).toBeGreaterThanOrEqual(24);
  });

  it('should produce valid UTF-8 encoded comments', () => {
    const result = createVorbisComment(['TITLE=测试']);
    expect(result.toString('utf-8')).toContain('测试');
  });
});

// ========== createPictureBlock ==========
describe('createPictureBlock', () => {
  it('should produce a Buffer with block type 6', () => {
    const img = Buffer.from('fake-image-data');
    const result = createPictureBlock(img);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result[0]).toBe(6); // block type 6 = PICTURE
  });

  it('should embed the mime type as image/jpeg', () => {
    const img = Buffer.from('data');
    const result = createPictureBlock(img);
    expect(result.toString('utf-8')).toContain('image/jpeg');
  });

  it('should contain the image data at the end', () => {
    const img = Buffer.from('my-image-bytes');
    const result = createPictureBlock(img);
    expect(result.toString('utf-8')).toContain('my-image-bytes');
  });

  it('should handle empty image buffer', () => {
    const result = createPictureBlock(Buffer.alloc(0));
    expect(result[0]).toBe(6);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should produce consistent structure', () => {
    const img = Buffer.from('abc');
    const result = createPictureBlock(img);
    // Block header (4) + pictureType(4) + mimeLen(4) + "image/jpeg"(10) + descLen(4) + width(4) + height(4) + depth(4) + colors(4) + picDataLen(4) + imageData(3)
    expect(result.length).toBe(4 + 4 + 4 + 10 + 4 + 4 + 4 + 4 + 4 + 4 + 3);
  });
});
