import { describe, expect, it } from 'vitest';
import { onlineSongToTrack } from '@/domain/trackFactory';
import type { OnlineSong, OnlineSource } from '@/services/onlineMusicProvider';

function makeSong(overrides: Partial<OnlineSong> & { songmid: string }): OnlineSong {
  return {
    songname: 'Test Song',
    singer: [{ name: 'Artist One' }, { name: 'Artist Two' }],
    albumname: 'Test Album',
    interval: 240,
    coverUrl: 'https://example.com/cover.jpg',
    ...overrides,
  };
}

describe('onlineSongToTrack', () => {
  it('converts a QQ Music song to a Track', () => {
    const song = makeSong({ songmid: 'qq123', songname: 'Hello' });
    const track = onlineSongToTrack(song, 'qq');

    expect(track.id).toBe('online-qq-qq123');
    expect(track.title).toBe('Hello');
    expect(track.artist).toBe('Artist One & Artist Two');
    expect(track.album).toBe('Test Album');
    expect(track.duration).toBe(240);
    expect(track.coverUrl).toBe('https://example.com/cover.jpg');
    expect(track.audioUrl).toBe('');
    expect(track.source).toBe('qq');
    expect(track.songmid).toBe('qq123');
  });

  it('converts a NetEase song to a Track with different source', () => {
    const song = makeSong({ songmid: 'ne456' });
    const track = onlineSongToTrack(song, 'netease');

    expect(track.id).toBe('online-netease-ne456');
    expect(track.source).toBe('netease');
  });

  it('falls back artist to Unknown when singer is absent', () => {
    const song = makeSong({ songmid: 's1', singer: [] });
    const track = onlineSongToTrack(song, 'qq');

    expect(track.artist).toBe('Unknown Artist');
  });

  it('falls back artist to Unknown when singer is undefined', () => {
    const song = makeSong({ songmid: 's1', singer: undefined as unknown as { name: string }[] });
    const track = onlineSongToTrack(song, 'qq');

    expect(track.artist).toBe('Unknown Artist');
  });

  it('falls back album to Unknown Album when albumname is absent', () => {
    const song = makeSong({ songmid: 's1', albumname: undefined });
    const track = onlineSongToTrack(song, 'qq');

    expect(track.album).toBe('Unknown Album');
  });

  it('defaults duration to 0 when interval is undefined', () => {
    const song = makeSong({ songmid: 's1', interval: undefined });
    const track = onlineSongToTrack(song, 'qq');

    expect(track.duration).toBe(0);
  });

  it('handles missing coverUrl gracefully', () => {
    const song = makeSong({ songmid: 's1', coverUrl: undefined });
    const track = onlineSongToTrack(song, 'qq');

    expect(track.coverUrl).toBeUndefined();
  });

  it('joins multiple singer names with ampersand', () => {
    const song = makeSong({
      songmid: 's1',
      singer: [
        { name: 'A' },
        { name: 'B' },
        { name: 'C' },
      ],
    });
    const track = onlineSongToTrack(song, 'qq');

    expect(track.artist).toBe('A & B & C');
  });
});
