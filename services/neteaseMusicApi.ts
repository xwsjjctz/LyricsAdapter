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
  al?: { id?: number; name?: string; picUrl?: string };
  album?: { id?: number; name?: string; picUrl?: string };
  dt?: number;
  duration?: number;
}

interface NetEaseSongUrlEntry {
  url: string | null;
  br?: number;
  freeTrialInfo?: unknown;
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
      coverUrl: album?.picUrl,
    };
  }

  async searchMusic(query: string, limit = 20): Promise<OnlineSong[]> {
    const data = (await this.request('/search/get', {
      s: query,
      type: 1,
      limit,
      offset: 0,
    })) as { result?: { songs?: NetEaseSongRaw[] } } | undefined;
    const songs = data?.result?.songs ?? [];
    return songs.map((s) => this.normalize(s));
  }

  async getRecommendedSongs(): Promise<OnlineSong[]> {
    const data = (await this.request('/v6/playlist/detail', {
      id: HOT_PLAYLIST_ID,
      n: 30,
      s: 0,
    })) as { playlist?: { tracks?: NetEaseSongRaw[] } } | undefined;
    const tracks = data?.playlist?.tracks ?? [];
    return tracks.slice(0, 30).map((t) => this.normalize(t));
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
    try {
      const data = (await this.request('/song/lyric', {
        id: Number(songmid),
        lv: -1,
        kv: -1,
        tv: -1,
        csrf_token: '',
      })) as { lrc?: { lyric?: string } } | undefined;
      return data?.lrc?.lyric || null;
    } catch (err) {
      logger.warn('[NetEase] getLyrics failed:', err);
      return null;
    }
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
