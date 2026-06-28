import { describe, expect, it } from 'vitest';
import { reorderTracks } from '@/services/libraryReorder';
import type { Track } from '@/types';

function track(id: string): Track {
  return {
    id,
    title: id,
    artist: 'Artist',
    album: 'Album',
    duration: 1,
    audioUrl: '',
  };
}

describe('reorderTracks', () => {
  it('moves a track within the viewed slot order', () => {
    const result = reorderTracks([track('a'), track('b'), track('c')], 0, 0, 3);

    expect(result.changed).toBe(true);
    expect(result.tracks.map(item => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('keeps the current track index attached to the same track id', () => {
    const result = reorderTracks([track('a'), track('b'), track('c')], 1, 0, 3);

    expect(result.tracks.map(item => item.id)).toEqual(['b', 'c', 'a']);
    expect(result.currentTrackIndex).toBe(0);
  });

  it('returns unchanged data for invalid indices', () => {
    const tracks = [track('a'), track('b')];
    const result = reorderTracks(tracks, 0, -1, 1);

    expect(result.changed).toBe(false);
    expect(result.tracks).toBe(tracks);
    expect(result.currentTrackIndex).toBe(0);
  });
});
