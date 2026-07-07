import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type { LibrarySlot, SlotId } from '../types';
import { getDesktopAPIAsync } from '../services/desktopAdapter';
import { coverArtService } from '../services/coverArtService';
import { indexedDBStorage } from '../services/indexedDBStorage';
import { logger } from '../services/logger';

/**
 * Library Controller (Phase 2 of the refactor roadmap, §4).
 *
 * Owns library *mutation* intent that previously lived in AppWorkspace:
 * view-slot-aware removal (single + batch), reorder, and track metadata
 * updates. UI components must not call `updateSlot` directly for these
 * operations — they go through this controller.
 *
 * Migration policy (roadmap Rule 1): logic is moved here verbatim from
 * AppWorkspace, not redesigned. The delete API keeps its existing
 * `(trackId, deleteFile = false)` boolean signature; the roadmap §4.3
 * recommendation to split into removeFromLibrary / deleteManagedTrack /
 * deleteCloudTrack is recorded in docs/refactor-backlog.md (RF-006).
 */

export interface LibraryControllerOptions {
  /** Library store state */
  viewSlot: SlotId;
  activeSlotId: SlotId;
  /** Live snapshot ref of all slots (avoids stale closures without re-renders). */
  slotsRef: MutableRefObject<Record<SlotId, LibrarySlot>>;
  /** Mutate a slot's state imperatively (from useLibrarySlots). */
  updateSlot: (slotId: SlotId, updater: (slot: any) => any) => void;

  /** Player store (from usePlayback) */
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  setIsPlaying: (playing: boolean) => void;
  revokeBlobUrl: (blobUrl: string) => void;
}

export function useLibraryController(options: LibraryControllerOptions) {
  const {
    viewSlot,
    activeSlotId,
    slotsRef,
    updateSlot,
    audioRef,
    setIsPlaying,
    revokeBlobUrl,
  } = options;

  // View-slot-aware track removal — operates on slots[viewSlot] instead of
  // slots[activeSlotId]. This ensures deletion works correctly when browsing a
  // different slot than the one playing.
  const removeTrack = useCallback(async (trackId: string, deleteFile = false) => {
    const slotTracks = slotsRef.current[viewSlot].tracks;
    const trackToRemove = slotTracks.find(t => t.id === trackId);

    // Delete physical audio file if requested
    if (deleteFile && trackToRemove?.filePath) {
      const desktopAPI = await getDesktopAPIAsync();
      if (desktopAPI?.deleteAudioFile) {
        try {
          const result = await desktopAPI.deleteAudioFile(trackToRemove.filePath);
          if (result.success && result.deleted) {
            logger.debug(`[App] ✓ Deleted audio file: ${trackToRemove.filePath}`);
          } else if (!result.success) {
            logger.warn(`[App] Failed to delete audio file: ${trackToRemove.filePath}`, result.error);
          }
        } catch (error) {
          logger.warn('[App] deleteAudioFile error:', error);
        }
      }
    }

    // Update the view slot's tracks and currentTrackIndex atomically
    updateSlot(viewSlot, (slot: LibrarySlot) => {
      const newTracks = slot.tracks.filter(t => t.id !== trackId);
      const removedIndex = slot.tracks.findIndex(t => t.id === trackId);
      const removedTrack = slot.tracks[removedIndex];
      let newIndex = slot.currentTrackIndex;

      if (newTracks.length === 0) {
        newIndex = -1;
        if (viewSlot === activeSlotId) {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
          }
          setIsPlaying(false);
        }
      } else if (removedIndex >= 0) {
        if (removedIndex < slot.currentTrackIndex) {
          newIndex = Math.max(0, slot.currentTrackIndex - 1);
        } else if (removedIndex === slot.currentTrackIndex) {
          newIndex = Math.min(slot.currentTrackIndex, newTracks.length - 1);
        }
      }

      if (removedTrack) {
        if (removedTrack.audioUrl?.startsWith('blob:')) revokeBlobUrl(removedTrack.audioUrl);
        if (removedTrack.coverUrl?.startsWith('blob:')) revokeBlobUrl(removedTrack.coverUrl);
      }

      return { ...slot, tracks: newTracks, currentTrackIndex: newIndex };
    });

    // Clean up cover and metadata (trackId-based, independent of slot)
    try {
      await coverArtService.deleteCover(trackId);
      await indexedDBStorage.deleteMetadata(trackId);
      logger.debug(`[App] ✅ Resources cleaned up for track: ${trackToRemove?.title || trackId}`);
    } catch (error) {
      logger.warn('[App] Failed to cleanup resources for track:', error);
    }
  }, [viewSlot, activeSlotId, updateSlot, audioRef, revokeBlobUrl, setIsPlaying, slotsRef]);

  return {
    removeTrack,
  };
}
