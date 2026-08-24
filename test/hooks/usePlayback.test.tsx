import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type { Track } from '@/types';

// Mock module-level dependencies to prevent import failures
const webdavMocks = vi.hoisted(() => ({
  getCdnUrl: vi.fn(),
  clearCdnCache: vi.fn(),
}));
vi.mock('@/services/webdavClient', () => ({
  webdavClient: webdavMocks,
}));
vi.mock('@/services/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('@/services/metadataCacheService', () => ({
  metadataCacheService: { get: vi.fn(), set: vi.fn() },
}));
vi.mock('@/services/onlineMusicProvider', () => ({
  getOnlineProvider: () => ({ id: 'qq', getLyrics: vi.fn() }),
  OnlineSource: {},
}));
vi.mock('@/services/qqMusicApi', () => ({ qqMusicApi: {} }));
vi.mock('@/services/neteaseMusicApi', () => ({ neteaseMusicApi: {} }));
vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => null,
  getDesktopAPIAsync: () => Promise.resolve(null),
}));
vi.mock('@/services/cookieManager', () => ({
  cookieManager: { ensureLoaded: vi.fn(), getCookie: () => '' },
  neteaseCookieManager: { ensureLoaded: vi.fn(), getCookie: () => '' },
}));

import { usePlayback } from '@/hooks/usePlayback';

function makeTrack(overrides: Partial<Track> & { id: string }): Track {
  return {
    title: 'Test',
    artist: 'Artist',
    album: 'Album',
    duration: 10,
    audioUrl: '',
    ...overrides,
  };
}

function renderPlayback(initialTracks: Track[], initialIndex = 0) {
  const setTracks = vi.fn();
  const setCurrentTrackIndex = vi.fn();
  const revokeBlobUrl = vi.fn();
  const onTrackSwitch = vi.fn();
  return renderHook(() =>
    usePlayback({
      tracks: initialTracks,
      setTracks,
      currentTrackIndex: initialIndex,
      setCurrentTrackIndex,
      revokeBlobUrl,
      onTrackSwitch,
      initialCurrentTime: 0,
    })
  );
}

function makeAudioElement(initialSource = ''): HTMLAudioElement {
  let source = initialSource;
  const audio = {
    pause: vi.fn(),
    load: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    getAttribute: vi.fn(() => source || null),
    removeAttribute: vi.fn(() => { source = ''; }),
    srcObject: null,
    volume: 1,
    currentTime: 0,
    duration: 10,
  } as unknown as HTMLAudioElement;
  Object.defineProperty(audio, 'src', {
    get: () => source,
    set: (value: string) => { source = value; },
  });
  return audio;
}

