import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type { SlotId, Track } from '../types';

/**
 * Player Controller (Phase 1 of the refactor roadmap).
 *
 * Owns playback *intent* orchestration that previously lived in AppWorkspace:
 * cross-slot selection, search-result navigation, online stream play and
 * playlist play. It does NOT own the <audio> lifecycle, URL resolution, or
 * error recovery — those stay in usePlayback.
 *
 * Migration policy (roadmap Rule 1): logic is moved here verbatim from
 * AppWorkspace, not redesigned. Dep arrays are reproduced exactly to avoid
 * accidental behaviour changes; any known dep-array gaps are recorded in
 * docs/refactor-backlog.md rather than fixed here.
 */

export interface PlayerControllerOptions {
  /** Library store state */
  activeSlotId: SlotId;
  viewSlot: SlotId;
  /** Local/cloud tracks, read by global-search navigation. */
  localTracks: Track[];
  cloudTracks: Track[];
  /** Set the slot the library panel is browsing. */
  setViewSlot: (slotId: SlotId) => void;
  /** Mutate a slot's state imperatively (from useLibrarySlots). */
  updateSlot: (slotId: SlotId, updater: (slot: any) => any) => void;
  /** Switch the active play context to another slot (from useLibrarySlots). */
  switchTo: (slotId: SlotId) => void;

  /** Player store (from usePlayback) */
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  shouldAutoPlayRef: MutableRefObject<boolean>;
  selectTrack: (index: number) => void;
  setIsPlaying: (playing: boolean) => void;
  /** From playerStore (not usePlayback). */
  setRestoreTime: (time: number) => void;

  /** UI store */
  markTrackSwitch: () => void;
}

export function usePlayerController(options: PlayerControllerOptions) {
  const {
    activeSlotId,
    viewSlot,
    localTracks,
    cloudTracks,
    setViewSlot,
    updateSlot,
    switchTo,
    audioRef,
    shouldAutoPlayRef,
    selectTrack,
    setIsPlaying,
    setRestoreTime,
    markTrackSwitch,
  } = options;

  // Track selection handler that handles cross-slot selection.
  // `targetSlotId` lets New-UI callers state explicitly which slot the clicked
  // row belongs to (the open panel may show local/cloud tracks while the active
  // play context is the 'playlist' slot — e.g. after opening a third-party
  // playlist card). Legacy callers omit it and fall back to viewSlot.
  const handleTrackSelect = useCallback((trackIndex: number, targetSlotId?: SlotId) => {
    const playSlot = targetSlotId ?? viewSlot;

    if (playSlot === activeSlotId) {
      selectTrack(trackIndex);
      return;
    }

    // Cross-slot: save playing slot's time, switch active slot, then play.
    updateSlot(activeSlotId, s => ({ ...s, currentTime: audioRef.current?.currentTime || 0 }));
    updateSlot(playSlot, s => ({ ...s, currentTrackIndex: trackIndex }));
    setRestoreTime(0);
    markTrackSwitch();
    switchTo(playSlot);
    shouldAutoPlayRef.current = true;
    setIsPlaying(true);
  }, [viewSlot, activeSlotId, selectTrack, updateSlot, switchTo, setIsPlaying, audioRef, markTrackSwitch]);

  // Global-search navigation: locate a track in local/cloud, then play it.
  // Same active+view slot → simple selection; cross-slot → save time, switch
  // active slot, autoplay; cross-view only → select and sync the view below.
  const handleSearchNavigate = useCallback((track: Track) => {
    const targetSlot: 'local' | 'cloud' = track.source === 'webdav' ? 'cloud' : 'local';
    const targetTracks = targetSlot === 'local' ? localTracks : cloudTracks;
    const idx = targetTracks.findIndex(t => t.id === track.id);
    if (idx < 0) return;
    if (targetSlot === activeSlotId && targetSlot === viewSlot) {
      // Same slot, same view: simple track selection
      selectTrack(idx);
      return;
    }
    // Cross-slot or cross-view: save playing slot's time, update target, switch
    if (targetSlot !== activeSlotId) {
      updateSlot(activeSlotId, s => ({ ...s, currentTime: audioRef.current?.currentTime || 0 }));
      updateSlot(targetSlot, s => ({ ...s, currentTrackIndex: idx }));
      setRestoreTime(0);
      switchTo(targetSlot);
      shouldAutoPlayRef.current = true;
      setIsPlaying(true);
    } else {
      // Same slot, different view: just select track (view will sync below)
      selectTrack(idx);
    }
    // Sync view to match the playing slot
    setViewSlot(targetSlot);
  }, [activeSlotId, viewSlot, localTracks, cloudTracks, selectTrack, audioRef, updateSlot, switchTo, setIsPlaying]);

  return {
    handleTrackSelect,
    handleSearchNavigate,
  };
}
