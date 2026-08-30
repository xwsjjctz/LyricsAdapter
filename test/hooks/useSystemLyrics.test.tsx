import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';
import type { SystemLyricsAction } from '@/types/systemLyrics';

const mocks = vi.hoisted(() => ({
  platform: 'darwin',
  update: vi.fn(),
  onAction: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => ({
    platform: mocks.platform,
    ipc: {
      systemLyrics: {
        update: mocks.update,
        onAction: mocks.onAction,
      },
    },
  }),
}));
vi.mock('@/services/logger', () => ({
  logger: { warn: vi.fn() },
}));

import { useSystemLyrics, type UseSystemLyricsOptions } from '@/hooks/useSystemLyrics';

const track: Track = {
  id: 'track-1',
  title: 'Test title',
  artist: 'Test artist',
  album: 'Test album',
  duration: 30,
  audioUrl: 'audio://track-1',
  syncedLyrics: [
    { time: 0, text: 'First line' },
    { time: 5, text: 'Second line' },
  ],
};
const longLine = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰';

function makeOptions(overrides: Partial<UseSystemLyricsOptions> = {}): UseSystemLyricsOptions {
  const currentTime = overrides.currentTime ?? 1;
  return {
    currentTrack: track,
    currentTime,
    isPlaying: true,
    getCurrentPlaybackTime: () => currentTime,
    togglePlay: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    ...overrides,
  };
}

