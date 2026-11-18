import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnlineLyricsResult, OnlineSong } from '@/shared/onlineMusic';
import type { Track } from '@/types';

const registry = vi.hoisted(() => ({
  plugins: [] as { id: string; enabled: boolean; capabilities: string[]; requiresCookie: boolean }[],
  signedIn: new Set<string>(),
  desktop: null as { matchCommunityLyrics: (query: unknown) => Promise<OnlineLyricsResult | null> } | null,
}));

vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPI: () => registry.desktop }));
vi.mock('@/services/online/musicPlugins', () => ({
  musicPluginState: { getSnapshot: () => ({ plugins: registry.plugins }) },
  availableMusicSources: (plugins: typeof registry.plugins) =>
    plugins.filter(plugin => plugin.enabled && plugin.capabilities.includes('search')).map(plugin => plugin.id),
  getMusicPluginInfo: (id: string) => registry.plugins.find(plugin => plugin.id === id),
}));
vi.mock('@/services/online/musicSources', () => ({
  cookieStoreFor: () => ({ ensureLoaded: async () => {} }),
  providerFor: (id: string) => ({
    id,
    hasCookie: () => registry.signedIn.has(id),
    requiresCookie: () => registry.plugins.find(plugin => plugin.id === id)?.requiresCookie ?? false,
  }),
}));

import { currentLyricsSources, findLyrics, lyricsQueryFor, needsLyricsMatch } from '@/services/lyrics/lyricsAutoMatch';

const QUERY = { title: '晴天', artist: '周杰伦', duration: 269 };
const LYRICS: OnlineLyricsResult = { lyrics: '[00:01.00]故事的小黄花' };

const song = (songmid: string, songname: string, singer: string, interval: number): OnlineSong =>
  ({ songmid, songname, singer: [{ name: singer }], interval });

function provider(id: string, songs: OnlineSong[], lyrics: Record<string, OnlineLyricsResult | null>) {
  return {
    id,
    searchMusic: vi.fn(async () => songs),
    getLyrics: vi.fn(async (songmid: string) => lyrics[songmid] ?? null),
  };
}

const local = (overrides: Partial<Track> = {}): Track =>
  ({ id: 't', title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269, audioUrl: '', filePath: '/music/晴天.flac', ...overrides });

beforeEach(() => {
  registry.plugins = [];
  registry.signedIn = new Set();
  registry.desktop = null;
});

describe('needsLyricsMatch', () => {
  it('covers local files without lyrics, and nothing else', () => {
    expect(needsLyricsMatch(local())).toBe(true);
    expect(needsLyricsMatch(local({ lyrics: '  ' }))).toBe(true);
    expect(needsLyricsMatch(local({ lyrics: '歌词' }))).toBe(false);
    expect(needsLyricsMatch(local({ syncedLyrics: [{ time: 1, text: '歌词' }] }))).toBe(false);
    expect(needsLyricsMatch(local({ filePath: undefined, source: 'webdav', webdavPath: '/a.flac' }))).toBe(false);
    expect(needsLyricsMatch(local({ filePath: undefined, source: 'netease', songmid: '1' }))).toBe(false);
    expect(needsLyricsMatch(local({ title: '晴天 (伴奏)' }))).toBe(false);
  });

  it('leaves placeholder albums and unknown durations out of the query', () => {
    expect(lyricsQueryFor(local())).toEqual({ title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269 });
    expect(lyricsQueryFor(local({ album: 'Unknown Album', duration: 0 }))).toEqual({ title: '晴天', artist: '周杰伦' });
  });
});

