import { describe, expect, it } from 'vitest';
import { trackMatchesQuery } from '../../services/pinyinSearch';
import { Track } from '../../types';

function makeTrack(overrides: Partial<Track>): Track {
  return {
    id: 'track-1',
    title: '',
    artist: '',
    album: '',
    duration: 0,
    audioUrl: '',
    ...overrides,
  };
}

describe('trackMatchesQuery', () => {
  it('matches Chinese track title by full pinyin', () => {
    const track = makeTrack({ title: '晴天', artist: '周杰伦', album: '叶惠美' });

    expect(trackMatchesQuery(track, 'qingtian')).toBe(true);
    expect(trackMatchesQuery(track, 'zhoujielun')).toBe(true);
  });

  it('matches Chinese track metadata by pinyin initials', () => {
    const track = makeTrack({ title: '告白气球', artist: '周杰伦', album: '周杰伦的床边故事' });

    expect(trackMatchesQuery(track, 'gbqq')).toBe(true);
    expect(trackMatchesQuery(track, 'zjl')).toBe(true);
  });

  it('matches words covered by pinyin-pro with full pinyin and initials', () => {
    const track = makeTrack({ title: '鸣潮', artist: '库洛游戏', album: '鸣潮 OST' });

    expect(trackMatchesQuery(track, 'MC')).toBe(true);
    expect(trackMatchesQuery(track, 'MingChao')).toBe(true);
  });

  it('keeps normal text search behavior for mixed latin metadata', () => {
    const track = makeTrack({ title: 'Love Story', artist: 'Taylor Swift', album: 'Fearless' });

    expect(trackMatchesQuery(track, 'love')).toBe(true);
    expect(trackMatchesQuery(track, 'taylor')).toBe(true);
    expect(trackMatchesQuery(track, 'fear less')).toBe(true);
  });

  it('returns false for blank queries', () => {
    const track = makeTrack({ title: '七里香', artist: '周杰伦', album: '七里香' });

    expect(trackMatchesQuery(track, '   ')).toBe(false);
  });
});
