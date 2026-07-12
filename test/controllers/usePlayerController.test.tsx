import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { usePlayerController } from '@/controllers/usePlayerController';
import type { SlotId, Track } from '@/types';

const providerMocks = vi.hoisted(() => ({
  getLyrics: vi.fn(),
}));

vi.mock('@/services/onlineMusicProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/onlineMusicProvider')>();
  return {
    ...actual,
    getOnlineProvider: () => ({
      id: 'qq',
      getLyrics: providerMocks.getLyrics,
    }),
  };
});

interface ControllerFixtureOptions {
  activeSlotId?: SlotId;
  viewSlot?: SlotId;
  onlineTracks?: Track[];
  onlineCurrentIndex?: number;
}

function makeController(options: ControllerFixtureOptions = {}) {
  const activeSlotId: SlotId = options.activeSlotId ?? 'local';
  const viewSlot: SlotId = options.viewSlot ?? 'local';
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
      onlineTracks: options.onlineTracks ?? [],
      onlineCurrentIndex: options.onlineCurrentIndex ?? -1,
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
      updateOnlineTracks,
      loadPlaylistTracks,
    },
    slots: { activeSlotId, viewSlot },
  };
}

describe('usePlayerController', () => {
  it('upgrades persisted online line lyrics with provider word timings', async () => {
    const track: Track = {
      id: 'online-qq-song-1',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      duration: 10,
      audioUrl: '',
      source: 'qq',
      songmid: 'song-1',
      lyrics: '旧歌词',
      syncedLyrics: [{ time: 1, text: '旧歌词' }],
    };
    providerMocks.getLyrics.mockResolvedValueOnce({
      lyrics: '[00:01.00]新歌词',
      wordLyrics: '[1000,600]新(1000,300)歌词(1300,300)',
      wordLyricsFormat: 'qrc',
    });

    const { mocks } = makeController({
      activeSlotId: 'online',
      viewSlot: 'online',
      onlineTracks: [track],
      onlineCurrentIndex: 0,
    });

    await waitFor(() => expect(mocks.updateOnlineTracks).toHaveBeenCalled());
    const updater = mocks.updateOnlineTracks.mock.calls[0]?.[0] as (tracks: Track[]) => Track[];
    expect(updater([track])[0]?.syncedLyrics?.[0]?.words).toEqual([
      { time: 1, duration: 0.3, text: '新' },
      { time: 1.3, duration: 0.3, text: '歌词' },
    ]);
  });

  it('does not refetch an online track that already has word timings', async () => {
    providerMocks.getLyrics.mockClear();
    const track: Track = {
      id: 'online-qq-song-2',
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      duration: 10,
      audioUrl: '',
      source: 'qq',
      songmid: 'song-2',
      syncedLyrics: [{
        time: 1,
        text: '逐字',
        words: [{ time: 1, duration: 0.5, text: '逐字' }],
      }],
    };

    makeController({
      activeSlotId: 'online',
      viewSlot: 'online',
      onlineTracks: [track],
      onlineCurrentIndex: 0,
    });

    await Promise.resolve();
    expect(providerMocks.getLyrics).not.toHaveBeenCalled();
  });

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
