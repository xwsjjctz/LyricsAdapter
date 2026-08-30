import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseMediaSessionOptions } from '@/hooks/useMediaSession';
import type { Track } from '@/types';

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/services/logger', () => ({ logger: loggerMocks }));

import { useMediaSession } from '@/hooks/useMediaSession';

interface MockSessionOptions {
  unsupportedAction?: MediaSessionAction;
  throwOnMetadataSet?: boolean;
  throwOnPlaybackStateSet?: boolean;
  throwOnPositionState?: boolean;
}

interface MockSessionHarness {
  session: MediaSession;
  handlers: Map<MediaSessionAction, MediaSessionActionHandler | null>;
  metadataAssignments: Array<MediaMetadata | null>;
  playbackStateAssignments: MediaSessionPlaybackState[];
  setActionHandler: ReturnType<typeof vi.fn>;
  setPositionState: ReturnType<typeof vi.fn>;
}

const metadataInits: MediaMetadataInit[] = [];

class MockMediaMetadata implements MediaMetadata {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly artwork: ReadonlyArray<MediaImage>;

  constructor(init: MediaMetadataInit = {}) {
    metadataInits.push(init);
    this.title = init.title ?? '';
    this.artist = init.artist ?? '';
    this.album = init.album ?? '';
    this.artwork = init.artwork ?? [];
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function responseWithBlob(blob: Blob): Response {
  return {
    ok: true,
    status: 200,
    blob: vi.fn().mockResolvedValue(blob),
  } as unknown as Response;
}

interface ControlledFileReaderInstance {
  result: string | ArrayBuffer | null;
  readAsDataURL: ReturnType<typeof vi.fn>;
  complete(result: string): void;
}

function installControlledFileReader(): ControlledFileReaderInstance[] {
  const instances: ControlledFileReaderInstance[] = [];

  class ControlledFileReader {
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;
    readAsDataURL = vi.fn();

    constructor() {
      instances.push(this);
    }

    complete(result: string): void {
      this.result = result;
      this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>);
    }
  }

  vi.stubGlobal('FileReader', ControlledFileReader);
  return instances;
}

function installMediaSession(options: MockSessionOptions = {}): MockSessionHarness {
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  const metadataAssignments: Array<MediaMetadata | null> = [];
  const playbackStateAssignments: MediaSessionPlaybackState[] = [];
  let metadata: MediaMetadata | null = null;
  let playbackState: MediaSessionPlaybackState = 'none';

  const setActionHandler = vi.fn((
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null,
  ) => {
    if (action === options.unsupportedAction) {
      throw new DOMException(`${action} is unavailable`, 'NotSupportedError');
    }
    handlers.set(action, handler);
  });
  const setPositionState = vi.fn((_state?: MediaPositionState) => {
    if (options.throwOnPositionState) {
      throw new DOMException('Position state is unavailable', 'NotSupportedError');
    }
  });

  const session = {
    get metadata() {
      return metadata;
    },
    set metadata(value: MediaMetadata | null) {
      if (options.throwOnMetadataSet) {
        throw new DOMException('Metadata is unavailable', 'NotSupportedError');
      }
      metadata = value;
      metadataAssignments.push(value);
    },
    get playbackState() {
      return playbackState;
    },
    set playbackState(value: MediaSessionPlaybackState) {
      if (options.throwOnPlaybackStateSet) {
        throw new DOMException('Playback state is unavailable', 'NotSupportedError');
      }
      playbackState = value;
      playbackStateAssignments.push(value);
    },
    setActionHandler,
    setPositionState,
  } as MediaSession;

  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: session,
  });

  return {
    session,
    handlers,
    metadataAssignments,
    playbackStateAssignments,
    setActionHandler,
    setPositionState,
  };
}

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Test title',
    artist: 'Test artist',
    album: 'Test album',
    duration: 120,
    audioUrl: 'audio://localhost/music/test.flac',
    ...overrides,
  };
}