describe('findLyrics', () => {
  it('takes the lyrics of the matching song from the first source that has them', async () => {
    const first = provider('qq', [song('a', '晴天', '刘瑞琦', 269), song('b', '晴天', '周杰伦', 270)], { b: LYRICS });
    const second = provider('netease', [song('c', '晴天', '周杰伦', 269)], { c: { lyrics: 'other' } });
    const community = vi.fn(async () => null);

    expect(await findLyrics(QUERY, { providers: [first, second], community })).toEqual({ lyrics: LYRICS, conclusive: true });
    expect(first.searchMusic).toHaveBeenCalledWith('晴天 周杰伦', 10);
    expect(first.getLyrics).toHaveBeenCalledWith('b');
    expect(first.getLyrics).not.toHaveBeenCalledWith('a');
    expect(second.searchMusic).not.toHaveBeenCalled();
    expect(community).not.toHaveBeenCalled();
  });

  it('moves on when a source has no lyrics for the song, down to the community collection', async () => {
    const empty = provider('netease', [song('c', '晴天', '周杰伦', 269)], { c: { lyrics: '[00:00.00]纯音乐，请欣赏' } });
    const community = vi.fn(async () => LYRICS);
    expect(await findLyrics(QUERY, { providers: [empty], community })).toEqual({ lyrics: LYRICS, conclusive: true });
    expect(community).toHaveBeenCalledWith(QUERY);
  });

  it('tries the runner-up when the best match has no lyrics, and no further', async () => {
    const source = provider('netease', [
      song('a', '晴天', '周杰伦', 269), song('b', '晴天', '周杰伦', 270), song('c', '晴天', '周杰伦', 271),
    ], { b: LYRICS, c: LYRICS });
    expect((await findLyrics(QUERY, { providers: [source] })).lyrics).toBe(LYRICS);
    expect(source.getLyrics.mock.calls.map(call => call[0])).toEqual(['a', 'b']);
  });

  it('is final when a platform was searched and nothing was found', async () => {
    const source = provider('netease', [song('x', '别的歌', '周杰伦', 269)], {});
    expect(await findLyrics(QUERY, { providers: [source], community: async () => null }))
      .toEqual({ lyrics: null, conclusive: true });
    expect(source.getLyrics).not.toHaveBeenCalled();
  });

  it('leaves the question open when a source failed or only the community collection could be asked', async () => {
    const broken = { id: 'qq', searchMusic: vi.fn(async () => { throw new Error('Cookie expired'); }), getLyrics: vi.fn() };
    const working = provider('netease', [], {});
    expect(await findLyrics(QUERY, { providers: [broken, working] })).toEqual({ lyrics: null, conclusive: false });
    expect(await findLyrics(QUERY, { providers: [], community: async () => null })).toEqual({ lyrics: null, conclusive: false });
    expect(await findLyrics(QUERY, { providers: [working], community: async () => { throw new Error('offline'); } }))
      .toEqual({ lyrics: null, conclusive: false });
  });

  it('still returns lyrics found after an earlier source failed', async () => {
    const broken = { id: 'qq', searchMusic: vi.fn(async () => { throw new Error('offline'); }), getLyrics: vi.fn() };
    const working = provider('netease', [song('c', '晴天', '周杰伦', 269)], { c: LYRICS });
    expect(await findLyrics(QUERY, { providers: [broken, working] })).toEqual({ lyrics: LYRICS, conclusive: true });
  });
});

describe('currentLyricsSources', () => {
  const plugin = (id: string, requiresCookie: boolean, capabilities = ['search', 'lyrics'], enabled = true) =>
    ({ id, enabled, capabilities, requiresCookie });

  it('asks signed-in sources first and skips those that need a sign-in they lack', async () => {
    registry.plugins = [plugin('qq', true), plugin('netease', false), plugin('other', false)];
    registry.signedIn = new Set(['other']);
    expect((await currentLyricsSources()).providers.map(source => source.id)).toEqual(['other', 'netease']);

    registry.signedIn = new Set(['qq', 'other']);
    expect((await currentLyricsSources()).providers.map(source => source.id)).toEqual(['qq', 'other', 'netease']);
  });

  it('leaves out disabled sources and those that offer no lyrics', async () => {
    registry.plugins = [plugin('a', false, ['search']), plugin('b', false, ['search', 'lyrics'], false), plugin('c', false)];
    expect((await currentLyricsSources()).providers.map(source => source.id)).toEqual(['c']);
  });

  it('offers the community collection only on the desktop', async () => {
    expect((await currentLyricsSources()).community).toBeUndefined();
    const matchCommunityLyrics = vi.fn(async () => LYRICS);
    registry.desktop = { matchCommunityLyrics };
    expect(await (await currentLyricsSources()).community?.(QUERY)).toBe(LYRICS);
    expect(matchCommunityLyrics).toHaveBeenCalledWith(QUERY);
  });
});
