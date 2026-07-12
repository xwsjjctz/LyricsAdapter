import { describe, expect, it } from 'vitest';
import { parseLyrics, parseWordLyrics } from '@/shared/lrcParser';

describe('word-timed lyric parsing', () => {
  it('parses NetEase YRC lines and preserves each word timing', () => {
    const parsed = parseWordLyrics(
      '[1000,900](1000,300,0)你(1300,250,0)好(1550,350,0)呀',
      'yrc',
    );

    expect(parsed?.plainText).toBe('你好呀');
    expect(parsed?.syncedLyrics).toEqual([
      {
        time: 1,
        text: '你好呀',
        words: [
          { time: 1, duration: 0.3, text: '你' },
          { time: 1.3, duration: 0.25, text: '好' },
          { time: 1.55, duration: 0.35, text: '呀' },
        ],
      },
    ]);
  });

  it('extracts QQ QRC XML content before parsing word timings', () => {
    const qrc = '<QrcInfos><Lyric_1 LyricContent="[2000,700]我(2000,300)们(2300,400)啊" /></QrcInfos>';
    const parsed = parseWordLyrics(qrc, 'qrc');

    expect(parsed?.plainText).toBe('我们啊');
    expect(parsed?.syncedLyrics?.[0]?.words).toEqual([
      { time: 2, duration: 0.3, text: '我' },
      { time: 2.3, duration: 0.4, text: '们啊' },
    ]);
  });

  it('prefers valid word-timed lyrics and falls back to LRC when absent', () => {
    expect(parseLyrics('[00:01.20]逐行歌词', '[1000,200](1000,200,0)逐字', 'yrc').syncedLyrics?.[0])
      .toMatchObject({ time: 1, text: '逐字', words: [{ time: 1, duration: 0.2, text: '逐字' }] });
    expect(parseLyrics('[00:01.20]逐行歌词').syncedLyrics?.[0])
      .toEqual({ time: 1.2, text: '逐行歌词' });
  });
});
