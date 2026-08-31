import { describe, expect, it } from 'vitest';
import type { Track } from '@/types';
import { countGraphemes } from '@/shared/graphemes';
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
  coverUrl: 'cover://track-1.jpg?v=0123456789abcdef',
  audioUrl: 'audio://track-1',
  syncedLyrics: [
    { time: 2, text: ' First line ' },
    { time: 6, text: 'Second line' },
    { time: 10, text: 'Third line' },
  ],
};

const windowLine = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯';
const longLine = `${windowLine}辰`;

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
      coverUrl: 'cover://track-1.jpg?v=0123456789abcdef',
      title: 'Test title',
      artist: 'Test artist',
      line: 'Second line',
      nextLine: 'Third line',
      lineCursor: null,
      isPlaying: true,
    });
  });

  it('keeps lyrics empty before timing begins and clears without a track', () => {
    expect(buildSystemLyricsState(track, 0, false)).toMatchObject({
      line: '',
      nextLine: 'First line',
      isPlaying: false,
    });
    expect(buildSystemLyricsState(null, 0, false)).toEqual({
      trackId: null,
      coverUrl: '',
      title: '',
      artist: '',
      line: '',
      nextLine: '',
      lineCursor: null,
      isPlaying: false,
    });
  });

  it('derives a grapheme cursor from exact QRC/YRC word timing', () => {
    const wordTimedTrack: Track = {
      ...track,
      syncedLyrics: [
        {
          time: 2,
          text: longLine,
          words: [
            { time: 2, duration: 2, text: '一二三四五六' },
            { time: 4, duration: 2, text: '七八九十甲乙' },
            { time: 6, duration: 2, text: '丙丁戊己庚辛' },
            { time: 8, duration: 2, text: '壬癸子丑寅卯辰' },
          ],
        },
        { time: 12, text: 'Next line' },
      ],
    };

    expect(buildSystemLyricsState(wordTimedTrack, 5, true).lineCursor).toBe(9);
    expect(buildSystemLyricsState(wordTimedTrack, 10, true).lineCursor).toBe(24);
  });

  it('holds the completed word during a timing gap and advances at the next word', () => {
    const wordTimedTrack: Track = {
      ...track,
      syncedLyrics: [{
        time: 0,
        text: longLine,
        words: [
          { time: 0, duration: 1, text: longLine.slice(0, 12) },
          { time: 2, duration: 1, text: longLine.slice(12) },
        ],
      }],
    };

    expect(buildSystemLyricsState(wordTimedTrack, 1.5, true).lineCursor).toBe(11);
    expect(buildSystemLyricsState(wordTimedTrack, 2, true).lineCursor).toBe(12);
  });

  it('calculates the cursor against the same whitespace-normalized text that is displayed', () => {
    const rawLine = '一二三四五六    七八九十甲乙\t丙丁戊己庚辛壬癸子丑寅卯';
    const normalizedLine = '一二三四五六 七八九十甲乙 丙丁戊己庚辛壬癸子丑寅卯';
    const whitespaceTrack: Track = {
      ...track,
      syncedLyrics: [{
        time: 0,
        text: rawLine,
        words: [{ time: 0, duration: 2, text: rawLine }],
      }],
    };

    const state = buildSystemLyricsState(whitespaceTrack, 1, true);

    expect(state.line).toBe(normalizedLine);
    expect(state.lineCursor).toBe(Math.floor(countGraphemes(normalizedLine) / 2));
  });

  it('uses line timing for long ordinary LRC lines', () => {
    const lineTimedTrack: Track = {
      ...track,
      syncedLyrics: [
        { time: 2, text: longLine },
        { time: 6, text: 'Next line' },
      ],
    };

    expect(buildSystemLyricsState(lineTimedTrack, 4, true).lineCursor).toBe(12);
  });

  it('uses the track ending to estimate progress for the final LRC line', () => {
    const finalLineTrack: Track = {
      ...track,
      duration: 30,
      syncedLyrics: [{ time: 10, text: longLine }],
    };

    expect(buildSystemLyricsState(finalLineTrack, 20, true).lineCursor).toBe(12);
  });

  it('does not publish a cursor for a 24-grapheme lyric that fits the system surface', () => {
    const shortWordTimedTrack: Track = {
      ...track,
      syncedLyrics: [{
        time: 0,
        text: windowLine,
        words: [{ time: 0, duration: 2, text: windowLine }],
      }],
    };

    expect(buildSystemLyricsState(shortWordTimedTrack, 1, true).lineCursor).toBeNull();
  });

  it('allows only bounded cover and HTTPS artwork URLs', () => {
    expect(buildSystemLyricsState({ ...track, coverUrl: 'https://example.com/cover.jpg' }, 0, true).coverUrl)
      .toBe('https://example.com/cover.jpg');
    for (const coverUrl of [
      'http://example.com/cover.jpg',
      'file:///C:/music/cover.jpg',
      'blob:app://localhost/id',
      'data:image/png;base64,AA==',
      `https://example.com/${'x'.repeat(8192)}`,
    ]) {
      expect(buildSystemLyricsState({ ...track, coverUrl }, 0, true).coverUrl).toBe('');
    }
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

  it('keeps the maximum cursor inside the 4096-character IPC line bound', () => {
    const boundaryLine = 'x'.repeat(4_096);
    const boundaryTrack: Track = {
      ...track,
      syncedLyrics: [{
        time: 0,
        text: boundaryLine,
        words: [{ time: 0, duration: 1, text: boundaryLine }],
      }],
    };

    expect(buildSystemLyricsState(boundaryTrack, 2, true).lineCursor).toBe(4_095);
  });
});
