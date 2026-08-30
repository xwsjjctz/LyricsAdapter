import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COVER_ARTWORK_URL,
  parseCoverDataUrl,
  sanitizePersistedCoverUrl,
  toCoverThumb,
} from '@/services/coverUrl';

describe('coverUrl helpers', () => {
  it('provides the shared 256px default cover artwork', () => {
    expect(DEFAULT_COVER_ARTWORK_URL).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);

    const encodedSvg = DEFAULT_COVER_ARTWORK_URL.split(',', 2)[1];
    expect(encodedSvg).toBeDefined();
    const svg = decodeURIComponent(encodedSvg!);
    expect(svg).toContain('width="256" height="256"');
    expect(svg).toContain('viewBox="0 0 40 40"');
    expect(svg).toContain('fill="#222"');
    expect(svg).toContain('fill="#666"');
    expect(svg).toContain('>♪</text>');
    expect(toCoverThumb(DEFAULT_COVER_ARTWORK_URL, 128)).toBe(DEFAULT_COVER_ARTWORK_URL);
  });

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
    expect(sanitizePersistedCoverUrl('cover://track.jpg?v=contenthash'))
      .toBe('cover://track.jpg?v=contenthash');
    expect(sanitizePersistedCoverUrl('https://example.com/cover.jpg')).toBe('https://example.com/cover.jpg');
  });

  it('keeps thumbnail behavior for cover protocol URLs', () => {
    expect(toCoverThumb('cover://track.jpg', 128)).toBe('cover://track.jpg?size=128');
    expect(toCoverThumb('cover://track.jpg?v=contenthash', 128))
      .toBe('cover://track.jpg?v=contenthash&size=128');
  });

  it('requests the target size from supported online cover CDNs', () => {
    expect(toCoverThumb('https://p1.music.126.net/key/id.jpg?param=800y800', 128))
      .toBe('https://p1.music.126.net/key/id.jpg?param=128y128');
  });

  it('keeps seeded placeholder artwork while requesting only its display size', () => {
    expect(toCoverThumb('https://picsum.photos/seed/example-track/1000/1000', 128))
      .toBe('https://picsum.photos/seed/example-track/128/128');
  });

  it('snaps QQ CDN cover requests to the only sizes the CDN actually serves', () => {
    // 实测 y.gtimg.cn 只服务 {120,150,180,300,500,800}；其余尺寸（含 128/200/256/
    // 400/512/1024）一律 404，与 Referer / 地区无关。把任意请求向上 snap 到最近可用尺寸，
    // 超过 800 封顶到 800（浏览器缩放显示）。
    // 128 (无效) → 150.
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 128))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R150x150M000album.jpg');
    // 150 → 150（精确命中）.
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 150))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R150x150M000album.jpg');
    // 256 (无效) → 300.
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 256))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg');
    // 300 → 300.
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 300))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg');
    // 512 (无效，FocusMode 大封面用的就是这个尺寸) → 800（向上 snap 到下一个可用档，
    // 不向下取 500，保证图不会小于容器、避免视觉降级）.
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 512))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R800x800M000album.jpg');
    // 500 → 500（精确命中，注意只向上 snap，所以 500 本身不会降到 300）.
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 500))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R500x500M000album.jpg');
    // 800 → 800.
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 800))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R800x800M000album.jpg');
    // 超过 800 封顶到 800（不返回无效的 1024）.
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T002R300x300M000album.jpg', 1024))
      .toBe('https://y.gtimg.cn/music/photo_new/T002R800x800M000album.jpg');
    // 同一 snap 规则适用于 T001 (艺人封面) 变体.
    expect(toCoverThumb('https://y.gtimg.cn/music/photo_new/T001R300x300M000artist.jpg', 128))
      .toBe('https://y.gtimg.cn/music/photo_new/T001R150x150M000artist.jpg');
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
