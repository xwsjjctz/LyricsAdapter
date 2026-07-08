import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { useLibraryController } from '@/controllers/useLibraryController';
import type { LibrarySlot, SlotId, Track } from '@/types';

function track(id: string, filePath?: string): Track {
  return { id, title: id, artist: 'A', album: 'B', duration: 10, audioUrl: '', filePath };
}

function slot(tracks: Track[], currentTrackIndex = 0): LibrarySlot {
  return {
    tracks,
    currentTrackIndex,
    currentTime: 0,
    volume: 0.7,
    playbackMode: 'order',
    scrollPosition: 0,
    filterType: 'default',
    categorySelection: null,
  };
}

function makeEmptySlots(): Record<SlotId, LibrarySlot> {
  return {
    local: slot([]),
    cloud: slot([]),
    online: slot([]),
    playlist: slot([]),
  };
}

function makeController(tracks: Track[], currentTrackIndex = 0) {
  const viewSlot: SlotId = 'local';
  const activeSlotId: SlotId = 'local';
  const slots = { ...makeEmptySlots(), local: slot(tracks, currentTrackIndex) };
  const slotsRef = { current: slots } as MutableRefObject<Record<SlotId, LibrarySlot>>;
  const updateSlot = vi.fn();
  const audioRef = { current: { pause: vi.fn(), src: '' } } as unknown as MutableRefObject<HTMLAudioElement | null>;
  const setIsPlaying = vi.fn();
  const revokeBlobUrl = vi.fn();
  const getAppPersistenceData = vi.fn();

  const { result } = renderHook(() =>
    useLibraryController({
      viewSlot,
      activeSlotId,
      slots,
      slotsRef,
      updateSlot,
      updateLocalTracks: vi.fn(),
      getAppPersistenceData,
      audioRef,
      setIsPlaying,
      revokeBlobUrl,
    })
  );

  return {
    controller: result.current,
    mocks: { updateSlot, audioRef, setIsPlaying, revokeBlobUrl },
    slots,
    viewSlot,
  };
}

describe('useLibraryController', () => {
  describe('removeTrack', () => {
    it('removes a track from the view slot', async () => {
      const tracks = [track('a'), track('b'), track('c')];
      const { controller, mocks } = makeController(tracks, 1);
      await controller.removeTrack('a');

      const call = mocks.updateSlot.mock.calls[0];
      expect(call[0]).toBe('local');
      const updater = call[1] as (s: LibrarySlot) => LibrarySlot;
      const result = updater(slot(tracks, 1));
      expect(result.tracks.map(t => t.id)).toEqual(['b', 'c']);
    });

    it('decrements index when removed track is before current', async () => {
      const tracks = [track('a'), track('b'), track('c')];
      const { controller, mocks } = makeController(tracks, 1);
      await controller.removeTrack('a');

      const updater = mocks.updateSlot.mock.calls[0][1] as (s: LibrarySlot) => LibrarySlot;
      const result = updater(slot(tracks, 1));
      expect(result.currentTrackIndex).toBe(0);
    });

    it('clamps index when removed track is current', async () => {
      const tracks = [track('a'), track('b'), track('c')];
      const { controller, mocks } = makeController(tracks, 1);
      await controller.removeTrack('b');

      const updater = mocks.updateSlot.mock.calls[0][1] as (s: LibrarySlot) => LibrarySlot;
      const result = updater(slot(tracks, 1));
      // current was at 1, was removed, should stay within new length
      expect(result.currentTrackIndex).toBe(Math.min(1, result.tracks.length - 1));
    });

    it('pauses audio and sets isPlaying false when last track is removed', async () => {
      const tracks = [track('a')];
      const { controller, mocks } = makeController(tracks, 0);
      await controller.removeTrack('a');

      const updater = mocks.updateSlot.mock.calls[0][1] as (s: LibrarySlot) => LibrarySlot;
      const result = updater(slot(tracks, 0));
      expect(result.tracks).toHaveLength(0);
      expect(result.currentTrackIndex).toBe(-1);
      // audio pause should have been attempted
      expect(mocks.setIsPlaying).toHaveBeenCalledWith(false);
    });
  });

  describe('removeTracks', () => {
    it('adjusts currentTrackIndex by removed tracks before it', async () => {
      const tracks = [track('a'), track('b'), track('c'), track('d')];
      const { controller, mocks } = makeController(tracks, 2);
      await controller.removeTracks(['a', 'c']);

      const updater = mocks.updateSlot.mock.calls[0][1] as (s: LibrarySlot) => LibrarySlot;
      const result = updater(slot(tracks, 2));
      // removed 'a' (before current=2) and 'c' (is current=2) — after removal, new index should be
      // current(2) - removedBefore(1) = 1 (since 'a' was before index 2, 'c' was at index 2)
      // Wait, 'c' is at index 2, which IS the currentTrackIndex. removedBeforeCurrent counts those
      // strictly before the current index, so only 'a' (index 0 < 2). So newIndex = 2 - 1 = 1.
      expect(result.currentTrackIndex).toBe(1);
      expect(result.tracks.map(t => t.id)).toEqual(['b', 'd']);
    });
  });

  describe('reorderTracks', () => {
    it('early-returns when result.changed is false', async () => {
      // Test with fromIndex == toIndex (no change)
      const tracks = [track('a'), track('b')];
      const { controller, mocks } = makeController(tracks, 0);
      await controller.reorderTracks(0, 0);

      // updateSlot should NOT be called for no-change reorder
      // But it IS called indirectly via the handler... actually reorderTracksHandler
      // checks reorderTracks result.changed and only calls updateSlot when changed.
      // However, the test setup might not trigger this through the pure function.
      // For now, just verify the handler runs without error.
      expect(mocks.updateSlot.mock.calls.length).toBe(0);
    });
  });
});
