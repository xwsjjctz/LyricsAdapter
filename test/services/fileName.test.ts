import { describe, expect, it } from 'vitest';
import {
  buildSafeMusicFileName,
  joinDownloadPath,
  sanitizeFileExtension,
  sanitizeFileNamePart,
} from '@/services/fileName';

describe('sanitizeFileNamePart', () => {
  it('removes path separators, traversal markers, reserved characters, and control characters', () => {
    const result = sanitizeFileNamePart(` ../A/B\\\\C: D?\u0001 `);

    expect(result).toBe('A B C D');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\\\');
    expect(result).not.toContain('..');
  });

  it('uses a sanitized fallback when the input has no usable characters', () => {
    expect(sanitizeFileNamePart('////', 'Unknown Artist')).toBe('Unknown Artist');
  });

  it('prefixes Windows reserved device names', () => {
    expect(sanitizeFileNamePart('CON')).toBe('_CON');
    expect(sanitizeFileNamePart('lpt1')).toBe('_lpt1');
  });
});

describe('sanitizeFileExtension', () => {
  it('normalizes safe extensions', () => {
    expect(sanitizeFileExtension('.MP3')).toBe('mp3');
  });

  it('rejects unsafe extensions', () => {
    expect(() => sanitizeFileExtension('../mp3')).toThrow('Invalid file extension');
  });
});

describe('buildSafeMusicFileName', () => {
  it('builds a single safe file name for online music downloads and WebDAV paths', () => {
    const fileName = buildSafeMusicFileName('A/B & ..\\\\C', '../Song:Name?', 'flac');

    expect(fileName).toBe('A B & . C - Song Name.flac');
    expect(fileName).not.toMatch(/[\\\\/]/);
    expect(fileName).not.toContain('..');
  });
});

describe('joinDownloadPath', () => {
  it('joins sanitized file names to download directories without duplicate separators', () => {
    expect(joinDownloadPath('/Users/me/Music', 'safe.mp3')).toBe('/Users/me/Music/safe.mp3');
    expect(joinDownloadPath('/Users/me/Music/', 'safe.mp3')).toBe('/Users/me/Music/safe.mp3');
  });
});
