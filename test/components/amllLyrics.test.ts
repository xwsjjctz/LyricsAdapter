import { describe, expect, it } from 'vitest';
import { trackToAmlLyricLines } from '@/components/focus-mode/amllLyrics';
import { hasTrackLyrics } from '@/components/focus-mode/focusLyricsTrack';
import type { Track } from '@/types';

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    duration: 10,
    audioUrl: 'blob:test',
    ...overrides,
  };
}

describe('AMLL lyric adapter', () => {
  it('converts line and word timings from seconds to immutable AMLL milliseconds', () => {
    const lines = trackToAmlLyricLines(makeTrack({
      syncedLyrics: [
        {
          time: 1,
          text: '你好',
          words: [
            { time: 1, duration: 0.25, text: '你' },
            { time: 1.25, duration: 0.5, text: '好' },
          ],
        },
        { time: 3, text: '下一行' },
      ],
    }));

    expect(lines[0]).toMatchObject({
      startTime: 1000,
      endTime: 3000,
      translatedLyric: '',
      romanLyric: '',
      isBG: false,
      isDuet: false,
      words: [
        { word: '你', startTime: 1000, endTime: 1250 },
        { word: '好', startTime: 1250, endTime: 1750 },
      ],
    });
    expect(lines[1]?.words).toEqual([{ word: '下一行', startTime: 3000, endTime: 10000 }]);
  });

  it('distributes plain lyrics across the track so AMLL can still follow playback', () => {
    const lines = trackToAmlLyricLines(makeTrack({ lyrics: '第一行\n第二行', duration: 8 }));

    expect(lines.map((line) => [line.startTime, line.endTime, line.words[0]?.word])).toEqual([
      [0, 4000, '第一行'],
      [4000, 8000, '第二行'],
    ]);
    expect(hasTrackLyrics(makeTrack({ lyrics: '第一行' }))).toBe(true);
  });

  it('preserves the existing NetEase title line presentation', () => {
    const lines = trackToAmlLyricLines(makeTrack({
      source: 'netease',
      syncedLyrics: [{ time: 2, text: '正文' }],
    }));

    expect(lines[0]?.words[0]?.word).toBe('Song - Artist');
    expect(lines[1]?.words[0]?.word).toBe('正文');
  });
});
