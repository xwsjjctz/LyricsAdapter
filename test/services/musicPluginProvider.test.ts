import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ call: vi.fn(), ensureLoaded: vi.fn(), cache: vi.fn() }));
vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPI: () => ({ musicPluginCall: mocks.call }) }));
vi.mock('@/services/providerLyricsCache', () => ({ providerLyricsCache: { getOrLoad: mocks.cache } }));
import { createMusicPluginProvider } from '@/services/musicPluginProvider';
import type { CookieStore } from '@/services/cookieManager';

const cookies = { ensureLoaded: mocks.ensureLoaded, getCookie: () => 'cookie=1', hasCookie: () => true } as unknown as CookieStore;
const provider = (id: string, songDetails = false) => createMusicPluginProvider(id, { cookies, requiresCookie: () => false, songDetails });

describe('renderer music plugin facade', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.ensureLoaded.mockResolvedValue(undefined); });
  it('preserves source, media id, and actual served quality across the generic bridge', async () => {
    mocks.call.mockResolvedValue({ url: 'https://cdn.example/audio', quality: '128', bitrate: '128kbps' });
    await expect(provider('qq').getMusicUrl('song', 'flac', 'media')).resolves.toMatchObject({ quality: '128' });
    expect(mocks.call).toHaveBeenCalledWith('qq', 'getMusicUrl', ['song', 'flac', 'media']);
    expect(provider('qq').getSongDetails).toBeUndefined();
    expect(provider('netease', true).getSongDetails).toBeTypeOf('function');
    await provider('third-party').searchMusic('q');
    expect(mocks.call).toHaveBeenLastCalledWith('third-party', 'searchMusic', ['q', undefined]);
  });
  it('routes lyrics through the bounded host cache', async () => {
    mocks.call.mockResolvedValue({ lyrics: '[00:01]line' });
    mocks.cache.mockImplementation((_source, _id, load: () => Promise<unknown>) => load());
    await provider('netease').getLyrics('42');
    expect(mocks.cache).toHaveBeenCalledWith('netease', '42', expect.any(Function));
    expect(mocks.call).toHaveBeenCalledWith('netease', 'getLyrics', ['42']);
  });
  it('surfaces plugin disablement without converting it to an empty result', async () => {
    mocks.call.mockRejectedValue(new Error('Music plugin is disabled'));
    await expect(provider('netease').searchMusic('query')).rejects.toThrow(/disabled/);
  });
});
