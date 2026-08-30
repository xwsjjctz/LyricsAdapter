import { describe, expect, it } from 'vitest';
import type { Track } from '@/types';
import {
  buildSystemLyricsState,
  findActiveLyricIndex,
} from '@/services/systemLyricsState';

const track: Track = {
  id: 'track-1',
  title: 'Test title',
  artist: 'Test artist',
  album: 'Test album',
  duration: 30,
  audioUrl: 'audio://track-1',
  syncedLyrics: [
    { time: 2, text: ' First line ' },
    { time: 6, text: 'Second line' },
    { time: 10, text: 'Third line' },
  ],
};

describe('systemLyricsState', () => {
  it('finds the active line with a bounded binary search', () => {
    const lines = track.syncedLyrics!;
    expect(findActiveLyricIndex(lines, 0)).toBe(-1);
    expect(findActiveLyricIndex(lines, 2)).toBe(0);
    expect(findActiveLyricIndex(lines, 9.9)).toBe(1);
    expect(findActiveLyricIndex(lines, 99)).toBe(2);
    expect(findActiveLyricIndex(lines, Number.NaN)).toBe(-1);
  });

  it('publishes the current and next line', () => {
    expect(buildSystemLyricsState(track, 6.5, true)).toEqual({
      trackId: 'track-1',
      title: 'Test title',
      artist: 'Test artist',
      line: 'Second line',
      nextLine: 'Third line',
      isPlaying: true,
    });
  });

  it('uses the title before timed lyrics begin and clears without a track', () => {
    expect(buildSystemLyricsState(track, 0, false)).toMatchObject({
      line: 'Test title',
      nextLine: 'First line',
      isPlaying: false,
    });
    expect(buildSystemLyricsState(null, 0, false)).toEqual({
      trackId: null,
      title: '',
      artist: '',
      line: '',
      nextLine: '',
      isPlaying: false,
    });
  });

  it('bounds supplementary Unicode text by UTF-16 length for the IPC schema', () => {
    const unicodeTrack: Track = {
      ...track,
      id: '🎵'.repeat(3_000),
      title: '🎵'.repeat(600),
      artist: '🎵'.repeat(600),
      syncedLyrics: [
        { time: 0, text: '🎵'.repeat(3_000) },
        { time: 1, text: '🎶'.repeat(3_000) },
      ],
    };

    const state = buildSystemLyricsState(unicodeTrack, 0, true);
    expect(state.trackId).toHaveLength(4096);
    expect(state.title).toHaveLength(512);
    expect(state.artist).toHaveLength(512);
    expect(state.line).toHaveLength(4096);
    expect(state.nextLine).toHaveLength(4096);
    expect(state.trackId?.endsWith('🎵')).toBe(true);
    expect(state.title.endsWith('🎵')).toBe(true);
  });
});