function makeOptions(
  overrides: Partial<UseMediaSessionOptions> = {},
): UseMediaSessionOptions {
  return {
    currentTrack: makeTrack(),
    isPlaying: false,
    currentTime: 25,
    duration: 120,
    getCurrentPlaybackTime: vi.fn(() => 25),
    togglePlay: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
    ...overrides,
  };
}

function invokeAction(
  handlers: MockSessionHarness['handlers'],
  action: MediaSessionAction,
  details: Omit<MediaSessionActionDetails, 'action'> = {},
): void {
  const handler = handlers.get(action);
  expect(handler).toBeTypeOf('function');
  act(() => handler?.({ action, ...details }));
}

describe('useMediaSession', () => {
  beforeEach(() => {
    Reflect.deleteProperty(navigator, 'mediaSession');
    metadataInits.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal('MediaMetadata', MockMediaMetadata);
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'mediaSession');
    vi.unstubAllGlobals();
  });

  it('is a safe no-op when the Media Session API is unavailable', () => {
    vi.stubGlobal('MediaMetadata', undefined);
    const options = makeOptions();

    const { unmount } = renderHook(() => useMediaSession(options));

    expect(options.togglePlay).not.toHaveBeenCalled();
    expect(options.seek).not.toHaveBeenCalled();
    expect(() => unmount()).not.toThrow();
  });

  it('publishes track text metadata and updates or clears it', () => {
    const harness = installMediaSession();
    const firstTrack = makeTrack();
    const { rerender } = renderHook(
      ({ options }: { options: UseMediaSessionOptions }) => useMediaSession(options),
      { initialProps: { options: makeOptions({ currentTrack: firstTrack }) } },
    );

    expect(metadataInits.at(-1)).toEqual({
      title: 'Test title',
      artist: 'Test artist',
      album: 'Test album',
    });
    expect(harness.session.metadata).toMatchObject({
      title: 'Test title',
      artist: 'Test artist',
      album: 'Test album',
    });

    rerender({
      options: makeOptions({
        currentTrack: makeTrack({
          id: 'track-2',
          title: 'Second title',
          artist: 'Second artist',
          album: 'Second album',
          coverUrl: undefined,
        }),
      }),
    });
    expect(metadataInits.at(-1)).toEqual({
      title: 'Second title',
      artist: 'Second artist',
      album: 'Second album',
    });

    rerender({ options: makeOptions({ currentTrack: null, duration: 0 }) });
    expect(harness.metadataAssignments.at(-1)).toBeNull();
  });

  it('materializes a cover thumbnail as a self-contained data image before publishing artwork', async () => {
    const harness = installMediaSession();
    const artworkBlob = new Blob(['cover-bytes'], { type: 'image/png' });
    const fetchMock = vi.fn().mockResolvedValue(responseWithBlob(artworkBlob));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useMediaSession(makeOptions({
      currentTrack: makeTrack({ coverUrl: 'cover://track-1.jpg' }),
    })));

    // The platform receives useful text immediately while the private Electron
    // protocol is converted into a resource macOS/Windows can consume directly.
    expect(metadataInits).toEqual([{
      title: 'Test title',
      artist: 'Test artist',
      album: 'Test album',
    }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'cover://track-1.jpg?size=256',
      { signal: expect.any(AbortSignal) },
    );

    await waitFor(() => expect(metadataInits).toHaveLength(2));
    expect(metadataInits[1]).toEqual({
      title: 'Test title',
      artist: 'Test artist',
      album: 'Test album',
      artwork: [{
        src: 'data:image/png;base64,Y292ZXItYnl0ZXM=',
        sizes: '256x256',
        type: 'image/png',
      }],
    });
    expect(harness.session.metadata?.artwork).toEqual([{
      src: 'data:image/png;base64,Y292ZXItYnl0ZXM=',
      sizes: '256x256',
      type: 'image/png',
    }]);
  });

  it('does not let an old asynchronous cover overwrite metadata after a rapid track switch', async () => {
    const harness = installMediaSession();
    const pendingFetch = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(pendingFetch.promise);
    vi.stubGlobal('fetch', fetchMock);
    const readers = installControlledFileReader();
    const firstOptions = makeOptions({
      currentTrack: makeTrack({ coverUrl: 'cover://track-1.jpg' }),
    });
    const { rerender } = renderHook(
      ({ options }: { options: UseMediaSessionOptions }) => useMediaSession(options),
      { initialProps: { options: firstOptions } },
    );
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;

    rerender({
      options: makeOptions({
        currentTrack: makeTrack({
          id: 'track-2',
          title: 'Second title',
          artist: 'Second artist',
          album: 'Second album',
        }),
      }),
    });
    expect(firstSignal.aborted).toBe(true);
    expect(metadataInits.at(-1)).toEqual({
      title: 'Second title',
      artist: 'Second artist',
      album: 'Second album',
    });

    pendingFetch.resolve(responseWithBlob(new Blob(['stale'], { type: 'image/jpeg' })));
    await waitFor(() => expect(readers).toHaveLength(1));
    await act(async () => {
      readers[0]!.complete('data:image/jpeg;base64,c3RhbGU=');
      await Promise.resolve();
    });

    expect(metadataInits).toHaveLength(2);
    expect(metadataInits.at(-1)?.title).toBe('Second title');
    expect(harness.session.metadata?.title).toBe('Second title');
  });

  it('does not publish asynchronous artwork after the hook unmounts', async () => {
    const harness = installMediaSession();
    const fetchMock = vi.fn().mockResolvedValue(
      responseWithBlob(new Blob(['late'], { type: 'image/webp' })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const readers = installControlledFileReader();
    const { unmount } = renderHook(() => useMediaSession(makeOptions({
      currentTrack: makeTrack({ coverUrl: 'cover://track-1.jpg' }),
    })));

    await waitFor(() => expect(readers).toHaveLength(1));
    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);

    await act(async () => {
      readers[0]!.complete('data:image/webp;base64,bGF0ZQ==');
      await Promise.resolve();
    });

    expect(metadataInits).toHaveLength(1);
    expect(harness.metadataAssignments.at(-1)).toBeNull();
  });

  it('keeps text metadata when cover materialization fails', async () => {
    const harness = installMediaSession();
    const failure = new TypeError('cover protocol unavailable');
    const fetchMock = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('fetch', fetchMock);

    expect(() => renderHook(() => useMediaSession(makeOptions({
      currentTrack: makeTrack({ coverUrl: 'cover://track-1.jpg' }),
    })))).not.toThrow();

    await waitFor(() => expect(loggerMocks.debug).toHaveBeenCalledWith(
      '[MediaSession] Failed to materialize artwork:',
      failure,
    ));
    expect(metadataInits).toEqual([{
      title: 'Test title',
      artist: 'Test artist',
      album: 'Test album',
    }]);
    expect(harness.session.metadata).toMatchObject({
      title: 'Test title',
      artist: 'Test artist',
      album: 'Test album',
      artwork: [],
    });
  });

  it.each([
    'https://example.com/cover.png',
    'data:image/png;base64,Y292ZXI=',
    'blob:https://example.com/cover-id',
  ])('publishes %s artwork directly without fetching it', (coverUrl) => {
    const harness = installMediaSession();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useMediaSession(makeOptions({
      currentTrack: makeTrack({ coverUrl }),
    })));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(metadataInits.at(-1)?.artwork).toEqual([{
      src: coverUrl,
      sizes: '256x256',
    }]);
    expect(harness.session.metadata?.artwork).toEqual([{
      src: coverUrl,
      sizes: '256x256',
    }]);
  });

  it('publishes playing, paused, and no-track playback states', () => {
    const harness = installMediaSession();
    const { rerender } = renderHook(
      ({ options }: { options: UseMediaSessionOptions }) => useMediaSession(options),
      { initialProps: { options: makeOptions({ isPlaying: false }) } },
    );

    expect(harness.playbackStateAssignments.at(-1)).toBe('paused');

    rerender({ options: makeOptions({ isPlaying: true }) });
    expect(harness.playbackStateAssignments.at(-1)).toBe('playing');

    rerender({ options: makeOptions({ currentTrack: null, duration: 0 }) });
    expect(harness.playbackStateAssignments.at(-1)).toBe('none');
  });

  it('publishes a sanitized exact position and clears stale invalid position state', () => {
    const harness = installMediaSession();
    const exactTime = vi.fn(() => -5);
    const baseOptions = makeOptions({ getCurrentPlaybackTime: exactTime });
    const { rerender } = renderHook(
      ({ options }: { options: UseMediaSessionOptions }) => useMediaSession(options),
      { initialProps: { options: baseOptions } },
    );

    expect(harness.setPositionState).toHaveBeenLastCalledWith({
      duration: 120,
      playbackRate: 1,
      position: 0,
    });

    exactTime.mockReturnValue(180);
    rerender({ options: { ...baseOptions, currentTime: 26 } });
    expect(harness.setPositionState).toHaveBeenLastCalledWith({
      duration: 120,
      playbackRate: 1,
      position: 120,
    });

    exactTime.mockReturnValue(Number.NaN);
    rerender({ options: { ...baseOptions, currentTime: 27 } });
    expect(harness.setPositionState.mock.calls.at(-1)).toEqual([]);

    rerender({ options: { ...baseOptions, currentTime: 28, duration: 0 } });
    expect(harness.setPositionState.mock.calls.at(-1)).toEqual([]);

    rerender({ options: { ...baseOptions, currentTime: 29, duration: Number.POSITIVE_INFINITY } });
    expect(harness.setPositionState.mock.calls.at(-1)).toEqual([]);
  });

  it('samples the guarded exact clock instead of publishing the throttled render clock', () => {
    const harness = installMediaSession();
    const exactTime = vi.fn(() => 0);

    renderHook(() => useMediaSession(makeOptions({
      currentTime: 97,
      duration: 120,
      getCurrentPlaybackTime: exactTime,
    })));

    expect(exactTime).toHaveBeenCalled();
    expect(harness.setPositionState).toHaveBeenLastCalledWith({
      duration: 120,
      playbackRate: 1,
      position: 0,
    });
  });

  it('keeps play and pause idempotent and dispatches the latest transport callbacks', () => {
    const harness = installMediaSession();
    const firstToggle = vi.fn();
    const firstNext = vi.fn();
    const initialOptions = makeOptions({
      isPlaying: false,
      togglePlay: firstToggle,
      next: firstNext,
    });
    const { rerender } = renderHook(
      ({ options }: { options: UseMediaSessionOptions }) => useMediaSession(options),
      { initialProps: { options: initialOptions } },
    );

    invokeAction(harness.handlers, 'play');
    invokeAction(harness.handlers, 'pause');
    expect(firstToggle).toHaveBeenCalledTimes(1);

    const latestToggle = vi.fn();
    const latestNext = vi.fn();
    const latestPrevious = vi.fn();
    rerender({
      options: {
        ...initialOptions,
        isPlaying: true,
        togglePlay: latestToggle,
        next: latestNext,
        previous: latestPrevious,
      },
    });

    invokeAction(harness.handlers, 'play');
    invokeAction(harness.handlers, 'pause');
    invokeAction(harness.handlers, 'nexttrack');
    invokeAction(harness.handlers, 'previoustrack');

    expect(latestToggle).toHaveBeenCalledTimes(1);
    expect(latestNext).toHaveBeenCalledTimes(1);
    expect(latestPrevious).toHaveBeenCalledTimes(1);
    expect(firstNext).not.toHaveBeenCalled();
  });

  it('handles absolute and relative seeks with defaults, clamping, and invalid input', () => {
    const harness = installMediaSession();
    const seek = vi.fn();
    const exactTime = vi.fn(() => 50);

    renderHook(() => useMediaSession(makeOptions({
      duration: 120,
      getCurrentPlaybackTime: exactTime,
      seek,
    })));

    invokeAction(harness.handlers, 'seekto', { seekTime: 999 });
    invokeAction(harness.handlers, 'seekbackward', { seekOffset: 7 });
    invokeAction(harness.handlers, 'seekbackward');
    invokeAction(harness.handlers, 'seekforward', { seekOffset: 100 });
    invokeAction(harness.handlers, 'seekforward');
    invokeAction(harness.handlers, 'seekto', { seekTime: Number.NaN });

    expect(seek.mock.calls).toEqual([
      [120],
      [43],
      [40],
      [120],
      [60],
    ]);
  });

  it('continues registering supported actions when one action is rejected', () => {
    const harness = installMediaSession({ unsupportedAction: 'play' });

    const { unmount } = renderHook(() => useMediaSession(makeOptions()));

    expect(harness.setActionHandler).toHaveBeenCalledTimes(7);
    expect(harness.handlers.has('play')).toBe(false);
    expect(harness.handlers.get('pause')).toBeTypeOf('function');
    expect(harness.handlers.get('nexttrack')).toBeTypeOf('function');
    expect(harness.handlers.get('seekforward')).toBeTypeOf('function');
    expect(loggerMocks.debug).toHaveBeenCalledWith(
      '[MediaSession] Action is unavailable: play',
      expect.any(DOMException),
    );

    unmount();
    const clearedActions = harness.setActionHandler.mock.calls
      .filter(([, handler]) => handler === null)
      .map(([action]) => action);
    expect(clearedActions).not.toContain('play');
    expect(clearedActions).toHaveLength(6);
  });

  it('falls back to text metadata when direct artwork construction fails', () => {
    const attempts: MediaMetadataInit[] = [];
    class ArtworkRejectingMetadata extends MockMediaMetadata {
      constructor(init: MediaMetadataInit = {}) {
        attempts.push(init);
        if (init.artwork) {
          throw new DOMException('Artwork URL rejected', 'TypeError');
        }
        super(init);
      }
    }
    vi.stubGlobal('MediaMetadata', ArtworkRejectingMetadata);
    const harness = installMediaSession();

    renderHook(() => useMediaSession(makeOptions({
      currentTrack: makeTrack({ coverUrl: 'data:image/png;base64,YmFkLWFydA==' }),
    })));

    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.artwork).toEqual([{
      src: 'data:image/png;base64,YmFkLWFydA==',
      sizes: '256x256',
    }]);
    expect(attempts[1]).toEqual({
      title: 'Test title',
      artist: 'Test artist',
      album: 'Test album',
    });
    expect(harness.session.metadata).toMatchObject({
      title: 'Test title',
      artist: 'Test artist',
      album: 'Test album',
      artwork: [],
    });
  });

  it('contains platform errors without interrupting the player', () => {
    installMediaSession({
      unsupportedAction: 'play',
      throwOnMetadataSet: true,
      throwOnPlaybackStateSet: true,
      throwOnPositionState: true,
    });

    expect(() => renderHook(() => useMediaSession(makeOptions()))).not.toThrow();
    expect(loggerMocks.debug).toHaveBeenCalled();
    expect(loggerMocks.warn).toHaveBeenCalled();
  });

  it('unregisters actions and clears published state on unmount', () => {
    const harness = installMediaSession();
    const { unmount } = renderHook(() => useMediaSession(makeOptions({ isPlaying: true })));

    unmount();

    const clearedActions = harness.setActionHandler.mock.calls
      .filter(([, handler]) => handler === null)
      .map(([action]) => action);
    expect(clearedActions).toEqual([
      'play',
      'pause',
      'previoustrack',
      'nexttrack',
      'seekto',
      'seekbackward',
      'seekforward',
    ]);
    expect(harness.metadataAssignments.at(-1)).toBeNull();
    expect(harness.playbackStateAssignments.at(-1)).toBe('none');
    expect(harness.setPositionState.mock.calls.at(-1)).toEqual([]);
  });
});
