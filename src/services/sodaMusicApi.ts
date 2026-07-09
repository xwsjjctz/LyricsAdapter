/**
 * Soda Music provider.
 *
 * This adapter uses the endpoint model documented by the AGPL-3.0-or-later
 * music-lib project. Requests, cookies and encrypted-media handling are kept
 * in the Electron main process; see electron/ipc/sodaHandlers.ts.
 */
import { logger } from './logger';
import { sodaCookieManager } from './cookieManager';
import { getDesktopAPI } from './desktopAdapter';
import type {
  OnlineMusicProvider,
  OnlineQuality,
  OnlineSong,
  OnlineUrlResult,
  PlaylistInfo,
} from './onlineMusicProvider';

interface SodaImage {
  urls?: string[];
  uri?: string;
}

interface SodaArtist {
  name?: string;
}

interface SodaAlbum {
  id?: string;
  name?: string;
  url_cover?: SodaImage;
}

interface SodaTrack {
  id?: string;
  name?: string;
  duration?: number;
  artists?: SodaArtist[];
  album?: SodaAlbum;
}

interface SodaPlaylist {
  id?: string;
  title?: string;
  public_title?: string;
  count_tracks?: number;
  resource_cnt?: { track_cnt?: number };
  url_cover?: SodaImage;
}

interface SodaPlaylistPage {
  media_resources?: Array<{
    type?: string;
    entity?: { track_wrapper?: { track?: SodaTrack } };
  }>;
  next_cursor?: string;
  has_more?: boolean;
}

interface SodaPlaylistCursor {
  tracks: OnlineSong[];
  nextCursor: string;
  hasMore: boolean;
}