describe('useSystemLyrics', () => {
  let actionListener: ((action: SystemLyricsAction) => void) | undefined;

  beforeEach(() => {
    actionListener = undefined;
    mocks.platform = 'darwin';
    mocks.update.mockReset().mockResolvedValue({ ok: true, data: undefined });
    mocks.unsubscribe.mockReset();
    mocks.onAction.mockReset().mockImplementation((callback: (action: SystemLyricsAction) => void) => {
      actionListener = callback;
      return mocks.unsubscribe;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes only when the native-facing state changes', async () => {
    const { rerender } = renderHook(
      ({ options }: { options: UseSystemLyricsOptions }) => useSystemLyrics(options),
      { initialProps: { options: makeOptions() } },
    );

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({
      line: 'First line',
      nextLine: 'Second line',
    }));

    rerender({ options: makeOptions({ currentTime: 4.9 }) });
    expect(mocks.update).toHaveBeenCalledTimes(1);

    rerender({ options: makeOptions({ currentTime: 5 }) });
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({
      line: 'Second line',
      nextLine: '',
    }));
  });

  it('serializes updates and publishes the latest desired generation after an older request', async () => {
    let resolveFirst!: (value: { ok: true; data: undefined }) => void;
    let resolveSecond!: (value: { ok: true; data: undefined }) => void;
    const first = new Promise<{ ok: true; data: undefined }>(resolve => {
      resolveFirst = resolve;
    });
    const second = new Promise<{ ok: true; data: undefined }>(resolve => {
      resolveSecond = resolve;
    });
    mocks.update.mockReset()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockResolvedValue({ ok: true, data: undefined });

    const { rerender } = renderHook(
      ({ options }: { options: UseSystemLyricsOptions }) => useSystemLyrics(options),
      { initialProps: { options: makeOptions() } },
    );
    expect(mocks.update).toHaveBeenCalledTimes(1);

    rerender({ options: makeOptions({ currentTime: 5 }) });
    expect(mocks.update).toHaveBeenCalledTimes(1);

    await act(async () => resolveFirst({ ok: true, data: undefined }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({
      line: 'Second line',
    }));

    rerender({ options: makeOptions({ currentTime: 5.5 }) });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    await act(async () => resolveSecond({ ok: true, data: undefined }));
  });

  it('retries a failed unchanged snapshot with a bounded delay', async () => {
    vi.useFakeTimers();
    mocks.update.mockReset()
      .mockResolvedValueOnce({ ok: false, error: 'native unavailable' })
      .mockResolvedValue({ ok: true, data: undefined });

    const { rerender, unmount } = renderHook(
      ({ options }: { options: UseSystemLyricsOptions }) => useSystemLyrics(options),
      { initialProps: { options: makeOptions() } },
    );
    await act(async () => Promise.resolve());
    expect(mocks.update).toHaveBeenCalledTimes(1);

    rerender({ options: makeOptions({ currentTime: 2 }) });
    expect(mocks.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(mocks.update).toHaveBeenCalledTimes(2);

    unmount();
    vi.useRealTimers();
  });

  it('samples the exact playback clock every 50ms and deduplicates unchanged cursors', async () => {
    vi.useFakeTimers();
    let playbackTime = 0;
    const wordTimedTrack: Track = {
      ...track,
      syncedLyrics: [{
        time: 0,
        text: longLine,
        words: [{ time: 0, duration: 2, text: longLine }],
      }],
    };

    const { unmount } = renderHook(() => useSystemLyrics(makeOptions({
      currentTrack: wordTimedTrack,
      currentTime: 0,
      getCurrentPlaybackTime: () => playbackTime,
    })));
    await act(async () => Promise.resolve());
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ lineCursor: 0 }));

    playbackTime = 0.05;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(49);
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);

    playbackTime = 1;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(49);
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ lineCursor: 12 }));

    unmount();
  });

  it('keeps the retry backoff while cursor samples replace the desired snapshot', async () => {
    vi.useFakeTimers();
    let playbackTime = 0;
    const wordTimedTrack: Track = {
      ...track,
      syncedLyrics: [{
        time: 0,
        text: longLine,
        words: [{ time: 0, duration: 2, text: longLine }],
      }],
    };
    mocks.update.mockReset()
      .mockResolvedValueOnce({ ok: false, error: 'native unavailable' })
      .mockResolvedValue({ ok: true, data: undefined });

    const { unmount } = renderHook(() => useSystemLyrics(makeOptions({
      currentTrack: wordTimedTrack,
      currentTime: 0,
      getCurrentPlaybackTime: () => playbackTime,
    })));
    await act(async () => Promise.resolve());
    expect(mocks.update).toHaveBeenCalledTimes(1);

    playbackTime = 0.5;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    playbackTime = 1;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(149);
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({
      lineCursor: 12,
    }));

    unmount();
  });

  it('does not start high-frequency cursor sampling outside macOS', async () => {
    vi.useFakeTimers();
    mocks.platform = 'win32';
    let playbackTime = 0;
    const wordTimedTrack: Track = {
      ...track,
      syncedLyrics: [{
        time: 0,
        text: longLine,
        words: [{ time: 0, duration: 2, text: longLine }],
      }],
    };
    const { rerender, unmount } = renderHook(
      ({ options }: { options: UseSystemLyricsOptions }) => useSystemLyrics(options),
      {
        initialProps: {
          options: makeOptions({
            currentTrack: wordTimedTrack,
            currentTime: 0,
            getCurrentPlaybackTime: () => playbackTime,
          }),
        },
      },
    );
    await act(async () => Promise.resolve());
    expect(mocks.update).toHaveBeenCalledTimes(1);

    playbackTime = 1;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);

    rerender({
      options: makeOptions({
        currentTrack: wordTimedTrack,
        currentTime: 1,
        getCurrentPlaybackTime: () => playbackTime,
      }),
    });
    await act(async () => Promise.resolve());
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({
      lineCursor: 12,
    }));

    unmount();
  });

  it('keeps one action subscription, uses latest callbacks, and ignores unknown actions', async () => {
    const firstNext = vi.fn();
    const latestNext = vi.fn();
    const latestPrevious = vi.fn();
    const latestTogglePlay = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ options }: { options: UseSystemLyricsOptions }) => useSystemLyrics(options),
      { initialProps: { options: makeOptions({ next: firstNext }) } },
    );
    await waitFor(() => expect(actionListener).toBeTypeOf('function'));

    rerender({ options: makeOptions({
      next: latestNext,
      previous: latestPrevious,
      togglePlay: latestTogglePlay,
    }) });
    act(() => {
      actionListener?.('next');
      actionListener?.('not-an-action' as SystemLyricsAction);
    });

    expect(firstNext).not.toHaveBeenCalled();
    expect(latestNext).toHaveBeenCalledTimes(1);
    expect(latestPrevious).not.toHaveBeenCalled();
    expect(latestTogglePlay).not.toHaveBeenCalled();
    expect(mocks.onAction).toHaveBeenCalledTimes(1);

    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenLastCalledWith({
      trackId: null,
      title: '',
      artist: '',
      line: '',
      nextLine: '',
      lineCursor: null,
      isPlaying: false,
    });
  });
});
