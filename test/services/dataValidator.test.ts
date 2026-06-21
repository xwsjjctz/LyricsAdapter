import { describe, it, expect } from 'vitest';
import {
  validateMetadata,
  validateMetadataMap,
  validateSongId,
} from '@/services/dataValidator';

// ========== validateSongId ==========
describe('validateSongId', () => {
  it('should return the id for valid strings', () => {
    expect(validateSongId('abc123')).toBe('abc123');
  });

  it('should return null for non-string input', () => {
    expect(validateSongId(123)).toBeNull();
    expect(validateSongId(null)).toBeNull();
    expect(validateSongId(undefined)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(validateSongId('')).toBeNull();
  });

  it('should return null for strings with null bytes', () => {
    expect(validateSongId('abc\x00def')).toBeNull();
  });

  it('should return null for strings over 1000 characters', () => {
    expect(validateSongId('a'.repeat(1001))).toBeNull();
  });
});

// ========== validateMetadata ==========
describe('validateMetadata', () => {
  const validInput = {
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    duration: 200,
    lyrics: 'Test lyrics',
    fileName: 'test.flac',
    fileSize: 5000,
    lastModified: 1_234_567_890,
  };

  it('should validate a correct metadata object', () => {
    const result = validateMetadata(validInput);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Test Song');
    expect(result!.artist).toBe('Test Artist');
    expect(result!.duration).toBe(200);
  });

  it('should return null for non-object input', () => {
    expect(validateMetadata(null)).toBeNull();
    expect(validateMetadata('string')).toBeNull();
    expect(validateMetadata(123)).toBeNull();
  });

  it('should sanitize by removing null bytes from strings', () => {
    const result = validateMetadata({
      ...validInput,
      title: 'Hello\x00World',
      artist: 'Artist\x00',
    });
    expect(result!.title).toBe('HelloWorld');
    expect(result!.artist).toBe('Artist');
  });

  it('should trim whitespace from string fields', () => {
    const result = validateMetadata({ ...validInput, title: '  padded  ' });
    expect(result!.title).toBe('padded');
  });

  it('should clamp duration to max 24h', () => {
    const result = validateMetadata({ ...validInput, duration: 90_000 });
    expect(result!.duration).toBe(86_400);
  });

  it('should clamp duration to minimum 0', () => {
    const result = validateMetadata({ ...validInput, duration: -100 });
    expect(result!.duration).toBe(0);
  });

  it('should clamp fileSize to max 2GB', () => {
    const result = validateMetadata({ ...validInput, fileSize: 3e10 });
    expect(result!.fileSize).toBe(2_147_483_648);
  });

  it('should default NaN duration to 0', () => {
    const result = validateMetadata({ ...validInput, duration: NaN });
    expect(result!.duration).toBe(0);
  });

  it('should derive title from fileName when title is empty', () => {
    const result = validateMetadata({ ...validInput, title: '' });
    expect(result!.title).toBe('test');
  });

  it('should use "Unknown Title" when both title and fileName are empty', () => {
    const result = validateMetadata({ ...validInput, title: '', fileName: '' });
    expect(result!.title).toBe('Unknown Title');
  });

  it('should fallback fileName to "unknown file" when empty', () => {
    const result = validateMetadata({ ...validInput, fileName: '' });
    expect(result!.fileName).toBe('unknown file');
  });

  it('should sanitize syncedLyrics when present', () => {
    const result = validateMetadata({
      ...validInput,
      syncedLyrics: [
        { time: 1.0, text: 'line1' },
        { time: 5.5, text: 'line2' },
      ],
    });
    expect(result!.syncedLyrics).toHaveLength(2);
    expect(result!.syncedLyrics![0]!.time).toBe(1.0);
    expect(result!.syncedLyrics![0]!.text).toBe('line1');
  });

  it('should filter invalid items from syncedLyrics', () => {
    const result = validateMetadata({
      ...validInput,
      syncedLyrics: [
        { time: 1.0, text: 'valid' },
        null,
        { time: 2.0, text: '' },
      ] as any,
    });
    expect(result!.syncedLyrics).toHaveLength(1);
    expect(result!.syncedLyrics![0]!.text).toBe('valid');
  });

  it('should return undefined syncedLyrics for empty array', () => {
    const result = validateMetadata({
      ...validInput,
      syncedLyrics: [],
    });
    expect(result!.syncedLyrics).toBeUndefined();
  });
});

// ========== validateMetadataMap ==========
describe('validateMetadataMap', () => {
  it('should return empty object for empty input', () => {
    expect(validateMetadataMap({})).toEqual({});
  });

  it('should validate multiple entries', () => {
    const input = {
      s1: { title: 'A', artist: '', album: '', duration: 100, lyrics: '', fileName: 'a.flac', fileSize: 100, lastModified: 0 },
      s2: { title: 'B', artist: '', album: '', duration: 200, lyrics: '', fileName: 'b.flac', fileSize: 200, lastModified: 0 },
    };
    expect(Object.keys(validateMetadataMap(input))).toHaveLength(2);
  });

  it('should skip invalid entries', () => {
    const input: any = {
      good: { title: 'Good', artist: '', album: '', duration: 100, lyrics: '', fileName: 'g.flac', fileSize: 100, lastModified: 0 },
      bad: null,
    };
    const result = validateMetadataMap(input);
    expect(Object.keys(result)).toHaveLength(1);
    expect(result['good']).toBeDefined();
  });

  it('should skip entries with invalid keys', () => {
    const input: any = {
      '': { title: 'Empty key', artist: '', album: '', duration: 100, lyrics: '', fileName: 'a.flac', fileSize: 100, lastModified: 0 },
    };
    expect(Object.keys(validateMetadataMap(input))).toHaveLength(0);
  });
});