function makeImageUrl(image: SodaImage | undefined, suffix: string): string | undefined {
  const base = image?.urls?.[0]?.trim();
  if (!base) return undefined;
  const uri = image?.uri?.trim();
  const joined = uri && !base.includes(uri) ? `${base}${uri}` : base;
  return joined.includes('~') ? joined : `${joined}${suffix}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim();
}

function sodaLyricsToLrc(raw: string): string | null {
  const lines: string[] = [];
  for (const source of raw.split('\n')) {
    const match = source.trim().match(/^\[(\d+),(\d+)\](.*)$/);
    if (!match) continue;
    const time = Number(match[1]);
    if (!Number.isFinite(time)) continue;
    const text = match[3]?.replace(/<[^>]+>/g, '') ?? '';
    const minutes = Math.floor(time / 60_000);
    const seconds = Math.floor((time % 60_000) / 1_000);
    const centiseconds = Math.floor((time % 1_000) / 10);
    lines.push(`[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]${text}`);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

class SodaMusicApi implements OnlineMusicProvider {
  readonly id = 'soda' as const;
  private readonly lyricsCache = new Map<string, string | null>();
  private readonly playlistCursors = new Map<string, SodaPlaylistCursor>();

  private async request(
    route: 'search-track' | 'track' | 'me' | 'user-playlists' | 'playlist-detail',
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const desktopAPI = getDesktopAPI();
    if (!desktopAPI?.sodaRequest) {
      throw new Error('汽水音乐仅支持桌面端');
    }
    await sodaCookieManager.ensureLoaded();
    const result = await desktopAPI.sodaRequest(route, params, sodaCookieManager.getCookie());
    if (!result.success) throw new Error(result.error || '汽水音乐请求失败');
    return result.data;
  }

  private normalizeTrack(track: SodaTrack): OnlineSong | null {
    const songmid = track.id?.trim();
    if (!songmid) return null;
    return {
      songmid,
      songname: firstString(track.name, '未知歌曲') ?? '未知歌曲',
      singer: asArray<SodaArtist>(track.artists)
        .map((artist) => ({ name: artist.name?.trim() || '未知歌手' })),
      albumname: track.album?.name?.trim(),
      albummid: track.album?.id?.trim(),
      interval: track.duration && track.duration > 1_000 ? Math.floor(track.duration / 1_000) : track.duration,
      coverUrl: makeImageUrl(track.album?.url_cover, '~c5_375x375.jpg'),
    };
  }

  async searchMusic(query: string, limit = 20): Promise<OnlineSong[]> {
    const data = asRecord(await this.request('search-track', { q: query }));
    const groups = asArray<{ data?: Array<{ entity?: { track?: SodaTrack } }> }>(data?.['result_groups']);
    const tracks = asArray<{ entity?: { track?: SodaTrack } }>(groups[0]?.data);
    return tracks
      .map((item) => this.normalizeTrack(item.entity?.track ?? {}))
      .filter((song): song is OnlineSong => song !== null)
      .slice(0, limit);
  }

  async getRecommendedSongs(): Promise<OnlineSong[]> {
    // The upstream project documents no stable Soda recommendation endpoint.
    return [];
  }

  async getMusicUrl(songmid: string, quality: OnlineQuality): Promise<OnlineUrlResult> {
    // The actual URL resolves and decrypts only in streamProtocol. This method
    // keeps the shared provider contract intact; download flows branch to the
    // dedicated main-process downloader instead of fetching this URL.
    return { url: `stream://soda/${encodeURIComponent(songmid)}?q=${quality}`, bitrate: quality };
  }

  async getLyrics(songmid: string): Promise<string | null> {
    const cached = this.lyricsCache.get(songmid);
    if (cached !== undefined) return cached;
    try {
      const data = asRecord(await this.request('track', { trackId: songmid }));
      const lyric = asRecord(data?.['lyric']);
      const parsed = typeof lyric?.['content'] === 'string' ? sodaLyricsToLrc(lyric['content']) : null;
      this.lyricsCache.set(songmid, parsed);
      return parsed;
    } catch (error) {
      logger.warn('[Soda] getLyrics failed:', error);
      this.lyricsCache.set(songmid, null);
      return null;
    }
  }

  getCoverUrl(song: OnlineSong): string {
    return song.coverUrl || '';
  }

  getRawCookie(): string {
    return sodaCookieManager.getCookie();
  }

  hasCookie(): boolean {
    return sodaCookieManager.hasCookie();
  }

  requiresCookie(): boolean {
    return true;
  }

  private normalizePlaylist(playlist: SodaPlaylist): PlaylistInfo | null {
    const id = playlist.id?.trim();
    if (!id) return null;
    return {
      id,
      name: firstString(playlist.title, playlist.public_title, '未知歌单') ?? '未知歌单',
      coverUrl: makeImageUrl(playlist.url_cover, '~c5_300x300.jpg') || '',
      songCount: playlist.count_tracks ?? playlist.resource_cnt?.track_cnt ?? 0,
      source: 'soda',
    };
  }

  async getPlaylists(): Promise<PlaylistInfo[]> {
    await sodaCookieManager.ensureLoaded();
    if (!sodaCookieManager.hasCookie()) return [];
    const me = asRecord(await this.request('me', {}));
    const myInfo = asRecord(me?.['my_info']);
    const userId = typeof myInfo?.['id'] === 'string' ? myInfo['id'] : '';
    if (!userId) throw new Error('汽水音乐 Cookie 无效或已过期');
    const data = asRecord(await this.request('user-playlists', { userId, count: '100' }));
    return asArray<SodaPlaylist>(data?.['playlists'])
      .map((playlist) => this.normalizePlaylist(playlist))
      .filter((playlist): playlist is PlaylistInfo => playlist !== null);
  }

  async getPlaylistSongs(playlistId: string, offset = 0, limit = 30): Promise<OnlineSong[]> {
    let state = this.playlistCursors.get(playlistId);
    if (!state) {
      state = { tracks: [], nextCursor: '', hasMore: true };
      this.playlistCursors.set(playlistId, state);
    }

    const wanted = offset + limit;
    while (state.hasMore && state.tracks.length < wanted) {
      const data = asRecord(await this.request('playlist-detail', {
        playlistId,
        cursor: state.nextCursor,
        count: String(Math.max(100, limit)),
      })) as SodaPlaylistPage | undefined;
      const items = asArray<{ type?: string; entity?: { track_wrapper?: { track?: SodaTrack } } }>(data?.media_resources);
      const existing = new Set(state.tracks.map((song) => song.songmid));
      for (const item of items) {
        if (item.type !== 'track') continue;
        const song = this.normalizeTrack(item.entity?.track_wrapper?.track ?? {});
        if (song && !existing.has(song.songmid)) {
          existing.add(song.songmid);
          state.tracks.push(song);
        }
      }
      const nextCursor = typeof data?.next_cursor === 'string' ? data.next_cursor : '';
      state.hasMore = data?.has_more === true && Boolean(nextCursor) && nextCursor !== state.nextCursor;
      state.nextCursor = nextCursor;
      if (items.length === 0) state.hasMore = false;
    }
    return state.tracks.slice(offset, offset + limit);
  }
}

export const sodaMusicApi = new SodaMusicApi();
