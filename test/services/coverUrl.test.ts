import { describe, expect, it } from 'vitest';
import {
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
});
