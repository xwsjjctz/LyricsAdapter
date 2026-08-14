import type { Track } from '../types';
import type { OnlineSong, OnlineSource } from '../services/onlineMusicProvider';
import type { OnlineQuality } from '../services/onlineMusicProvider';

/**
 * Online-music-facing ViewModel (Phase 4 follow-up, roadmap §6.2).
 *
 * Repackages the online-music surface — currently split between
 * usePlayerController (stream play, open playlist, search navigate) and
 * useOnlineMusicIntegration (download/upload + progress) — into a single
 * object the application shell can consume.
 *
 * Thin composition only: no business logic, no state of its own beyond the
 * progress map. The underlying controller/hook stay untouched.
 */

export interface OnlineProgressEntry {
  type: 'download' | 'upload';
  percent: number;
}

export interface OnlineViewModel {
  /** Live download/upload progress keyed by songmid. */
  progress: Record<string, OnlineProgressEntry>;

  /** Stream-play an OnlineSong immediately (no download). */
  playSong(song: OnlineSong, source?: OnlineSource): void;
  /** Download a song to the local download folder. */
  download(song: OnlineSong, quality: OnlineQuality): Promise<void>;
  /** Upload a song to WebDAV. */
  upload(song: OnlineSong, quality: OnlineQuality): Promise<void>;
  /** Navigate to + play a local/cloud track found via global search. */
  navigateToTrack(track: Track): void;
}

export interface OnlineViewModelOptions {
  progress: Record<string, OnlineProgressEntry>;
  playSong: (song: OnlineSong, source?: OnlineSource) => void;
  download: (song: OnlineSong, quality: OnlineQuality) => Promise<void>;
  upload: (song: OnlineSong, quality: OnlineQuality) => Promise<void>;
  navigateToTrack: (track: Track) => void;
}

export function useOnlineViewModel(opts: OnlineViewModelOptions): OnlineViewModel {
  const {
    progress,
    playSong,
    download,
    upload,
    navigateToTrack,
  } = opts;

  return {
    progress,
    playSong,
    download,
    upload,
    navigateToTrack,
  };
}
