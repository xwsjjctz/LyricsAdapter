import type { MutableRefObject } from 'react';
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
 * consume, so AppWorkspace can hand both shells (Legacy + NewUx) a single
 * `player` object instead of threading ~13 separate props into each.
 *
 * This is a thin composition layer — no business logic, no state of its own.
 * `duration` is derived here (previously inlined at each call site as
 * `currentTrack?.duration ?? 0`).
 *
 * `audioRef` is exposed as an escape hatch for slice 1 only: FocusMode's
 * requestAnimationFrame lyrics loop needs sub-frame timing that the React
 * `currentTime` state cannot provide. Encapsulating it (e.g. behind a
 * `subscribeTime(cb)` API) is deferred — see docs/refactor-backlog.md.
 */
export interface PlayerViewModel {
  // ---- state reads ----
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackMode: PlaybackMode;
  audioRef: MutableRefObject<HTMLAudioElement | null>;

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
  audioRef: MutableRefObject<HTMLAudioElement | null>;

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
    audioRef,
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
    audioRef,

    togglePlay,
    next: skipForward,
    previous: skipBackward,
    seek: handleSeek,
    changeVolume: handleVolumeChange,
    toggleMute: handleToggleMute,
    togglePlaybackMode: handleTogglePlaybackMode,
  };
}
