import { logger } from './logger';
import { neteaseCookieManager } from './cookieManager';
import type {
  OnlineMusicProvider,
  OnlineQuality,
  OnlineSong,
  OnlineUrlResult,
} from './onlineMusicProvider';

/**
 * NetEase Cloud Music (网易云音乐) renderer client.
 *
 * All requests are weapi-encrypted in the main process (see
 * electron/ipc/neteaseHandlers.ts), so this layer is a thin typed wrapper over
 * the `neteaseRequest` IPC channel. Search and recommendations work
 * anonymously; a login cookie (optional) unlocks VIP / high-quality playback.
 */

/** Raw song shape — `/search/get` uses `artists/album/duration`, playlist detail uses `ar/al/dt`. */
interface NetEaseSongRaw {
  id: number;
  name?: string;
  ar?: { id?: number; name?: string }[];
  artists?: { id?: number; name?: string }[];
  al?: NetEaseAlbumRaw;
  album?: NetEaseAlbumRaw;
  picUrl?: string;
  pic_str?: string;
  picStr?: string;
  pic?: number;
  picId?: number;
  dt?: number;
  duration?: number;
}

interface NetEaseAlbumRaw {
  id?: number;
  name?: string;
  picUrl?: string;
  blurPicUrl?: string;
  pic_str?: string;
  picStr?: string;
  pic?: number;
  picId?: number;
}

interface NetEaseSongUrlEntry {
  url: string | null;
  br?: number;
  freeTrialInfo?: unknown;
}

interface NetEaseLyricBlock {
  lyric?: string;
}

interface NetEaseLyricResponse {
  lrc?: NetEaseLyricBlock;
  tlyric?: NetEaseLyricBlock;
  romalrc?: NetEaseLyricBlock;
  yrc?: NetEaseLyricBlock;
}

/** Map the shared UI quality to NetEase `level`. */
const QUALITY_MAP: Record<OnlineQuality, string> = {
  '128': 'standard',
  '320': 'exhigh',
  flac: 'lossless',
  m4a: 'higher',
};

/** Hot playlist used for "recommended" — 3778678 = 云音乐热歌榜. */
const HOT_PLAYLIST_ID = '3778678';

class NetEaseMusicAPI implements OnlineMusicProvider {
  readonly id = 'netease' as const;
  private detailsCache = new Map<string, OnlineSong>();
  private albumCoverCache = new Map<string, string | undefined>();
  private lyricsCache = new Map<string, string | null>();

  /** Send a weapi request via the main process. */
  private async request(
    channel: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (!window.electron?.neteaseRequest) {
      throw new Error('网易云 API 不可用（需要桌面端运行）');
    }
    const cookie = neteaseCookieManager.getCookie();
    const result = await window.electron.neteaseRequest(channel, params, cookie || undefined);
    if (!result.success) {
      throw new Error(result.error || `${channel} 失败`);
    }
    return result.data;
  }

  private normalize(raw: NetEaseSongRaw): OnlineSong {
    const artists = raw.ar ?? raw.artists ?? [];
    const album = raw.al ?? raw.album;
    const durationMs = raw.dt ?? raw.duration ?? 0;
    const coverUrl = this.getRawCoverUrl(raw);
    return {
      songmid: String(raw.id),
      songname: raw.name || 'Unknown',
      singer: artists.length
        ? artists.map((a) => ({
            name: a.name || 'Unknown',
            mid: a.id != null ? String(a.id) : undefined,
          }))
        : [{ name: 'Unknown' }],
      albumname: album?.name,
      albummid: album?.id != null ? String(album.id) : undefined,
      interval: Math.round((durationMs || 0) / 1000),
      coverUrl,
    };
  }

  private normalizeCoverUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;
    const normalized = url.startsWith('http://') ? url.replace(/^http:\/\//, 'https://') : url;
    return normalized.includes('?') ? normalized : `${normalized}?param=800y800`;
  }

  private getRawCoverUrl(raw: NetEaseSongRaw): string | undefined {
    const album = raw.al ?? raw.album;
    return this.normalizeCoverUrl(
      album?.picUrl ||
      album?.blurPicUrl ||
      raw.picUrl ||
      this.buildCoverUrlFromPicFields(album) ||
      this.buildCoverUrlFromPicFields(raw)
    );
  }

  private buildCoverUrlFromPicFields(raw: NetEaseAlbumRaw | NetEaseSongRaw | undefined): string | undefined {
    if (!raw) return undefined;
    const picKey = raw.pic_str || raw.picStr;
    const picId = raw.picId ?? raw.pic;
    if (!picKey || picId == null) return undefined;
    return `https://p1.music.126.net/${picKey}/${picId}.jpg`;
  }

  private mergeSong(base: OnlineSong, details: OnlineSong | undefined): OnlineSong {
    if (!details) return base;
    return {
      ...base,
      songname: base.songname !== 'Unknown' ? base.songname : details.songname,
      singer: base.singer.length > 0 && base.singer[0]?.name !== 'Unknown' ? base.singer : details.singer,
      albumname: base.albumname || details.albumname,
      albummid: base.albummid || details.albummid,
      interval: base.interval || details.interval,
      coverUrl: base.coverUrl || details.coverUrl,
    };
  }

  private async hydrateSongDetails(songs: OnlineSong[]): Promise<OnlineSong[]> {
    const missingIds = songs
      .filter((song) => !this.detailsCache.has(song.songmid))
      .map((song) => song.songmid);

    if (missingIds.length > 0) {
      try {
        await this.getSongDetails(missingIds);
      } catch (err) {
        logger.warn('[NetEase] hydrateSongDetails failed:', err);
      }
    }

    const hydrated = songs.map((song) => this.mergeSong(song, this.detailsCache.get(song.songmid)));
    await this.hydrateAlbumCovers(hydrated);
    return hydrated.map((song) => {
      if (song.coverUrl || !song.albummid) return song;
      const coverUrl = this.albumCoverCache.get(song.albummid);
      return coverUrl ? { ...song, coverUrl } : song;
    });
  }

