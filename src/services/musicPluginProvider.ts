import { appStorage } from './appStorage';
import { logger } from './logger';
import { getDesktopAPI } from './desktopAdapter';
import { cookieManager, neteaseCookieManager } from './cookieManager';
import { providerLyricsCache } from './providerLyricsCache';
import type { OnlineMusicProvider, OnlineSource, OnlineSong, OnlineQuality, OnlineLyricsResult, OnlineUrlResult, PlaylistInfo } from './onlineMusicProvider';

/** Renderer facade: platform protocols run exclusively in the Node plugin. */
export function createMusicPluginProvider(id: OnlineSource): OnlineMusicProvider {
  const cookies = id === 'qq' ? cookieManager : neteaseCookieManager;
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
    ...(id === 'netease' ? { getSongDetails: (ids: string[]) => call<OnlineSong[]>('getSongDetails', [ids]) } : {}),
    getMusicUrl: (songmid: string, quality: OnlineQuality, mediaMid?: string) => call<OnlineUrlResult>('getMusicUrl', [songmid, quality, mediaMid]),
    getLyrics: songmid => providerLyricsCache.getOrLoad(id, songmid, () => call<OnlineLyricsResult | null>('getLyrics', [songmid])),
    getPlaylists: () => call<PlaylistInfo[]>('getPlaylists'),
    getPlaylistSongs: (playlist, offset, limit) => call<OnlineSong[]>('getPlaylistSongs', [playlist, offset, limit]),
    getCoverUrl: song => song.coverUrlFullSize || song.coverUrl || '',
    getRawCookie: () => cookies.getCookie(),
    hasCookie: () => cookies.hasCookie(),
    requiresCookie: () => id === 'qq',
  };
}

export function subscribeMusicPluginSecrets(): () => void {
  return getDesktopAPI()?.onMusicPluginSecretsChanged?.(id => {
    const api = getDesktopAPI();
    if (!api?.settingsGet) return;
    const read = api.settingsGet.bind(api);
    const keys = id === 'qq' ? ['qq_music_cookie', 'qq_music_credential'] : id === 'netease' ? ['netease_cookie'] : [];
    void Promise.all(keys.map(async key => [key, await read(key) ?? ''] as const)).then(async entries => {
      const values = Object.fromEntries(entries);
      await appStorage.setMany(values);
      if (id === 'qq') await cookieManager.setCookie(values['qq_music_cookie'] ?? '');
      if (id === 'netease') await neteaseCookieManager.setCookie(values['netease_cookie'] ?? '');
    }).catch(error => logger.warn('[MusicPlugins] Failed to synchronize credentials:', error));
  }) ?? (() => {});
}
