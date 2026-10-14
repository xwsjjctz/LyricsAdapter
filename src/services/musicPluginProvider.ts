import { getDesktopAPI } from './desktopAdapter';
import type { CookieStore } from './cookieManager';
import { providerLyricsCache } from './providerLyricsCache';
import type { OnlineMusicProvider, OnlineSource, OnlineSong, OnlineQuality, OnlineLyricsResult, OnlineUrlResult, PlaylistInfo } from './onlineMusicProvider';

interface MusicPluginProviderOptions {
  cookies: CookieStore;
  requiresCookie: () => boolean;
  /** The plugin implements getSongDetails (batch metadata lookup). */
  songDetails: boolean;
}

/** Renderer facade: platform protocols run exclusively in the Node plugin. */
export function createMusicPluginProvider(id: OnlineSource, { cookies, requiresCookie, songDetails }: MusicPluginProviderOptions): OnlineMusicProvider {
  const call = async <T>(method: string, args: unknown[] = []): Promise<T> => {
    const api = getDesktopAPI();
    if (!api?.musicPluginCall) throw new Error('Online music requires the desktop music plugin host');
    await cookies.ensureLoaded();
    return await api.musicPluginCall(id, method, args) as T;
  };
  return {
    id,
    searchMusic: (query, limit) => call<OnlineSong[]>('searchMusic', [query, limit]),
    getRecommendedSongs: () => call<OnlineSong[]>('getRecommendedSongs'),
    ...(songDetails ? { getSongDetails: (ids: string[]) => call<OnlineSong[]>('getSongDetails', [ids]) } : {}),
    getMusicUrl: (songmid: string, quality: OnlineQuality, mediaMid?: string) => call<OnlineUrlResult>('getMusicUrl', [songmid, quality, mediaMid]),
    getLyrics: songmid => providerLyricsCache.getOrLoad(id, songmid, () => call<OnlineLyricsResult | null>('getLyrics', [songmid])),
    getPlaylists: () => call<PlaylistInfo[]>('getPlaylists'),
    getPlaylistSongs: (playlist, offset, limit) => call<OnlineSong[]>('getPlaylistSongs', [playlist, offset, limit]),
    getCoverUrl: song => song.coverUrlFullSize || song.coverUrl || '',
    getRawCookie: () => cookies.getCookie(),
    hasCookie: () => cookies.hasCookie(),
    requiresCookie,
  };
}
