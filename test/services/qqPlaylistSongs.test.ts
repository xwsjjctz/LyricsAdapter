import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/cookieManager', () => ({
  cookieManager: { hasCookie: () => true, getCookie: () => 'uin=1', parseCookie: () => ({ uin: '1' }), getCookieHeaders: () => ({}) },
}));
vi.mock('@/services/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPI: () => null }));

const TOTAL = 65;
const qzoneSongs = Array.from({ length: TOTAL }, (_, i) => ({
  songmid: `mid${i}`, songname: `Song ${i}`, singer: [{ name: 'A' }], albummid: `alb${i}`, interval: 200,
}));
const musicuSong = (i: number) => ({ mid: `mid${i}`, name: `Song ${i}`, singer: [{ name: 'A' }], album: { mid: `alb${i}` }, interval: 200 });

type Mode = 'paged' | 'paged-empty' | 'paged-fails';

async function freshApi(mode: Mode = 'paged') {
  vi.resetModules();
  const { qqMusicApi } = await import('@/services/qqMusicApi');
  const requestJson = vi.fn(async (url: string, options: { body?: string } = {}) => {
    if (url.includes('fcg_ucc_getcdinfo_byids_cp')) return { cdlist: [{ songlist: qzoneSongs }] };
    if (mode === 'paged-fails') throw new Error('network');
    const { disstid, song_begin: begin, song_num: num } = JSON.parse(options.body!).req_0.param;
    // CgiGetDiss rejects a string id with req_0.code 10004.
    if (typeof disstid !== 'number') return { code: 0, req_0: { code: 10004, data: { songlist: [], total_song_num: 0 } } };
    const songlist = mode === 'paged-empty' ? [] : Array.from({ length: Math.max(0, Math.min(num, TOTAL - begin)) }, (_, i) => musicuSong(begin + i));
    return { code: 0, req_0: { code: 0, data: { songlist, total_song_num: TOTAL } } };
  });
  (qqMusicApi as unknown as { requestJson: typeof requestJson }).requestJson = requestJson;
  const fullListCalls = () => requestJson.mock.calls.filter(([url]) => url.includes('fcg_ucc_getcdinfo_byids_cp')).length;
  return { api: qqMusicApi, requestJson, fullListCalls };
}

describe('QQ playlist songs', () => {
  beforeEach(() => { vi.useRealTimers(); });

  it('pages through the lightweight paged endpoint without downloading the full list', async () => {
    const { api, fullListCalls } = await freshApi();
    const first = await api.getPlaylistSongs('3349641645', 0, 30);
    const last = await api.getPlaylistSongs('3349641645', 60, 30);
    expect(first.map(s => s.songmid)).toEqual(qzoneSongs.slice(0, 30).map(s => s.songmid));
    expect(first[0]?.coverUrl).toContain('alb0');
    expect(last).toHaveLength(5);
    expect(await api.getPlaylistSongs('3349641645', 90, 30)).toEqual([]);
    expect(fullListCalls()).toBe(0);
  });

  it('falls back to the full list once and serves later pages from memory', async () => {
    const { api, fullListCalls } = await freshApi('paged-fails');
    const first = await api.getPlaylistSongs('p1', 0, 30);
    const second = await api.getPlaylistSongs('p1', 30, 30);
    expect(first[0]?.songmid).toBe('mid0');
    expect(second[0]?.songmid).toBe('mid30');
    expect(fullListCalls()).toBe(1);
  });

  it('falls back when the paged endpoint returns nothing before the end', async () => {
    const { api, fullListCalls } = await freshApi('paged-empty');
    expect(await api.getPlaylistSongs('p1', 0, 30)).toHaveLength(30);
    expect(fullListCalls()).toBe(1);
  });

  it('shares one full-list request between concurrent pages and refetches after it expires', async () => {
    vi.useFakeTimers();
    const { api, fullListCalls } = await freshApi('paged-fails');
    await Promise.all([api.getPlaylistSongs('p1', 0, 30), api.getPlaylistSongs('p1', 30, 30)]);
    expect(fullListCalls()).toBe(1);

    vi.advanceTimersByTime(10 * 60 * 1000);
    await api.getPlaylistSongs('p1', 0, 30);
    expect(fullListCalls()).toBe(2);
  });
});
