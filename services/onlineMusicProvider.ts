/**
 * Shared abstraction over online music sources (QQ Music, NetEase Cloud Music).
 *
 * The renderer talks to whichever provider the user selected in settings; both
 * implementations normalize their results into the same `OnlineSong` shape so
 * the UI, download/upload flow, and progress tracking stay source-agnostic.
 */
import type { DesktopAPI } from './desktopAdapter';
import { settingsManager } from './settingsManager';
import { qqMusicApi } from './qqMusicApi';
import { neteaseMusicApi } from './neteaseMusicApi';
import { cookieManager, neteaseCookieManager, type CookieStore } from './cookieManager';

// ---- Shared data model -----------------------------------------------------

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
}

export interface OnlineUrlResult {
  url: string;
  bitrate: string;
}

export type OnlineSource = 'qq' | 'netease';

export interface OnlineMusicProvider {
  readonly id: OnlineSource;
  searchMusic(query: string, limit?: number): Promise<OnlineSong[]>;
  getRecommendedSongs(): Promise<OnlineSong[]>;
  /** Optional batch metadata hydration for sources whose search result is sparse. */
  getSongDetails?(songmids: string[]): Promise<OnlineSong[]>;
  getMusicUrl(songmid: string, quality: OnlineQuality): Promise<OnlineUrlResult>;
  getLyrics(songmid: string): Promise<string | null>;
  /** Full-size cover URL for the song (used when embedding metadata). */
  getCoverUrl(song: OnlineSong): string;
  /** Login cookie for this source (empty when not set / anonymous). */
  getRawCookie(): string;
  hasCookie(): boolean;
  /** Whether features are gated behind a login cookie (QQ: yes, NetEase: no). */
  requiresCookie(): boolean;
}

// ---- Electron bridge typing (canonical home for online-music IPC) ----------

/**
 * Main-process APIs used by online music providers. Lives here so both the QQ
 * and NetEase renderer clients share one declaration.
 */
export interface OnlineMusicElectronAPI {
  getQQMusicUrl?: (reqData: Record<string, unknown>, cookie: string) => Promise<unknown>;
  getQQMusicLyrics?: (
    songmid: string,
    cookie: string
  ) => Promise<{ success: boolean; lyrics?: string; error?: string }>;
  /** Generic NetEase weapi request (encryption handled in main process). */
  neteaseRequest?: (
    channel: string,
    params: Record<string, unknown>,
    cookie?: string
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  downloadAudioFile?: (
    url: string,
    cookie: string
  ) => Promise<{ success: boolean; data?: number[] | ArrayBuffer; error?: string }>;
  downloadAndSave?: (
    url: string,
    cookie: string,
    filePath: string
  ) => Promise<{ success: boolean; filePath?: string; size?: number; error?: string }>;
  saveFileToPath?: (
    dirPath: string,
    fileName: string,
    fileData: ArrayBuffer
  ) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  writeAudioMetadata?: (
    filePath: string,
    metadata: {
      title?: string;
      artist?: string;
      album?: string;
      lyrics?: string;
      coverUrl?: string;
    }
  ) => Promise<{ success: boolean; error?: string }>;
  onDownloadProgress?: (
    callback: (progress: { downloaded: number; total: number; progress: number }) => void
  ) => void;
  offDownloadProgress?: (
    callback: (progress: { downloaded: number; total: number; progress: number }) => void
  ) => void;
  fetchCoverBase64?: (
    coverUrl: string
  ) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
}

declare global {
  interface Window {
    electron?: DesktopAPI & OnlineMusicElectronAPI;
  }
}

// ---- Provider selector ----------------------------------------------------

/**
 * Returns the active provider based on the user's online-source setting.
 * Static value imports here are safe because each implementation only has a
 * *type-only* dependency back on this module (erased at runtime), so there is
 * no runtime import cycle.
 */
export function getOnlineProvider(source?: OnlineSource): OnlineMusicProvider {
  const active: OnlineSource = source ?? settingsManager.getOnlineSource();
  return active === 'netease' ? neteaseMusicApi : qqMusicApi;
}

/**
 * Cookie store for the active source. Used by the settings UI to read/write the
 * source-specific cookie. (NetEase search works without a cookie; this is only
 * needed for the optional login that unlocks VIP/high-quality playback.)
 */
export function getActiveCookieManager(source?: OnlineSource): CookieStore {
  const active: OnlineSource = source ?? settingsManager.getOnlineSource();
  return active === 'netease' ? neteaseCookieManager : cookieManager;
}
