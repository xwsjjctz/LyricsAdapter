import { useCallback } from 'react';
import type { Track } from '../types';
import type { OnlineSong, OnlineSource } from '../services/onlineMusicProvider';
import type { OnlineQuality } from '../services/onlineMusicProvider';
import { trackToOnlineSong } from '../domain/trackFactory';
import type { OnlineProgressEntry } from '../types/onlineProgress';

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

export interface OnlineViewModel {
  /** Download progress keyed by the online track id (provider + songmid). */
  progress: Record<string, OnlineProgressEntry>;

  /** Stream-play an OnlineSong immediately (no download). */
  playSong(song: OnlineSong, source?: OnlineSource): void;
  /** Add an OnlineSong to the online list without playing it. */
  addSong(song: OnlineSong, source: OnlineSource): void;
  /** Download a song to the local download folder. */
  download(song: OnlineSong, quality: OnlineQuality, source?: OnlineSource): Promise<void>;
  /** Download a list track from its own provider; non-online tracks are ignored. */
  downloadTrack(track: Track, quality: OnlineQuality): void;
  /** Upload a song to WebDAV. */
  upload(song: OnlineSong, quality: OnlineQuality): Promise<void>;
  /** Navigate to + play a local/cloud track found via global search. */
  navigateToTrack(track: Track): void;
}

export interface OnlineViewModelOptions {
  progress: Record<string, OnlineProgressEntry>;
  playSong: (song: OnlineSong, source?: OnlineSource) => void;
  addSong: (song: OnlineSong, source: OnlineSource) => void;
  download: (song: OnlineSong, quality: OnlineQuality, source?: OnlineSource) => Promise<void>;
  upload: (song: OnlineSong, quality: OnlineQuality) => Promise<void>;
  navigateToTrack: (track: Track) => void;
}

export function useOnlineViewModel(opts: OnlineViewModelOptions): OnlineViewModel {
  const {
    progress,
    playSong,
    addSong,
    download,
    upload,
    navigateToTrack,
  } = opts;

  const downloadTrack = useCallback((track: Track, quality: OnlineQuality) => {
    const resolved = trackToOnlineSong(track);
    if (resolved) void download(resolved.song, quality, resolved.source);
  }, [download]);

  return {
    progress,
    playSong,
    addSong,
    download,
    downloadTrack,
    upload,
    navigateToTrack,
  };
}
