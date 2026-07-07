import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type { LibrarySlot, SlotId, Track } from '../types';
import { getDesktopAPIAsync } from '../services/desktopAdapter';
import { coverArtService } from '../services/coverArtService';
import { indexedDBStorage } from '../services/indexedDBStorage';
import { logger } from '../services/logger';
import { reorderTracks } from '../services/libraryReorder';
import { buildLibraryIndexDataForSlots } from '../services/librarySerializer';
import { libraryStorage } from '../services/libraryStorage';
import type { LibrarySettings } from '../services/libraryStorage';

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
  /** All slots (read by reorder for persist serialization). */
  slots: Record<SlotId, LibrarySlot>;
  /** Live snapshot ref of all slots (avoids stale closures without re-renders). */
  slotsRef: MutableRefObject<Record<SlotId, LibrarySlot>>;
  /** Mutate a slot's state imperatively (from useLibrarySlots). */
  updateSlot: (slotId: SlotId, updater: (slot: any) => any) => void;
  /** Build the persistence payload (from AppWorkspace). */
  getAppPersistenceData: () => LibrarySettings;

  /** Player store (from usePlayback) */
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  setIsPlaying: (playing: boolean) => void;
  revokeBlobUrl: (blobUrl: string) => void;
}

export function useLibraryController(options: LibraryControllerOptions) {
  const {
    viewSlot,
    activeSlotId,
    slots,
    slotsRef,
    updateSlot,
    getAppPersistenceData,
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

  const removeTracks = useCallback(async (trackIds: string[], deleteFile = false) => {
    const slotTracks = slotsRef.current[viewSlot].tracks;
    const tracksToRemove = slotTracks.filter(t => trackIds.includes(t.id));

    const desktopAPI = await getDesktopAPIAsync();

    // Delete physical audio files
    if (deleteFile && desktopAPI?.deleteAudioFile) {
      for (const track of tracksToRemove) {
        if (!track.filePath) continue;
        try {
          const result = await desktopAPI.deleteAudioFile(track.filePath);
          if (result.success && result.deleted) {
            logger.debug(`[App] ✓ Deleted audio file: ${track.filePath}`);
          } else if (!result.success) {
            logger.warn(`[App] Failed to delete audio file: ${track.filePath}`, result.error);
          }
        } catch (error) {
          logger.warn('[App] deleteAudioFile error:', error);
        }
      }
    }

    // Revoke blob URLs and clean up cover thumbnails & metadata
    for (const track of tracksToRemove) {
      if (track.audioUrl?.startsWith('blob:')) revokeBlobUrl(track.audioUrl);
      if (track.coverUrl?.startsWith('blob:')) revokeBlobUrl(track.coverUrl);
    }

    if (desktopAPI?.deleteCoverThumbnail) {
      for (const track of tracksToRemove) {
        try {
          await desktopAPI.deleteCoverThumbnail(track.id);
        } catch (error) {
          logger.warn(`[App] Failed to delete cover thumbnail for ${track.title}:`, error);
        }
      }
    }

    for (const trackId of trackIds) {
      try {
        await indexedDBStorage.deleteMetadata(trackId);
      } catch (error) {
        logger.warn(`[App] Failed to delete metadata for ${trackId}:`, error);
      }
    }

    // Update the view slot's tracks and currentTrackIndex atomically
    updateSlot(viewSlot, (slot: LibrarySlot) => {
      const newTracks = slot.tracks.filter(t => !trackIds.includes(t.id));

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
      } else {
        const removedBeforeCurrent = trackIds.filter(id => {
          const idx = slot.tracks.findIndex(t => t.id === id);
          return idx >= 0 && idx < slot.currentTrackIndex;
        }).length;
        newIndex = slot.currentTrackIndex - removedBeforeCurrent;
        if (newIndex >= newTracks.length) newIndex = Math.max(0, newTracks.length - 1);
        if (newIndex < 0) newIndex = 0;
      }

      return { ...slot, tracks: newTracks, currentTrackIndex: newIndex };
    });

    logger.debug(`[App] ✓ Batch removal complete: ${trackIds.length} tracks removed from ${viewSlot}`);
  }, [viewSlot, activeSlotId, updateSlot, audioRef, revokeBlobUrl, setIsPlaying, slotsRef]);

  const reorderTracksHandler = useCallback(async (fromIndex: number, toIndex: number) => {
    logger.debug(`[App] Reordering ${viewSlot} track from ${fromIndex} to ${toIndex}`);
    const sourceSlot = slots[viewSlot];
    const result = reorderTracks(sourceSlot.tracks, sourceSlot.currentTrackIndex, fromIndex, toIndex);
    if (!result.changed) return;

    updateSlot(viewSlot, slot => ({
      ...slot,
      tracks: result.tracks,
      currentTrackIndex: result.currentTrackIndex,
    }));

    const persistData = getAppPersistenceData();
    const libraryData = buildLibraryIndexDataForSlots(
      viewSlot === 'local' ? result.tracks : slots.local.tracks,
      viewSlot === 'cloud' ? result.tracks : slots.cloud.tracks,
      persistData,
      viewSlot === 'online' ? result.tracks : slots.online.tracks,
      viewSlot === 'playlist' ? result.tracks : slots.playlist.tracks
    );
    await libraryStorage.saveLibrary(libraryData);
    logger.debug('[App] Library saved after reordering');
  }, [getAppPersistenceData, slots, updateSlot, viewSlot]);

  // Update a single track's metadata in the view slot. Equivalent to the
  // inline `(track) => updateSlot(viewSlot, s => ({ ...s, tracks: s.tracks.map(...) }))`
  // that previously appeared at the NewUxShell + LibraryView call sites.
  // NOTE: the MetadataView call site updates the *active* slot (setActiveTracks),
  // not viewSlot, so it deliberately stays out of this controller — see backlog.
  const updateTrack = useCallback((track: Track) => {
    updateSlot(viewSlot, (s: LibrarySlot) => ({ ...s, tracks: s.tracks.map(t => t.id === track.id ? track : t) }));
  }, [viewSlot, updateSlot]);

  return {
    removeTrack,
    removeTracks,
    reorderTracks: reorderTracksHandler,
    updateTrack,
  };
}
