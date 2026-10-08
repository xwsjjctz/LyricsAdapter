export type OnlineQuality = '128' | '320' | 'flac' | 'm4a';

/**
 * A song returned by an online source. Field names mirror the original
 * QQ Music shape (kept stable) so existing UI rows work unchanged.
 */
export interface OnlineSong {
  /** Unique id — QQ `songmid` or NetEase numeric id (as string). */
  songmid: string;
  songname: string;
  singer: { name: string; mid?: string | undefined }[];
  albumname?: string | undefined;
  albummid?: string | undefined;
  /** Duration in seconds. */
  interval?: number | undefined;
  coverUrl?: string | undefined;
  coverUrlFullSize?: string | undefined;
  /** QQ media file id; can differ from songmid and names the audio file to request. */
  mediaMid?: string | undefined;
}

export interface OnlineUrlResult {
  url: string;
  bitrate: string;
  /** The quality actually served, which can be lower than requested. */
  quality: OnlineQuality;
}

/** A provider lyric response with an LRC fallback and optional karaoke payload. */
export interface OnlineLyricsResult {
  /** Plain or line-synchronised lyric text for metadata embedding and fallback UI. */
  lyrics: string;
  /** Provider-native character/word-timed lyric text. */
  wordLyrics?: string | undefined;
  wordLyricsFormat?: 'qrc' | 'yrc' | undefined;
}

export type OnlineSource = 'qq' | 'netease';

export interface PlaylistInfo {
  id: string;
  name: string;
  coverUrl: string;
  songCount: number;
  source: OnlineSource;
}

export interface OnlineMusicProvider {
  readonly id: OnlineSource;
  searchMusic(query: string, limit?: number): Promise<OnlineSong[]>;
  getRecommendedSongs(): Promise<OnlineSong[]>;
  /** Optional batch metadata hydration for sources whose search result is sparse. */
  getSongDetails?(songmids: string[]): Promise<OnlineSong[]>;
  getMusicUrl(songmid: string, quality: OnlineQuality, mediaMid?: string): Promise<OnlineUrlResult>;
  getLyrics(songmid: string): Promise<OnlineLyricsResult | null>;
  /** Full-size cover URL for the song (used when embedding metadata). */
  getCoverUrl(song: OnlineSong): string;
  /** Login cookie for this source (empty when not set / anonymous). */
  getRawCookie(): string;
  hasCookie(): boolean;
  /** Whether features are gated behind a login cookie (QQ: yes, NetEase: no). */
  requiresCookie(): boolean;
  /** Fetch the user's playlists (or popular playlists when not logged in). */
  getPlaylists(): Promise<PlaylistInfo[]>;
  /** Fetch songs in a specific playlist. */
  getPlaylistSongs(playlistId: string, offset?: number, limit?: number): Promise<OnlineSong[]>;
}

