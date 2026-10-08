import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ call: vi.fn(), ensureLoaded: vi.fn(), cache: vi.fn() }));
vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPI: () => ({ musicPluginCall: mocks.call }) }));
vi.mock('@/services/cookieManager', () => {
  const store = { ensureLoaded: mocks.ensureLoaded, getCookie: () => 'cookie=1', hasCookie: () => true };
  return { cookieManager: store, neteaseCookieManager: store };
});
vi.mock('@/services/appStorage', () => ({ appStorage: {} }));
vi.mock('@/services/providerLyricsCache', () => ({ providerLyricsCache: { getOrLoad: mocks.cache } }));
import { createMusicPluginProvider } from '@/services/musicPluginProvider';

describe('renderer music plugin facade', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.ensureLoaded.mockResolvedValue(undefined); });
  it('preserves source, media id, and actual served quality across the generic bridge', async () => {
    mocks.call.mockResolvedValue({ url: 'https://cdn.example/audio', quality: '128', bitrate: '128kbps' });
    await expect(createMusicPluginProvider('qq').getMusicUrl('song', 'flac', 'media')).resolves.toMatchObject({ quality: '128' });
    expect(mocks.call).toHaveBeenCalledWith('qq', 'getMusicUrl', ['song', 'flac', 'media']);
    expect(createMusicPluginProvider('qq').getSongDetails).toBeUndefined();
  });
  it('routes lyrics through the bounded host cache', async () => {
    mocks.call.mockResolvedValue({ lyrics: '[00:01]line' });
    mocks.cache.mockImplementation((_source, _id, load: () => Promise<unknown>) => load());
    await createMusicPluginProvider('netease').getLyrics('42');
    expect(mocks.cache).toHaveBeenCalledWith('netease', '42', expect.any(Function));
    expect(mocks.call).toHaveBeenCalledWith('netease', 'getLyrics', ['42']);
  });
  it('surfaces plugin disablement without converting it to an empty result', async () => {
    mocks.call.mockRejectedValue(new Error('Music plugin is disabled'));
    await expect(createMusicPluginProvider('netease').searchMusic('query')).rejects.toThrow(/disabled/);
  });
});
