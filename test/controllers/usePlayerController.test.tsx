import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { usePlayerController } from '@/controllers/usePlayerController';
import type { SlotId } from '@/types';

function makeController() {
  const activeSlotId: SlotId = 'local';
  const viewSlot: SlotId = 'local';
  const setViewSlot = vi.fn();
  // Mock refs
  const audioRef = { current: { currentTime: 42 } } as unknown as MutableRefObject<HTMLAudioElement | null>;
  const shouldAutoPlayRef = { current: false } as MutableRefObject<boolean>;
  // Mock callbacks
  const selectTrack = vi.fn();
  const setIsPlaying = vi.fn();
  const setRestoreTime = vi.fn();
  const markTrackSwitch = vi.fn();
  const updateSlot = vi.fn();
  const switchTo = vi.fn();
  const addOnlineTrack = vi.fn();
  const updateOnlineTracks = vi.fn();
  const loadPlaylistTracks = vi.fn();
  const updatePlaylistTracks = vi.fn();
  const localTracks: never[] = [];
  const cloudTracks: never[] = [];

  const { result } = renderHook(() =>
    usePlayerController({
      activeSlotId,
      viewSlot,
      setViewSlot,
      updateSlot,
      switchTo,
      addOnlineTrack,
      updateOnlineTracks,
      loadPlaylistTracks,
      updatePlaylistTracks,
      playlistTracks: [],
      playlistCurrentIndex: -1,
      audioRef,
      shouldAutoPlayRef,
      selectTrack,
      setIsPlaying,
      setRestoreTime,
      markTrackSwitch,
      localTracks,
      cloudTracks,
    })
  );

  return {
    controller: result.current,
    mocks: {
      updateSlot,
      switchTo,
      selectTrack,
      setIsPlaying,
      setRestoreTime,
      shouldAutoPlayRef,
      markTrackSwitch,
      setViewSlot,
      addOnlineTrack,
      loadPlaylistTracks,
    },
    slots: { activeSlotId, viewSlot },
  };
}

describe('usePlayerController', () => {
  describe('handleTrackSelect (same slot)', () => {
    it('calls selectTrack when targetSlot matches activeSlotId', () => {
      const { controller, mocks } = makeController();
      controller.handleTrackSelect(1);
      expect(mocks.selectTrack).toHaveBeenCalledWith(1);
    });

    it('does NOT switchTo when same slot', () => {
      const { controller, mocks } = makeController();
      controller.handleTrackSelect(2);
      expect(mocks.switchTo).not.toHaveBeenCalled();
    });
  });

  describe('handleTrackSelect (cross slot)', () => {
    it('saves time, switches slot, and auto-plays', () => {
      const { controller, mocks } = makeController();
      controller.handleTrackSelect(0, 'online');
      // save current slot time
      expect(mocks.updateSlot).toHaveBeenCalledWith('local', expect.any(Function));
      // set target slot index
      expect(mocks.updateSlot).toHaveBeenCalledWith('online', expect.any(Function));
      // reset restoreTime
      expect(mocks.setRestoreTime).toHaveBeenCalledWith(0);
      // mark track switch
      expect(mocks.markTrackSwitch).toHaveBeenCalled();
      // switch active slot
      expect(mocks.switchTo).toHaveBeenCalledWith('online');
      // autoplay
      expect(mocks.shouldAutoPlayRef.current).toBe(true);
      expect(mocks.setIsPlaying).toHaveBeenCalledWith(true);
    });
  });

  // handlePlayPlaylist was removed in the browse/play decoupling refactor
  // (see commits 9362aae, 198c6aa). The current flow is:
  //   controller.openOnlinePlaylist(source, playlistId)   // loads into browsing
  //   controller.playBrowsingTrack(index)                  // moves to playlist slot + auto-plays
  // Both paths have their own dedicated coverage; no replacement test here.
});
