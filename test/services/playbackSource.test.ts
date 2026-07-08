import { describe, expect, it } from 'vitest';
import { buildLocalAudioUrl, buildOnlineStreamUrl } from '@/services/playbackSource';

describe('buildLocalAudioUrl', () => {
  it('builds audio:// URL for a Unix absolute path', () => {
    expect(buildLocalAudioUrl('/music/song.flac')).toBe('audio://localhost/music/song.flac');
  });

  it('handles paths with spaces via encodeURI', () => {
    const url = buildLocalAudioUrl('/music/my song.flac');
    expect(url).toContain(encodeURI(' '));
    expect(url).not.toContain(' ');
  });

  it('normalizes Windows backslashes, keeps drive colon as-is', () => {
    const url = buildLocalAudioUrl('C:\\Music\\song.flac');
    // encodeURI does not encode ':', so the drive colon survives
    expect(url).toBe('audio://localhost/C:/Music/song.flac');
    expect(url).not.toContain('\\');
  });

  it('adds leading slash for relative-looking paths', () => {
    expect(buildLocalAudioUrl('music/song.flac')).toBe('audio://localhost/music/song.flac');
  });

  it('encodes special characters', () => {
    const url = buildLocalAudioUrl('/music/曲目.flac');
    expect(url).toBe(`audio://localhost/music/${encodeURI('曲目')}.flac`);
  });
});

describe('buildOnlineStreamUrl', () => {
  it('builds a stream:// URL for QQ Music', () => {
    expect(buildOnlineStreamUrl('qq', 'song123')).toBe('stream://qq/song123?q=320');
  });

  it('builds a stream:// URL for NetEase', () => {
    expect(buildOnlineStreamUrl('netease', 'ne456')).toBe('stream://netease/ne456?q=320');
  });

  it('encodes the songmid', () => {
    expect(buildOnlineStreamUrl('qq', 'a/b?c')).toBe('stream://qq/a%2Fb%3Fc?q=320');
  });
});
