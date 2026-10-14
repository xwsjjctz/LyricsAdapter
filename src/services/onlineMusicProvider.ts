/**
 * Shared abstraction over online music sources (any enabled music plugin).
 *
 * The renderer talks to whichever provider the user selected in settings; every
 * plugin normalizes its results into the same `OnlineSong` shape so the UI,
 * download/upload flow, and progress tracking stay source-agnostic.
 */
import type { MusicPluginElectronAPI } from '../shared/musicPlugin';
import { settingsManager } from './settingsManager';
import type { CookieStore } from './cookieManager';
import { cookieStoreFor, providerFor } from './musicSources';
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
  downloadAndSave?: (
    url: string,
    cookie: string,
    filePath: string,
    requestId?: string
  ) => Promise<{ success: boolean; filePath?: string; size?: number; error?: string }>;
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


// ---- Provider selector ----------------------------------------------------

/** The provider for a source, or for the source selected in settings. */
export function getOnlineProvider(source?: OnlineSource): OnlineMusicProvider {
  return providerFor(source ?? settingsManager.getOnlineSource());
}

/** Cookie store for a source, or for the source selected in settings. */
export function getActiveCookieManager(source?: OnlineSource): CookieStore {
  return cookieStoreFor(source ?? settingsManager.getOnlineSource());
}
