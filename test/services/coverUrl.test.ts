import { describe, expect, it } from 'vitest';
import {
  coverIdFromUrl,
  parseCoverDataUrl,
  sanitizePersistedCoverUrl,
  toCoverThumb,
} from '@/services/coverUrl';

describe('coverUrl helpers', () => {
  it('parses supported image data URLs', () => {
    expect(parseCoverDataUrl('data:image/png;base64,abc123')).toEqual({
      mime: 'image/png',
      base64: 'abc123',
    });
    expect(parseCoverDataUrl('data:image/jpg;base64,abc123')).toEqual({
      mime: 'image/jpeg',
      base64: 'abc123',
    });
  });

  it('rejects non-image or malformed data URLs', () => {
    expect(parseCoverDataUrl('data:text/plain;base64,abc123')).toBeNull();
    expect(parseCoverDataUrl('not-a-data-url')).toBeNull();
    expect(parseCoverDataUrl(null)).toBeNull();
  });

  it('strips transient cover URLs before persistence', () => {
    expect(sanitizePersistedCoverUrl('blob:cover')).toBe('');
    expect(sanitizePersistedCoverUrl('file:///tmp/cover.jpg')).toBe('');
    expect(sanitizePersistedCoverUrl('data:image/png;base64,abc123')).toBe('');
  });

  it('preserves persistent cover URLs', () => {
    expect(sanitizePersistedCoverUrl('cover://track.jpg')).toBe('cover://track.jpg');
    expect(sanitizePersistedCoverUrl('https://example.com/cover.jpg')).toBe('https://example.com/cover.jpg');
  });

  it('keeps thumbnail behavior for cover protocol URLs', () => {
    expect(toCoverThumb('cover://track.jpg', 128)).toBe('cover://track.jpg?size=128');
  });

  it('extracts cover id stem from cover:// URLs (Bug 2 stale-cover detection)', () => {
    expect(coverIdFromUrl('cover://abc123-foo.jpg')).toBe('abc123-foo');
    // 带 ?size= 查询参数时仍正确提取 stem
    expect(coverIdFromUrl('cover://abc123-foo.jpg?size=128')).toBe('abc123-foo');
    // sha1 兜底产生的纯 hex id（无 '-'）也能正确提取
    expect(coverIdFromUrl('cover://0123456789abcdef.png')).toBe('0123456789abcdef');
  });

  it('returns null for non-cover:// URLs', () => {
    expect(coverIdFromUrl('https://example.com/cover.jpg')).toBeNull();
    expect(coverIdFromUrl('data:image/png;base64,abc')).toBeNull();
    expect(coverIdFromUrl('blob:http://localhost/x')).toBeNull();
    expect(coverIdFromUrl(undefined)).toBeNull();
    expect(coverIdFromUrl('')).toBeNull();
  });
});
