import { describe, expect, it } from 'vitest';
import { buildUpNext } from '@/domain/upNext';
import type { Track } from '@/types';

const tracks: Track[] = ['a', 'b', 'c', 'd'].map(id => ({
  id, title: id, artist: 'x', album: 'y', duration: 1, audioUrl: '',
}));

describe('buildUpNext', () => {
  it('lists the following tracks in order and wraps like the player does', () => {
    const result = buildUpNext(tracks, 2, 'order', 10);
    expect(result.current?.id).toBe('c');
    expect(result.upcoming.map(entry => [entry.track.id, entry.index])).toEqual([['d', 3], ['a', 0], ['b', 1]]);
  });

  it('respects the limit', () => {
    expect(buildUpNext(tracks, 0, 'order', 2).upcoming.map(entry => entry.index)).toEqual([1, 2]);
  });

  it('has nothing upcoming for a single-track list', () => {
    expect(buildUpNext(tracks.slice(0, 1), 0, 'order', 10).upcoming).toEqual([]);
  });

  it('does not predict shuffle or repeat-one', () => {
    expect(buildUpNext(tracks, 1, 'shuffle', 10)).toMatchObject({ mode: 'shuffle', upcoming: [] });
    expect(buildUpNext(tracks, 1, 'repeat-one', 10)).toMatchObject({ mode: 'repeat-one', upcoming: [] });
  });

  it('reports no current track for an out-of-range index', () => {
    expect(buildUpNext(tracks, -1, 'order', 10)).toEqual({ current: null, upcoming: [], mode: 'order' });
  });
});
