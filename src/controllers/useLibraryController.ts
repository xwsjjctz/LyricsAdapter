import { useCallback } from 'react';
import { isDesktop } from '../services/desktopAdapter';
import { requestLibraryFlush } from '../services/libraryFlushEvent';
import type { MutableRefObject } from 'react';
import type { LibrarySlot, SlotId, Track } from '../types';
import { coverArtService } from '../services/coverArtService';
import { metadataCacheService } from '../services/metadataCacheService';
import { logger } from '../services/logger';
import { reorderTracks, swapTracks } from '../services/libraryReorder';
import { buildLibraryIndexDataForSlots } from '../services/librarySerializer';
import { libraryStorage } from '../services/libraryStorage';
import type { LibrarySettings } from '../services/libraryStorage';

/**
 * Library Controller (Phase 2 of the refactor roadmap, §4).
 *
 * Owns library *mutation* intent that previously lived in the renderer
 * composition root:
 * view-slot-aware removal (single + batch), reorder, and track metadata
 * updates. UI components must not call `updateSlot` directly for these
 * operations — they go through this controller.
 *
 * Removal only changes library records and unreferenced application caches.
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
  /** Replace the local slot's tracks (from useLibrarySlots). */
  updateLocalTracks: (tracks: Track[]) => void;
  /** Build the persistence payload (from the composition root). */
  getAppPersistenceData: () => LibrarySettings;

  /** Player store (from usePlayback) */
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  setIsPlaying: (playing: boolean) => void;
  pausePlayback?: () => void;
  revokeBlobUrl: (blobUrl: string) => void;
}

