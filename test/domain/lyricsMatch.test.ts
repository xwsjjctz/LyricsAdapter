import { describe, expect, it } from 'vitest';
import {
  isInstrumentalTitle,
  lyricsSearchTerms,
  normalizeMatchText,
  rankLyricsCandidates,
  scoreLyricsCandidate,
  splitArtists,
  type LyricsMatchCandidate,
} from '../../src/domain/lyricsMatch';

const song = (title: string, artists: string[], duration?: number, album?: string): LyricsMatchCandidate =>
  ({ title, artists, duration, album });

describe('lyrics matching', () => {
  it('ignores case, width, spacing and punctuation when comparing text', () => {
    expect(normalizeMatchText('Ｈｅｌｌｏ,  World！')).toBe('helloworld');
    expect(normalizeMatchText('晴天 ')).toBe('晴天');
  });

  it('accepts the same title by the same artist and prefers the closest length', () => {
    const query = { title: '晴天', artist: '周杰伦', duration: 269 };
    expect(scoreLyricsCandidate(query, song('晴天', ['周杰伦'], 269))).not.toBeNull();
    const ranked = rankLyricsCandidates(query, [
      song('晴天', ['周杰伦'], 274),
      song('晴天', ['周杰伦'], 270),
      song('晴天', ['刘瑞琦'], 269),
    ], candidate => candidate);
    expect(ranked.map(candidate => candidate.duration)).toEqual([270, 274]);
  });

  it('rejects another artist, another title and a clearly different length', () => {
    const query = { title: '晴天', artist: '周杰伦', duration: 269 };
    expect(scoreLyricsCandidate(query, song('晴天', ['刘瑞琦'], 269))).toBeNull();
    expect(scoreLyricsCandidate(query, song('晴天娃娃', ['周杰伦'], 269))).toBeNull();
    expect(scoreLyricsCandidate(query, song('晴天', ['周杰伦'], 300))).toBeNull();
  });

  it('treats a bracketed note as the same song only when artist and length agree', () => {
    const live = { title: '晴天 (Live)', artist: '周杰伦', duration: 280 };
    expect(scoreLyricsCandidate(live, song('晴天', ['周杰伦'], 281))).not.toBeNull();
    expect(scoreLyricsCandidate(live, song('晴天', ['周杰伦'], 269))).toBeNull();
    expect(scoreLyricsCandidate({ ...live, artist: 'Unknown Artist' }, song('晴天', ['周杰伦'], 280))).toBeNull();
  });

  it('needs an exact title and the same length when the track names no artist', () => {
    const untagged = { title: 'Idol', artist: 'Unknown Artist', duration: 213 };
    expect(scoreLyricsCandidate(untagged, song('Idol', ['YOASOBI'], 214))).not.toBeNull();
    expect(scoreLyricsCandidate(untagged, song('Idol', ['YOASOBI'], 218))).toBeNull();
    expect(scoreLyricsCandidate({ ...untagged, duration: undefined }, song('Idol', ['YOASOBI'], 213))).toBeNull();
  });

  it('accepts a known artist without any duration to compare', () => {
    expect(scoreLyricsCandidate({ title: 'Idol', artist: 'YOASOBI' }, song('Idol', ['YOASOBI']))).not.toBeNull();
  });

  it('matches one of several artists however they are joined', () => {
    expect(splitArtists('稲葉曇 / 歌愛ユキ')).toEqual(['稲葉曇', '歌愛ユキ']);
    expect(splitArtists('A feat. B & C')).toEqual(['A', 'B', 'C']);
    expect(scoreLyricsCandidate({ title: 'ラグトレイン', artist: '稲葉曇、歌愛ユキ' }, song('ラグトレイン', ['稲葉曇']))).not.toBeNull();
  });

  it('reads a title that carries a track number or the artist', () => {
    expect(lyricsSearchTerms({ title: '03. 晴天', artist: '周杰伦' })).toEqual({ title: '晴天', artist: '周杰伦' });
    expect(lyricsSearchTerms({ title: '周杰伦 - 晴天', artist: 'Unknown Artist' })).toEqual({ title: '晴天', artist: '周杰伦' });
    expect(lyricsSearchTerms({ title: '周杰伦 - 晴天', artist: '周杰伦' })).toEqual({ title: '晴天', artist: '周杰伦' });
    expect(lyricsSearchTerms({ title: 'Song - Remastered', artist: 'Band' })).toEqual({ title: 'Song - Remastered', artist: 'Band' });
    expect(scoreLyricsCandidate({ title: '周杰伦 - 晴天', artist: '', duration: 269 }, song('晴天', ['周杰伦'], 269))).not.toBeNull();
  });

  it('breaks ties by album and otherwise keeps the source order', () => {
    const query = { title: 'Idol', artist: 'YOASOBI', album: 'THE BOOK 3' };
    const ranked = rankLyricsCandidates(query, [
      song('Idol', ['YOASOBI'], undefined, 'Idol'),
      song('Idol', ['YOASOBI'], undefined, 'the book 3'),
      song('Idol', ['YOASOBI'], undefined, 'Other'),
    ], candidate => candidate);
    expect(ranked.map(candidate => candidate.album)).toEqual(['the book 3', 'Idol', 'Other']);
  });

  it('recognises recordings without sung words', () => {
    for (const title of ['晴天 (伴奏)', 'Idol (Instrumental)', 'Song -off vocal-', 'アイドル カラオケ']) {
      expect(isInstrumentalTitle(title)).toBe(true);
    }
    expect(isInstrumentalTitle('Instant Crush')).toBe(false);
  });
});
