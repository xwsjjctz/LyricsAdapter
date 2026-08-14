import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { MutableRefObject } from 'react';
import { usePlayerController } from '@/controllers/usePlayerController';
import type { OnlineLyricsResult } from '@/services/onlineMusicProvider';
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
  playlistTracks?: Track[];
  playlistCurrentIndex?: number;
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
      playlistTracks: options.playlistTracks ?? [],
      playlistCurrentIndex: options.playlistCurrentIndex ?? -1,
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
      updatePlaylistTracks,
    },
    slots: { activeSlotId, viewSlot },
  };
}

function makeProviderTrack(songmid: string, lyrics?: string): Track {
  return {
    id: `playlist-qq-${songmid}`,
    title: `Song ${songmid}`,
    artist: 'Artist',
    album: 'Album',
    duration: 10,
    audioUrl: '',
    source: 'qq',
    songmid,
    ...(lyrics ? {
      lyrics,
      syncedLyrics: [{ time: 1, text: lyrics }],
    } : {}),
  };
}

function makeWordLyrics(songmid: string): OnlineLyricsResult {
  return {
    lyrics: `[00:01.00]${songmid}`,
    wordLyrics: '[1000,600]新(1000,300)词(1300,300)',
    wordLyricsFormat: 'qrc',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makePlaylistHarness(initialTracks: Track[], initialIndex: number, activeSlotId: SlotId = 'playlist') {
  const audioRef = { current: { currentTime: 0 } } as unknown as MutableRefObject<HTMLAudioElement | null>;
  const shouldAutoPlayRef = { current: false } as MutableRefObject<boolean>;
  const updateSlot = vi.fn();
  const switchTo = vi.fn();
  const setViewSlot = vi.fn();
  const addOnlineTrack = vi.fn();
  const updateOnlineTracks = vi.fn();
  const loadPlaylistTracks = vi.fn();
  const selectTrack = vi.fn();
  const setIsPlaying = vi.fn();
  const setRestoreTime = vi.fn();
  const markTrackSwitch = vi.fn();
  const localTracks: Track[] = [];
  const cloudTracks: Track[] = [];
  const onlineTracks: Track[] = [];

  return renderHook(() => {
    const [tracks, setTracks] = useState(initialTracks);
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const controller = usePlayerController({
      activeSlotId,
      viewSlot: activeSlotId,
      localTracks,
      cloudTracks,
      setViewSlot,
      updateSlot,
      switchTo,
      addOnlineTrack,
      updateOnlineTracks,
      onlineTracks,
      onlineCurrentIndex: -1,
      loadPlaylistTracks,
      updatePlaylistTracks: setTracks,
      playlistTracks: tracks,
      playlistCurrentIndex: currentIndex,
      audioRef,
      shouldAutoPlayRef,
      selectTrack,
      setIsPlaying,
      setRestoreTime,
      markTrackSwitch,
    });
    return { controller, tracks, setTracks, currentIndex, setCurrentIndex, updateOnlineTracks };
  });
}

describe('usePlayerController', () => {
  beforeEach(() => {
    providerMocks.getLyrics.mockReset();
  });

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

  describe('playlist lyrics window', () => {
    it('prefetches exactly current, previous and next while evicting outside lyrics', async () => {
      providerMocks.getLyrics.mockImplementation(async (songmid: string) => makeWordLyrics(songmid));
      const tracks = ['a', 'b', 'c', 'd', 'e'].map(songmid => makeProviderTrack(songmid, `old-${songmid}`));
      const { result } = makePlaylistHarness(tracks, 2);

      await waitFor(() => expect(providerMocks.getLyrics).toHaveBeenCalledTimes(3));
      expect(new Set(providerMocks.getLyrics.mock.calls.map(([songmid]) => songmid))).toEqual(new Set(['b', 'c', 'd']));
      await waitFor(() => {
        expect(result.current.tracks[1]?.syncedLyrics?.[0]?.words?.length).toBeGreaterThan(0);
        expect(result.current.tracks[2]?.syncedLyrics?.[0]?.words?.length).toBeGreaterThan(0);
        expect(result.current.tracks[3]?.syncedLyrics?.[0]?.words?.length).toBeGreaterThan(0);
      });
      expect(result.current.tracks[0]?.lyrics).toBeUndefined();
      expect(result.current.tracks[4]?.lyrics).toBeUndefined();
    });

    it('wraps the window across playlist boundaries', async () => {
      providerMocks.getLyrics.mockImplementation(async (songmid: string) => makeWordLyrics(songmid));
      makePlaylistHarness(['a', 'b', 'c', 'd', 'e'].map(songmid => makeProviderTrack(songmid)), 0);

      await waitFor(() => expect(providerMocks.getLyrics).toHaveBeenCalledTimes(3));
      expect(new Set(providerMocks.getLyrics.mock.calls.map(([songmid]) => songmid))).toEqual(new Set(['e', 'a', 'b']));
    });

    it('refetches the window when a same-length playlist is replaced', async () => {
      providerMocks.getLyrics.mockImplementation(async (songmid: string) => makeWordLyrics(songmid));
      const { result } = makePlaylistHarness(['a', 'b', 'c'].map(songmid => makeProviderTrack(songmid)), 1);

      await waitFor(() => expect(providerMocks.getLyrics).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(result.current.tracks.every(track => (
        (track.syncedLyrics?.[0]?.words?.length ?? 0) > 0
      ))).toBe(true));
      providerMocks.getLyrics.mockClear();

      act(() => result.current.setTracks(['x', 'y', 'z'].map(songmid => makeProviderTrack(songmid))));

      await waitFor(() => expect(providerMocks.getLyrics).toHaveBeenCalledTimes(3));
      expect(new Set(providerMocks.getLyrics.mock.calls.map(([songmid]) => songmid))).toEqual(new Set(['x', 'y', 'z']));
    });

    it('does not write pending results into a same-length replacement playlist', async () => {
      const pending = new Map(['a', 'b', 'c'].map(songmid => [
        songmid,
        deferred<OnlineLyricsResult | null>(),
      ]));
      providerMocks.getLyrics.mockImplementation((songmid: string) => (
        pending.get(songmid)?.promise ?? Promise.resolve(null)
      ));
      const original = ['a', 'b', 'c'].map(songmid => makeProviderTrack(songmid));
      const { result } = makePlaylistHarness(original, 1);

      await waitFor(() => expect(providerMocks.getLyrics).toHaveBeenCalledTimes(3));
      const replacement = ['x', 'y', 'z'].map((songmid, index) => ({
        ...makeProviderTrack(songmid),
        id: original[index]!.id,
      }));
      act(() => result.current.setTracks(replacement));
      await act(async () => {
        await new Promise(resolve => window.setTimeout(resolve, 150));
        for (const [songmid, request] of pending) request.resolve(makeWordLyrics(songmid));
        await Promise.all([...pending.values()].map(request => request.promise));
      });

      await waitFor(() => expect(providerMocks.getLyrics).toHaveBeenCalledTimes(6));
      expect(result.current.tracks.every(track => !track.lyrics && !track.syncedLyrics?.length)).toBe(true);
    });

    it('restores line-only lyrics after a track leaves and re-enters the window', async () => {
      providerMocks.getLyrics.mockImplementation(async (songmid: string) => ({
        lyrics: `[00:01.00]line-${songmid}`,
      }));
      const { result } = makePlaylistHarness(['a', 'b', 'c', 'd', 'e'].map(songmid => makeProviderTrack(songmid)), 2);

      await waitFor(() => expect(result.current.tracks[1]?.lyrics).toContain('line-b'));
      act(() => result.current.setCurrentIndex(4));
      await waitFor(() => {
        expect(result.current.tracks[1]?.lyrics).toBeUndefined();
        expect(result.current.tracks[2]?.lyrics).toBeUndefined();
      });

      act(() => result.current.setCurrentIndex(2));
      await waitFor(() => {
        expect(result.current.tracks[1]?.lyrics).toContain('line-b');
        expect(result.current.tracks[2]?.lyrics).toContain('line-c');
      });
    });

    it('ignores stale results outside the live window but accepts a still-adjacent result', async () => {
      const pending = new Map(['a', 'b', 'c'].map(songmid => [
        songmid,
        deferred<OnlineLyricsResult | null>(),
      ]));
      providerMocks.getLyrics.mockImplementation((songmid: string) => (
        pending.get(songmid)?.promise ?? Promise.resolve(makeWordLyrics(songmid))
      ));
      const { result } = makePlaylistHarness(['a', 'b', 'c', 'd', 'e'].map(songmid => makeProviderTrack(songmid)), 1);

      await waitFor(() => expect(providerMocks.getLyrics).toHaveBeenCalledTimes(3));
      act(() => result.current.setCurrentIndex(3));
      await act(async () => {
        await new Promise(resolve => window.setTimeout(resolve, 150));
      });
      expect(providerMocks.getLyrics).toHaveBeenCalledTimes(3);

      await act(async () => {
        pending.get('a')?.resolve(makeWordLyrics('a'));
        await pending.get('a')?.promise;
      });
      expect(result.current.tracks[0]?.lyrics).toBeUndefined();
      await waitFor(() => expect(providerMocks.getLyrics).toHaveBeenCalledTimes(4));

      await act(async () => {
        pending.get('b')?.resolve(makeWordLyrics('b'));
        await pending.get('b')?.promise;
      });
      expect(result.current.tracks[1]?.lyrics).toBeUndefined();
      await waitFor(() => expect(providerMocks.getLyrics).toHaveBeenCalledTimes(5));

      await act(async () => {
        pending.get('c')?.resolve(makeWordLyrics('c'));
        await pending.get('c')?.promise;
      });
      await waitFor(() => expect(result.current.tracks[2]?.syncedLyrics?.[0]?.words?.length).toBeGreaterThan(0));
    });

    it('never evicts embedded lyrics from non-provider tracks', async () => {
      providerMocks.getLyrics.mockImplementation(async (songmid: string) => makeWordLyrics(songmid));
      const localTrack: Track = {
        ...makeProviderTrack('local', 'embedded local lyrics'),
        id: 'local-track',
        source: 'local',
        songmid: undefined,
      };
      const providerOutsideWindow = makeProviderTrack('d', 'provider lyrics');
      const { result } = makePlaylistHarness([
        makeProviderTrack('a'),
        makeProviderTrack('b'),
        localTrack,
        providerOutsideWindow,
        makeProviderTrack('e'),
      ], 0);

      await waitFor(() => expect(result.current.tracks[3]?.lyrics).toBeUndefined());
      expect(result.current.tracks[2]?.lyrics).toBe('embedded local lyrics');
    });

    it('does not prefetch adjacent lyrics while another slot is active', async () => {
      providerMocks.getLyrics.mockResolvedValue(makeWordLyrics('unused'));
      makePlaylistHarness(['a', 'b', 'c'].map(songmid => makeProviderTrack(songmid)), 1, 'local');

      await act(async () => Promise.resolve());
      expect(providerMocks.getLyrics).not.toHaveBeenCalled();
    });

    it('delivers one shared in-flight lyric request to playlist and online consumers', async () => {
      const pending = deferred<OnlineLyricsResult | null>();
      providerMocks.getLyrics.mockReturnValue(pending.promise);
      const { result } = makePlaylistHarness([makeProviderTrack('same')], 0);

      await waitFor(() => expect(providerMocks.getLyrics).toHaveBeenCalledTimes(1));
      act(() => {
        void result.current.controller.handleOnlineStreamPlay({
          songmid: 'same',
          title: 'Same song',
          artist: 'Artist',
          album: 'Album',
          duration: 10,
        }, 'qq');
      });
      expect(providerMocks.getLyrics).toHaveBeenCalledTimes(1);

      await act(async () => {
        pending.resolve(makeWordLyrics('same'));
        await pending.promise;
      });
      await waitFor(() => {
        expect(result.current.tracks[0]?.syncedLyrics?.[0]?.words?.length).toBeGreaterThan(0);
        expect(result.current.updateOnlineTracks).toHaveBeenCalled();
      });
    });
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

  // Playlist browsing is covered through the Library-facing flow: opening a
  // playlist does not replace the play slot until a row is selected.
});