export function useLibraryController(options: LibraryControllerOptions) {
  const {
    viewSlot,
    activeSlotId,
    slots,
    slotsRef,
    updateSlot,
    updateLocalTracks,
    getAppPersistenceData,
    audioRef,
    setIsPlaying,
    pausePlayback,
    revokeBlobUrl,
  } = options;

  const removeTracks = useCallback(async (trackIds: string[]) => {
    const ids = new Set(trackIds);
    const snapshot = slotsRef.current;
    const source = snapshot[viewSlot];
    const removed = source.tracks.filter(track => ids.has(track.id));
    if (removed.length === 0) return;

    const removeFromSlot = (slot: LibrarySlot): LibrarySlot => {
      const remaining = slot.tracks.filter(track => !ids.has(track.id));
      const current = slot.tracks[slot.currentTrackIndex];
      const currentRemoved = current != null && ids.has(current.id);
      const removedBefore = slot.tracks.slice(0, Math.max(0, slot.currentTrackIndex))
        .filter(track => ids.has(track.id)).length;
      const currentTrackIndex = remaining.length === 0 || !current ? -1
        : currentRemoved ? Math.min(slot.currentTrackIndex - removedBefore, remaining.length - 1)
        : remaining.findIndex(track => track.id === current.id);
      return { ...slot, tracks: remaining, currentTrackIndex,
        currentTime: currentRemoved || !remaining.length ? 0 : slot.currentTime };
    };
    const next = removeFromSlot(source);
    const persistData = { ...getAppPersistenceData(),
      [`${viewSlot}Slot`]: { ...next, tracks: undefined, id: undefined } };
    const libraryData = buildLibraryIndexDataForSlots(
      viewSlot === 'local' ? next.tracks : snapshot.local.tracks,
      viewSlot === 'cloud' ? next.tracks : snapshot.cloud.tracks,
      persistData,
      viewSlot === 'online' ? next.tracks : snapshot.online.tracks,
      viewSlot === 'playlist' ? next.tracks : snapshot.playlist.tracks,
    );
    // Use the serialized writer and replace any pending pre-removal snapshot.
    // A failed write leaves both the visible library and caches intact.
    if (isDesktop() && !await libraryStorage.flushPendingSave(libraryData)) {
      throw new Error('Could not save library removal');
    }

    const live = slotsRef.current[viewSlot];
    const current = live.tracks[live.currentTrackIndex];
    if (viewSlot === activeSlotId && current && ids.has(current.id)) {
      if (pausePlayback) pausePlayback();
      else audioRef.current?.pause();
      if (audioRef.current) audioRef.current.src = '';
      setIsPlaying(false);
    }
    updateSlot(viewSlot, removeFromSlot);
    // Keep sequential removals correct before the next React render.
    slotsRef.current = { ...slotsRef.current, [viewSlot]: removeFromSlot(live) };

    // The existing persistence owner also updates durable user records in SQLite.
    // Keep caches if that flush fails; runtime/close persistence can retry safely.
    if (isDesktop() && !await requestLibraryFlush()) {
      logger.warn('[Library] User-state flush failed after removal; retaining caches for retry');
      return;
    }
    const remaining = Object.values(slotsRef.current).flatMap(slot => slot.tracks);
    const referencedIds = new Set(remaining.map(track => track.id));
    const referencedUrls = new Set(remaining.flatMap(track => [track.audioUrl, track.coverUrl]));
    const referencedCovers = new Set(remaining.map(track => track.coverUrl?.split('?')[0]));
    for (const track of removed) {
      for (const url of [track.audioUrl, track.coverUrl]) {
        if (url?.startsWith('blob:') && !referencedUrls.has(url) && audioRef.current?.src !== url) revokeBlobUrl(url);
      }
      if (referencedIds.has(track.id)) continue;
      try {
        if (!track.coverUrl || !referencedCovers.has(track.coverUrl.split('?')[0])) {
          await coverArtService.deleteCover(track.id);
        }
        await metadataCacheService.delete(track.id);
      } catch (error) {
        logger.warn('[Library] Failed to clean unused track cache:', error);
      }
    }
  }, [viewSlot, activeSlotId, updateSlot, audioRef, revokeBlobUrl, setIsPlaying, slotsRef, getAppPersistenceData, pausePlayback]);

  const removeTrack = useCallback((trackId: string) => removeTracks([trackId]), [removeTracks]);

  const applyOrder = useCallback(async (result: ReturnType<typeof reorderTracks>) => {
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

  const reorderTracksHandler = useCallback(async (fromIndex: number, toIndex: number) => {
    logger.debug(`[App] Reordering ${viewSlot} track from ${fromIndex} to ${toIndex}`);
    const sourceSlot = slots[viewSlot];
    await applyOrder(reorderTracks(sourceSlot.tracks, sourceSlot.currentTrackIndex, fromIndex, toIndex));
  }, [applyOrder, slots, viewSlot]);

  const swapTracksHandler = useCallback(async (firstIndex: number, secondIndex: number) => {
    logger.debug(`[App] Swapping ${viewSlot} tracks ${firstIndex} <-> ${secondIndex}`);
    const sourceSlot = slots[viewSlot];
    await applyOrder(swapTracks(sourceSlot.tracks, sourceSlot.currentTrackIndex, firstIndex, secondIndex));
  }, [applyOrder, slots, viewSlot]);

  // Update a single track's metadata in the view slot. Equivalent to the
  // inline `(track) => updateSlot(viewSlot, s => ({ ...s, tracks: s.tracks.map(...) }))`
  // that previously appeared at multiple LibraryView call sites.
  const updateTrack = useCallback((track: Track) => {
    updateSlot(viewSlot, (s: LibrarySlot) => ({ ...s, tracks: s.tracks.map(t => t.id === track.id ? track : t) }));
  }, [viewSlot, updateSlot]);

  // Add a freshly downloaded track to the local slot. Dedupes by filePath,
  // appends, persists the metadata cache, and saves the library index
  // immediately (not debounced). Moved verbatim from the former composition root.
  const addDownloadedTrack = useCallback(async (track: Track) => {
    logger.debug('[App] Download complete, adding track to library:', track.title);
    const existingTrack = slots.local.tracks.find(t => t.filePath === track.filePath);
    if (existingTrack) {
      logger.debug('[App] Track already exists in library, skipping:', track.title);
      return;
    }
    const newTracks = [...slots.local.tracks, track];
    updateLocalTracks(newTracks);
    logger.debug('[App] Track added to library:', track.title);
    await metadataCacheService.save();
    const persistData = getAppPersistenceData();
    const libraryData = buildLibraryIndexDataForSlots(newTracks, slots.cloud.tracks, persistData, slots.online.tracks, slots.playlist.tracks);
    await libraryStorage.saveLibrary(libraryData);
    logger.debug('[App] Library saved after download');
  }, [slots.local.tracks, slots.cloud.tracks, slots.online.tracks, slots.playlist.tracks, updateLocalTracks, getAppPersistenceData]);

  return {
    removeTrack,
    removeTracks,
    reorderTracks: reorderTracksHandler,
    swapTracks: swapTracksHandler,
    updateTrack,
    addDownloadedTrack,
  };
}
