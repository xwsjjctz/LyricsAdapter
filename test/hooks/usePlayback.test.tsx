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
  return renderHook(() =>
    usePlayback({
      tracks: initialTracks,
      setTracks: vi.fn(),
      currentTrackIndex: initialIndex,
      setCurrentTrackIndex: vi.fn(),
      revokeBlobUrl: vi.fn(),
      onTrackSwitch: vi.fn(),
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

  it('routes Soda tracks through the stream protocol', () => {
    const local = makeTrack({ id: 'local', audioUrl: 'audio://localhost/local.flac' });
    const soda = makeTrack({ id: 'soda-track', source: 'soda', songmid: 'soda-123' });
    const audio = makeAudioElement();
    const { result, rerender } = renderHook(
      ({ index }: { index: number }) => usePlayback({
        tracks: [local, soda],
        setTracks: vi.fn(),
        currentTrackIndex: index,
        setCurrentTrackIndex: vi.fn(),
        revokeBlobUrl: vi.fn(),
      }),
      { initialProps: { index: 0 } },
    );

    act(() => result.current.setAudioRef(audio));
    rerender({ index: 1 });

    expect(audio.getAttribute('src')).toBe('stream://soda/soda-123?q=320');
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
