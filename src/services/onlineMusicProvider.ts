/**
 * Shared abstraction over online music sources (QQ Music, NetEase Cloud Music).
 *
 * The renderer talks to whichever provider the user selected in settings; both
 * implementations normalize their results into the same `OnlineSong` shape so
 * the UI, download/upload flow, and progress tracking stay source-agnostic.
 */
import type { MusicPluginElectronAPI } from '../shared/musicPlugin';
import type { DesktopAPI } from './desktopAdapter';
import { settingsManager } from './settingsManager';
import { qqMusicApi } from './qqMusicApi';
import { neteaseMusicApi } from './neteaseMusicApi';
import { cookieManager, neteaseCookieManager, type CookieStore } from './cookieManager';
import type { QQCredential } from '../shared/qqCredential';
import type { DownloadProgressEvent } from '../types/onlineProgress';

// ---- Shared data model -----------------------------------------------------

export type { OnlineQuality, OnlineSong, OnlineUrlResult, OnlineLyricsResult, OnlineSource, PlaylistInfo, OnlineMusicProvider } from '../shared/onlineMusic';
import type { OnlineSource, OnlineMusicProvider } from '../shared/onlineMusic';

// ---- Electron bridge typing (canonical home for online-music IPC) ----------

/**
 * Main-process APIs used by online music providers. Lives here so both the QQ
 * and NetEase renderer clients share one declaration.
 */
export interface OnlineMusicElectronAPI extends MusicPluginElectronAPI {
  getQQMusicUrl?: (reqData: Record<string, unknown>, cookie: string) => Promise<unknown>;
  qqMusicRequest?: (options: {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    cookie?: string;
  }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  getQQMusicLyrics?: (
    songmid: string,
    cookie: string
  ) => Promise<{
    success: boolean;
    lyrics?: string;
    wordLyrics?: string;
    wordLyricsFormat?: 'qrc';
    error?: string;
  }>;
  /** Generic NetEase weapi request (encryption handled in main process). */
  neteaseRequest?: (
    channel: string,
    params: Record<string, unknown>,
    cookie?: string
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  /** QQ Music QR login — start a session, returns a PNG data URL + session token. */
  qqLoginQrStart?: () => Promise<{
    success: boolean;
    token?: string;
    qrcode?: string;
    expiresIn?: number;
    error?: string;
  }>;
  /** QQ Music QR login — poll a session until done/expired. */
  qqLoginQrPoll?: (
    token: string
  ) => Promise<{
    success: boolean;
    status?: 'waiting' | 'confirming' | 'done' | 'expired' | 'error';
    msg?: string;
    cookie?: string;
    credential?: QQCredential;
    error?: string;
  }>;
  /** QQ Music — exchange the stored refresh key/token for a fresh musickey. */
  qqLoginRefresh?: (
    credential: QQCredential,
    cookie: string
  ) => Promise<{
    success: boolean;
    credential?: QQCredential;
    cookie?: string;
    error?: string;
  }>;
  /** NetEase QR login — request a one-time unikey. */
  neteaseQrKey?: () => Promise<{ success: boolean; unikey?: string; error?: string }>;
  /** NetEase QR login — render the QR for a key as a PNG data URL. */
  neteaseQrCreate?: (key: string) => Promise<{ success: boolean; qrcode?: string; error?: string }>;
  /** NetEase QR login — poll a key. code 800=expired 801=waiting 802=confirming 803=success. */
  neteaseQrCheck?: (
    key: string
  ) => Promise<{
    success: boolean;
    code?: number;
    message?: string;
    cookie?: string;
    error?: string;
  }>;
  /** Push a QQ / NetEase cookie to main-process memory for the streaming proxy. */
  setOnlineCookie?: (source: string, cookie: string) => Promise<void>;
  downloadAudioFile?: (
    url: string,
    cookie: string
  ) => Promise<{ success: boolean; data?: number[] | ArrayBuffer; error?: string }>;
  downloadAndSave?: (
    url: string,
    cookie: string,
    filePath: string,
    requestId?: string
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
    callback: (progress: DownloadProgressEvent) => void
  ) => void;
  offDownloadProgress?: (
    callback: (progress: DownloadProgressEvent) => void
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
  if (active === 'netease') return neteaseMusicApi;
  return qqMusicApi;
}

/**
 * Cookie store for the active source. Used by the settings UI to read/write the
 * source-specific cookie. (NetEase search works without a cookie; this is only
 * needed for the optional login that unlocks VIP/high-quality playback.)
 */
export function getActiveCookieManager(source?: OnlineSource): CookieStore {
  const active: OnlineSource = source ?? settingsManager.getOnlineSource();
  if (active === 'netease') return neteaseCookieManager;
  return cookieManager;
}
