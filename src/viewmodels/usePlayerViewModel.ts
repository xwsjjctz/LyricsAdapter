import type { Track } from '../types';

/**
 * Playback mode mirrors the inline union used across the slot model and
 * usePlayback (`'order' | 'shuffle' | 'repeat-one'`).
 */
export type PlaybackMode = 'order' | 'shuffle' | 'repeat-one';

/**
 * Player-facing ViewModel (Phase 4 of the refactor roadmap, §6.3).
 *
 * Repackages the player store + engine into the exact shape UI components
 * consume, so the composition root can hand the application shell a single
 * `player` object instead of threading ~13 separate props into each.
 *
 * This is a thin composition layer — no business logic, no state of its own.
 * `duration` is derived here (previously inlined at each call site as
 * `currentTrack?.duration ?? 0`).
 *
 * `getCurrentPlaybackTime` gives FocusMode sub-frame timing without exposing
 * the media element. The playback engine guards that read with track/source
 * ownership, so a debounced track switch cannot leak the previous song's
 * media clock into the newly selected lyrics.
 */
export interface PlayerViewModel {
  // ---- state reads ----
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackMode: PlaybackMode;
  getCurrentPlaybackTime(): number;

  // ---- intent callbacks ----
  togglePlay(): void;
  next(): void;
  previous(): void;
  seek(time: number): void;
  changeVolume(volume: number): void;
  toggleMute(): void;
  togglePlaybackMode(): void;
}

export interface PlayerViewModelOptions {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  playbackMode: PlaybackMode;
  getCurrentPlaybackTime: () => number;

  togglePlay: () => void;
  skipForward: () => void;
  skipBackward: () => void;
  handleSeek: (time: number) => void;
  handleVolumeChange: (volume: number) => void;
  handleToggleMute: () => void;
  handleTogglePlaybackMode: () => void;
}

export function usePlayerViewModel(opts: PlayerViewModelOptions): PlayerViewModel {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    volume,
    playbackMode,
    getCurrentPlaybackTime,
    togglePlay,
    skipForward,
    skipBackward,
    handleSeek,
    handleVolumeChange,
    handleToggleMute,
    handleTogglePlaybackMode,
  } = opts;

  return {
    currentTrack,
    isPlaying,
    currentTime,
    duration: currentTrack?.duration ?? 0,
    volume,
    playbackMode,
    getCurrentPlaybackTime,

    togglePlay,
    next: skipForward,
    previous: skipBackward,
    seek: handleSeek,
    changeVolume: handleVolumeChange,
    toggleMute: handleToggleMute,
    togglePlaybackMode: handleTogglePlaybackMode,
  };
}
