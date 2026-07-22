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

  it('requests the target size from supported online cover CDNs', () => {
    expect(toCoverThumb('https://p1.music.126.net/key/id.jpg?param=800y800', 128))
      .toBe('https://p1.music.126.net/key/id.jpg?param=128y128');
    expect(toCoverThumb('https://example.qishui.com/image~c5_375x375.jpg', 128))
      .toBe('https://example.qishui.com/image~c5_128x128.jpg');
  });

  it('clamps QQ CDN cover requests to the only supported sizes (300 and 800)', () => {
    // https://y.gtimg.cn/music/photo_new only serves 300 and 800; everything
    // else (128/256/400/500/512/1024) returns 404. Snap any request to one of
    // those two: ≤300 → 300, otherwise → 800.
    // Below 300 → 300.
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 128))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg');
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 256))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg');
    // At 300 → 300.
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 300))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg');
    // Anything larger → 800 (not the requested size, since QQ only serves 300/800).
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 400))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R800x800M000album.jpg');
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 512))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R800x800M000album.jpg');
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 800))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R800x800M000album.jpg');
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 1024))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R800x800M000album.jpg');
    // Same snap applies to the T001 (artist) variant.
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T001R300x300M000artist.jpg', 128))
      .toBe('https://y.gtimg.cn/music/photo_new/T001R300x300M000artist.jpg');
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T001R300x300M000artist.jpg', 512))
      .toBe('https://y.gtimg.cn/music/photo_new/T001R800x800M000artist.jpg');
  });

  it('leaves unknown remote and transient URLs unchanged', () => {
    expect(toCoverThumb('https://example.com/cover.jpg', 128)).toBe('https://example.com/cover.jpg');
    expect(toCoverThumb('blob:cover', 128)).toBe('blob:cover');
  });

  it('does not normalize unknown signed remote URLs', () => {
    const signed = 'https://example.com:443/art/../cover.jpg?token=a%2Fb&expires=123';
    expect(toCoverThumb(signed, 256)).toBe(signed);
  });
});
