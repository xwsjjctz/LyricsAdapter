import { describe, expect, it } from 'vitest';
import { parseLyrics } from '@/shared/lrcParser';

describe('word-timed lyric parsing', () => {
  it('parses NetEase YRC lines and preserves each word timing', () => {
    const parsed = parseLyrics(
      '',
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
    const qrc = '<QrcInfos><Lyric_1 LyricContent="[2000,700]我(2000,300)们(2300,200)啊(2500,200)" /></QrcInfos>';
    const parsed = parseLyrics('', qrc, 'qrc');

    expect(parsed?.plainText).toBe('我们啊');
    expect(parsed?.syncedLyrics?.[0]?.words).toEqual([
      { time: 2, duration: 0.3, text: '我' },
      { time: 2.3, duration: 0.2, text: '们' },
      { time: 2.5, duration: 0.2, text: '啊' },
    ]);
  });

  it('does not truncate QRC content at an apostrophe in English lyrics', () => {
    // LyricContent is a double-quoted XML attribute whose value may contain
    // apostrophes from the lyrics (e.g. "that's", "ain't"). A `["']` delimiter
    // would mistake the apostrophe for the closing quote and drop everything
    // after the first apostrophe — this regressed Closer (The Chainsmokers)
    // from 64 lines down to 7.
    const qrc = '<QrcInfos><Lyric_1 LyricContent="'
      + "[1000,1000]that's(1000,500) that(1500,500)\n"
      + "[2000,1000]ain't(2000,1000) "
      + '" /></QrcInfos>';
    const parsed = parseLyrics('', qrc, 'qrc');

    expect(parsed?.syncedLyrics).toHaveLength(2);
    // The second line survived the apostrophe and was not truncated.
    expect(parsed?.syncedLyrics?.[1]?.text).toContain("ain't");
    expect(parsed?.syncedLyrics?.[1]?.words).toEqual(
      expect.arrayContaining([{ time: 2, duration: 1, text: "ain't" }]),
    );
  });

  it('preserves zero-duration spaces between QRC English words', () => {
    const qrc = '<QrcInfos><Lyric_1 LyricContent="'
      + '[18042,2100]Could(18042,490) (18532,0)you(18532,80) (18612,0)'
      + 'spare(18612,520) (19132,0)a(19132,40) (19172,10)second(19182,960)'
      + '" /></QrcInfos>';
    const parsed = parseLyrics('', qrc, 'qrc');
    const line = parsed.syncedLyrics?.[0];

    expect(line?.text).toBe('Could you spare a second');
    expect(line?.words?.map((word) => word.text).join('')).toBe(line?.text);
    expect(line?.words).toEqual([
      { time: 18.042, duration: 0.49, text: 'Could ' },
      { time: 18.532, duration: 0.08, text: 'you ' },
      { time: 18.612, duration: 0.52, text: 'spare ' },
      { time: 19.132, duration: 0.04, text: 'a' },
      { time: 19.172, duration: 0.01, text: ' ' },
      { time: 19.182, duration: 0.96, text: 'second' },
    ]);
  });

  it('prefers valid word-timed lyrics and falls back to LRC when absent', () => {
    expect(parseLyrics('[00:01.20]逐行歌词', '[1000,200](1000,200,0)逐字', 'yrc').syncedLyrics?.[0])
      .toMatchObject({ time: 1, text: '逐字', words: [{ time: 1, duration: 0.2, text: '逐字' }] });
    expect(parseLyrics('[00:01.20]逐行歌词').syncedLyrics?.[0])
      .toEqual({ time: 1.2, text: '逐行歌词' });
  });

  it.each([
    ['qrc' as const, '[00:01.20]这其实是普通 LRC'],
    ['qrc' as const, '<QrcInfos><Lyric_1 LyricContent="broken" /></QrcInfos>'],
    ['yrc' as const, 'not a YRC payload'],
  ])('keeps line scrolling when a non-empty %s payload cannot provide word timings', (format, wordLyrics) => {
    const parsed = parseLyrics(
      '[00:01.20]第一行\n[00:03.40]第二行',
      wordLyrics,
      format,
    );

    expect(parsed.plainText).toBe('第一行\n第二行');
    expect(parsed.syncedLyrics).toEqual([
      { time: 1.2, text: '第一行' },
      { time: 3.4, text: '第二行' },
    ]);
  });
});