describe('usePlayback', () => {
  beforeEach(() => {
    webdavMocks.getCdnUrl.mockReset();
    webdavMocks.clearCdnCache.mockReset();
  });

  it('keeps an exact ref-backed playback clock for persistence and seeking', () => {
    const track = makeTrack({ id: 'clock', audioUrl: 'audio://localhost/clock.flac' });
    const audio = makeAudioElement();
    const { result } = renderPlayback([track]);

    act(() => result.current.setAudioRef(audio));
    audio.currentTime = 3.75;
    act(() => result.current.handleTimeUpdate());

    expect(result.current.currentTime).toBe(3.75);
    expect(result.current.persistedTimeRef.current).toBe(3.75);
    expect(result.current.getCurrentPlaybackTime()).toBe(3.75);

    act(() => result.current.handleSeek(8.5));

    expect(audio.currentTime).toBe(8.5);
    expect(result.current.currentTime).toBe(8.5);
    expect(result.current.persistedTimeRef.current).toBe(8.5);
    expect(result.current.getCurrentPlaybackTime()).toBe(8.5);
  });

  it('resynchronizes the shared clock from the media element when the window regains focus', () => {
    const track = makeTrack({ id: 'focus-resync', audioUrl: 'audio://localhost/focus-resync.flac' });
    const audio = makeAudioElement();
    const { result } = renderPlayback([track]);

    act(() => result.current.setAudioRef(audio));
    audio.currentTime = 2.25;
    act(() => result.current.handleTimeUpdate());

    audio.currentTime = 8.75;
    expect(result.current.getCurrentPlaybackTime()).toBe(8.75);
    act(() => window.dispatchEvent(new Event('focus')));

    expect(result.current.currentTime).toBe(8.75);
    expect(result.current.persistedTimeRef.current).toBe(8.75);
    expect(result.current.getCurrentPlaybackTime()).toBe(8.75);
  });

  it('resamples immediately and on the next frame when the renderer becomes visible', () => {
    const track = makeTrack({ id: 'visible-resync', audioUrl: 'audio://localhost/visible-resync.flac' });
    const audio = makeAudioElement();
    const { result } = renderPlayback([track]);
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback);
      return frames.length;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

    act(() => result.current.setAudioRef(audio));
    audio.currentTime = 1;
    act(() => result.current.handleTimeUpdate());

    audio.currentTime = 4;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current.currentTime).toBe(4);
    expect(frames).toHaveLength(1);

    audio.currentTime = 5;
    act(() => frames[0]!(16));
    expect(result.current.currentTime).toBe(5);

    visibility.mockRestore();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it('does not attribute the previous media element time to a newly selected track', () => {
    const tracks = [
      makeTrack({ id: 'one', audioUrl: 'audio://localhost/one.flac' }),
      makeTrack({ id: 'two', audioUrl: 'audio://localhost/two.flac' }),
    ];
    const audio = makeAudioElement();
    const { result, rerender } = renderHook(
      ({ index }: { index: number }) => usePlayback({
        tracks,
        setTracks: vi.fn(),
        currentTrackIndex: index,
        setCurrentTrackIndex: vi.fn(),
        revokeBlobUrl: vi.fn(),
      }),
      { initialProps: { index: 0 } },
    );

    act(() => result.current.setAudioRef(audio));
    audio.currentTime = 7.25;
    act(() => result.current.handleTimeUpdate());
    expect(result.current.getCurrentPlaybackTime()).toBe(7.25);

    rerender({ index: 1 });

    // The mock media element deliberately retains its old currentTime across
    // load(); persistence must still use the new track's reset clock.
    expect(audio.currentTime).toBe(7.25);
    expect(result.current.persistedTimeRef.current).toBe(0);
    expect(result.current.getCurrentPlaybackTime()).toBe(0);
  });

  it('ignores old-source time events during a debounced track switch', () => {
    vi.useFakeTimers();
    const tracks = [
      makeTrack({ id: 'one', audioUrl: 'audio://localhost/one.flac' }),
      makeTrack({ id: 'two', audioUrl: 'audio://localhost/two.flac' }),
    ];
    const audio = makeAudioElement('audio://localhost/one.flac');
    const { result, unmount } = renderHook(() => {
      const [index, setIndex] = useState(0);
      return usePlayback({
        tracks,
        setTracks: vi.fn(),
        currentTrackIndex: index,
        setCurrentTrackIndex: setIndex,
        revokeBlobUrl: vi.fn(),
      });
    });

    act(() => result.current.setAudioRef(audio));
    audio.currentTime = 2.25;
    act(() => result.current.handleTimeUpdate());

    act(() => result.current.skipForward());
    audio.currentTime = 7.75;
    act(() => result.current.handleTimeUpdate());
    act(() => window.dispatchEvent(new Event('focus')));

    expect(result.current.persistedTimeRef.current).toBe(0);
    expect(result.current.getCurrentPlaybackTime()).toBe(0);

    act(() => vi.advanceTimersByTime(150));
    act(() => result.current.handleLoadedMetadata());
    audio.currentTime = 1.5;
    act(() => result.current.handleTimeUpdate());

    expect(result.current.currentTime).toBe(1.5);
    expect(result.current.persistedTimeRef.current).toBe(1.5);
    unmount();
    vi.useRealTimers();
  });

  it('preserves and applies a restored playback position', () => {
    const track = makeTrack({ id: 'restored', audioUrl: 'audio://localhost/restored.flac' });
    const audio = makeAudioElement();
    const { result } = renderHook(() => usePlayback({
      tracks: [track],
      setTracks: vi.fn(),
      currentTrackIndex: 0,
      setCurrentTrackIndex: vi.fn(),
      revokeBlobUrl: vi.fn(),
      initialCurrentTime: 6.25,
    }));

    act(() => result.current.setAudioRef(audio));
    expect(result.current.getCurrentPlaybackTime()).toBe(6.25);

    act(() => result.current.handleLoadedMetadata());

    expect(audio.currentTime).toBe(6.25);
    expect(result.current.currentTime).toBe(6.25);
    expect(result.current.persistedTimeRef.current).toBe(6.25);
    expect(result.current.getCurrentPlaybackTime()).toBe(6.25);
  });

  it('releases the previous media pipeline before assigning the next source', () => {
    const pause = vi.fn();
    const load = vi.fn();
    let source = 'audio://localhost/music/one.flac';
    const audio = {
      pause,
      load,
      play: vi.fn().mockResolvedValue(undefined),
      getAttribute: vi.fn(() => source || null),
      removeAttribute: vi.fn(() => { source = ''; }),
      srcObject: null,
      volume: 1,
      currentTime: 0,
      duration: 10,
    } as unknown as HTMLAudioElement;
    Object.defineProperty(audio, 'src', {
      get: () => source,
      set: (value: string) => { source = value; },
    });

    const setTracks = vi.fn();
    const setCurrentTrackIndex = vi.fn();
    const { result, rerender } = renderHook(
      ({ tracks, index }: { tracks: Track[]; index: number }) => usePlayback({
        tracks,
        setTracks,
        currentTrackIndex: index,
        setCurrentTrackIndex,
        revokeBlobUrl: vi.fn(),
      }),
      {
        initialProps: {
          tracks: [
            makeTrack({ id: 'one', audioUrl: 'audio://localhost/music/one.flac' }),
            makeTrack({ id: 'two', audioUrl: 'audio://localhost/music/two.flac' }),
          ],
          index: 0,
        },
      },
    );

    act(() => result.current.setAudioRef(audio));
    rerender({
      tracks: [
        makeTrack({ id: 'one', audioUrl: 'audio://localhost/music/one.flac' }),
        makeTrack({ id: 'two', audioUrl: 'audio://localhost/music/two.flac' }),
      ],
      index: 1,
    });

    expect(pause).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(source).toBe('audio://localhost/music/two.flac');
  });

  it('reloads the same track after its audio element is remounted', () => {
    const one = makeTrack({ id: 'one', audioUrl: 'audio://localhost/one.flac' });
    const two = makeTrack({ id: 'two', audioUrl: 'audio://localhost/two.flac' });
    const firstAudio = makeAudioElement();
    const { result, rerender } = renderHook(
      ({ tracks, index }: { tracks: Track[]; index: number }) => usePlayback({
        tracks,
        setTracks: vi.fn(),
        currentTrackIndex: index,
        setCurrentTrackIndex: vi.fn(),
        revokeBlobUrl: vi.fn(),
      }),
      { initialProps: { tracks: [one, two], index: 0 } },
    );

    act(() => result.current.setAudioRef(firstAudio));
    rerender({ tracks: [one, two], index: 1 });
    expect(firstAudio.getAttribute('src')).toBe('audio://localhost/two.flac');

    act(() => result.current.setAudioRef(null));
    const remountedAudio = makeAudioElement();
    act(() => result.current.setAudioRef(remountedAudio));
    rerender({ tracks: [{ ...one }, { ...two }], index: 1 });

    expect(remountedAudio.getAttribute('src')).toBe('audio://localhost/two.flac');
  });

  it('ignores a stale WebDAV URL when the playlist changes at the same index', async () => {
    let resolveFirst!: (value: string) => void;
    const firstUrl = new Promise<string>(resolve => { resolveFirst = resolve; });
    webdavMocks.getCdnUrl
      .mockReturnValueOnce(firstUrl)
      .mockResolvedValueOnce('https://cdn.example/new.flac');

    const first = makeTrack({ id: 'webdav-one', source: 'webdav', webdavPath: '/one.flac' });
    const second = makeTrack({ id: 'webdav-two', source: 'webdav', webdavPath: '/two.flac' });
    const audio = makeAudioElement();
    const { result, rerender } = renderHook(
      ({ tracks, index }: { tracks: Track[]; index: number }) => usePlayback({
        tracks,
        setTracks: vi.fn(),
        currentTrackIndex: index,
        setCurrentTrackIndex: vi.fn(),
        revokeBlobUrl: vi.fn(),
      }),
      { initialProps: { tracks: [], index: -1 } },
    );

    act(() => result.current.setAudioRef(audio));
    rerender({ tracks: [first], index: 0 });
    rerender({ tracks: [second], index: 0 });
    await act(async () => { await Promise.resolve(); });
    expect(audio.getAttribute('src')).toBe('https://cdn.example/new.flac');

    await act(async () => {
      resolveFirst('https://cdn.example/stale.flac');
      await firstUrl;
    });
    expect(audio.getAttribute('src')).toBe('https://cdn.example/new.flac');
  });

  it('does not arm autoplay when a stale WebDAV request rejects', async () => {
    let rejectFirst!: (error: Error) => void;
    const firstUrl = new Promise<string>((_resolve, reject) => { rejectFirst = reject; });
    webdavMocks.getCdnUrl
      .mockReturnValueOnce(firstUrl)
      .mockResolvedValueOnce('https://cdn.example/new.flac');

    const first = makeTrack({ id: 'webdav-one', source: 'webdav', webdavPath: '/one.flac' });
    const second = makeTrack({ id: 'webdav-two', source: 'webdav', webdavPath: '/two.flac' });
    const audio = makeAudioElement();
    const { result, rerender } = renderHook(
      ({ tracks, index }: { tracks: Track[]; index: number }) => usePlayback({
        tracks,
        setTracks: vi.fn(),
        currentTrackIndex: index,
        setCurrentTrackIndex: vi.fn(),
        revokeBlobUrl: vi.fn(),
      }),
      { initialProps: { tracks: [], index: -1 } },
    );

    act(() => result.current.setAudioRef(audio));
    rerender({ tracks: [first], index: 0 });
    rerender({ tracks: [second], index: 0 });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      rejectFirst(new Error('stale request failed'));
      await firstUrl.catch(() => undefined);
    });
    act(() => result.current.handleCanPlay());

    expect(audio.play).not.toHaveBeenCalled();
  });

  it('reloads a failed local source without the JSX src fallback', async () => {
    const first = makeTrack({ id: 'one', audioUrl: 'audio://localhost/one.flac' });
    const failed = makeTrack({
      id: 'failed',
      source: 'local',
      filePath: '/music/failed.flac',
      audioUrl: 'blob:stale-audio',
    });
    const audio = makeAudioElement();
    Object.defineProperty(audio, 'paused', { value: false, configurable: true });
    Object.defineProperty(audio, 'error', {
      value: { code: 4, message: 'unsupported' },
      configurable: true,
    });

    const { result } = renderHook(() => {
      const [tracks, setTracks] = useState<Track[]>([first, failed]);
      const [index, setIndex] = useState(0);
      const playback = usePlayback({
        tracks,
        setTracks,
        currentTrackIndex: index,
        setCurrentTrackIndex: setIndex,
        revokeBlobUrl: vi.fn(),
      });
      return { playback, setIndex };
    });

    act(() => result.current.playback.setAudioRef(audio));
    act(() => result.current.setIndex(1));
    expect(audio.getAttribute('src')).toBe('blob:stale-audio');

    await act(async () => {
      result.current.playback.handleAudioError({ target: audio } as unknown as React.SyntheticEvent<HTMLAudioElement>);
      await Promise.resolve();
    });

    expect(audio.getAttribute('src')).toBe('audio://localhost/music/failed.flac');
    expect(audio.play).toHaveBeenCalled();
  });

  describe('loadAudioFileForTrack', () => {
    it('builds audio:// URL for a unix local file path', async () => {
      const { result } = renderPlayback([makeTrack({ id: 't1', filePath: '/music/test.flac', source: 'local' })]);
      const track = makeTrack({ id: 't2', filePath: '/music/song.flac', source: 'local' });
      const updated = await result.current.loadAudioFileForTrack(track);
      expect(updated.audioUrl).toBe('audio://localhost/music/song.flac');
    });

    it('encodes special characters', async () => {
      const { result } = renderPlayback([makeTrack({ id: 't1', filePath: '/music/test.flac', source: 'local' })]);
      const track = makeTrack({ id: 't3', filePath: '/music/file name.flac', source: 'local' });
      const updated = await result.current.loadAudioFileForTrack(track);
      expect(updated.audioUrl).toContain(encodeURIComponent(' '));
    });

    it('normalizes Windows backslashes (colon kept as-is — actual encoding handled by audio protocol)', async () => {
      const { result } = renderPlayback([makeTrack({ id: 't1', filePath: '/music/test.flac', source: 'local' })]);
      const track = makeTrack({ id: 't4', filePath: 'C:\\Music\\song.flac', source: 'local' });
      const updated = await result.current.loadAudioFileForTrack(track);
      expect(updated.audioUrl).toBe('audio://localhost/C:/Music/song.flac');
      expect(updated.audioUrl).not.toContain('\\');
    });
  });
});
