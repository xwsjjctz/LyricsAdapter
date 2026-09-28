import { describe, expect, it } from 'vitest';
import { searchTracks, trackMatchesSearch } from '@/services/trackSearch';
import type { Track } from '@/types';

function track(id: string, fields: Partial<Track> = {}): Track {
  return { id, title: id, artist: 'Artist', album: 'Album', duration: 1, audioUrl: '', ...fields };
}

describe('trackMatchesSearch', () => {
  it('matches title, artist and album case- and accent-insensitively', () => {
    const song = track('a', { title: 'Café Society', artist: '林俊杰', album: 'JJ陆' });
    expect(trackMatchesSearch(song, 'cafe')).toBe(true);
    expect(trackMatchesSearch(song, '林俊')).toBe(true);
    expect(trackMatchesSearch(song, 'jj陆')).toBe(true);
  });

  it('matches Chinese text by pinyin initials', () => {
    expect(trackMatchesSearch(track('b', { title: '醉赤壁' }), 'zcb')).toBe(true);
  });

  it('never matches a blank query', () => {
    expect(trackMatchesSearch(track('c'), '   ')).toBe(false);
  });
});

describe('searchTracks', () => {
  const tracks = [track('x1', { title: 'Hello' }), track('x2', { title: 'World' }), track('x3', { title: 'Hello again' })];

  it('returns every match with its total when no limit is given', () => {
    expect(searchTracks(tracks, 'hello')).toEqual({ items: [tracks[0], tracks[2]], total: 2 });
  });

  it('caps the returned items but still reports the full total', () => {
    expect(searchTracks(tracks, 'hello', 1)).toEqual({ items: [tracks[0]], total: 2 });
  });
});