  private async hydrateAlbumCovers(songs: OnlineSong[]): Promise<void> {
    const albumIds = [...new Set(
      songs
        .filter((song) => !song.coverUrl && song.albummid && !this.albumCoverCache.has(song.albummid))
        .map((song) => song.albummid!)
    )];
    if (albumIds.length === 0) return;

    await Promise.all(albumIds.map(async (albumId) => {
      try {
        const coverUrl = await this.getAlbumCoverUrl(albumId);
        this.albumCoverCache.set(albumId, coverUrl);
      } catch (err) {
        logger.warn('[NetEase] getAlbumCoverUrl failed:', albumId, err);
        this.albumCoverCache.set(albumId, undefined);
      }
    }));
  }

  private async getAlbumCoverUrl(albumId: string): Promise<string | undefined> {
    const data = (await this.request(`/v1/album/${albumId}`, {
      csrf_token: '',
    })) as { album?: NetEaseAlbumRaw } | undefined;
    const album = data?.album;
    return this.normalizeCoverUrl(
      album?.picUrl ||
      album?.blurPicUrl ||
      this.buildCoverUrlFromPicFields(album)
    );
  }

  async searchMusic(query: string, limit = 20): Promise<OnlineSong[]> {
    const data = (await this.request('/search/get', {
      s: query,
      type: 1,
      limit,
      offset: 0,
    })) as { result?: { songs?: NetEaseSongRaw[] } } | undefined;
    const songs = data?.result?.songs ?? [];
    return this.hydrateSongDetails(songs.map((s) => this.normalize(s)));
  }

  async getRecommendedSongs(): Promise<OnlineSong[]> {
    const data = (await this.request('/v6/playlist/detail', {
      id: HOT_PLAYLIST_ID,
      n: 30,
      s: 0,
    })) as { playlist?: { tracks?: NetEaseSongRaw[] } } | undefined;
    const tracks = data?.playlist?.tracks ?? [];
    return this.hydrateSongDetails(tracks.slice(0, 30).map((t) => this.normalize(t)));
  }

  async getSongDetails(songmids: string[]): Promise<OnlineSong[]> {
    const ids = [...new Set(songmids.map((id) => Number(id)).filter(Number.isFinite))];
    if (ids.length === 0) return [];

    const data = (await this.request('/v3/song/detail', {
      c: JSON.stringify(ids.map((id) => ({ id }))),
      ids: JSON.stringify(ids),
      csrf_token: '',
    })) as { songs?: NetEaseSongRaw[] } | undefined;

    const songs = (data?.songs ?? []).map((song) => this.normalize(song));
    for (const song of songs) {
      this.detailsCache.set(song.songmid, song);
    }
    return songs;
  }

  async getMusicUrl(songmid: string, quality: OnlineQuality): Promise<OnlineUrlResult> {
    const level = QUALITY_MAP[quality] ?? 'exhigh';
    const data = (await this.request('/song/enhance/player/url/v1', {
      ids: [Number(songmid)],
      level,
      encodeType: 'aac',
      csrf_token: '',
    })) as { data?: NetEaseSongUrlEntry[] } | undefined;
    const entry = data?.data?.[0];
    if (!entry?.url) {
      if (entry?.freeTrialInfo) {
        throw new Error('该歌曲仅可试听（登录网易云解锁完整播放）');
      }
      throw new Error('无法获取播放链接（可能为 VIP 歌曲，请在设置中登录网易云）');
    }
    return { url: entry.url, bitrate: String(entry.br ?? 0) };
  }

  async getLyrics(songmid: string): Promise<string | null> {
    if (this.lyricsCache.has(songmid)) {
      return this.lyricsCache.get(songmid) ?? null;
    }

    try {
      const data = (await this.request('/song/lyric', {
        id: Number(songmid),
        lv: -1,
        kv: -1,
        tv: -1,
        csrf_token: '',
      })) as NetEaseLyricResponse | undefined;
      let lyric = this.extractLyrics(data);
      if (!lyric) {
        const fallbackData = (await this.request('/song/lyric', {
          id: Number(songmid),
          lv: 1,
          kv: 1,
          tv: 1,
          csrf_token: '',
        })) as NetEaseLyricResponse | undefined;
        lyric = this.extractLyrics(fallbackData);
      }
      this.lyricsCache.set(songmid, lyric);
      return lyric;
    } catch (err) {
      logger.warn('[NetEase] getLyrics failed:', err);
      this.lyricsCache.set(songmid, null);
      return null;
    }
  }

  private extractLyrics(data: NetEaseLyricResponse | undefined): string | null {
    const candidates = [
      data?.lrc?.lyric,
      data?.yrc?.lyric,
      data?.tlyric?.lyric,
      data?.romalrc?.lyric,
    ];
    const lyric = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
    return lyric?.trim() || null;
  }

  getCoverUrl(song: OnlineSong): string {
    return song.coverUrl || '';
  }

  getRawCookie(): string {
    return neteaseCookieManager.getCookie();
  }

  hasCookie(): boolean {
    return neteaseCookieManager.hasCookie();
  }

  requiresCookie(): boolean {
    // Search / recommendations are anonymous; cookie only unlocks VIP + high quality.
    return false;
  }
}

export const neteaseMusicApi = new NetEaseMusicAPI();
