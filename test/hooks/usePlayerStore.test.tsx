import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const playbackMock = vi.hoisted(() => ({
  options: [] as { initialCurrentTime: number }[],
}));

vi.mock('@/hooks/usePlayback', () => ({
  usePlayback: (options: { initialCurrentTime: number }) => {
    playbackMock.options.push(options);
    return { currentTime: 0, volume: 0.5, playbackMode: 'order' };
  },
}));

vi.mock('@/hooks/useBlobUrls', () => ({
  useBlobUrls: () => ({
    activeBlobUrlsRef: { current: new Set<string>() },
    createTrackedBlobUrl: vi.fn(),
    revokeBlobUrl: vi.fn(),
  }),
}));

import { usePlayerStore } from '@/hooks/usePlayerStore';

describe('usePlayerStore restore time', () => {
  it('hands a restored position to playback once, then clears it', () => {
    const { result, rerender } = renderHook(
      ({ index }: { index: number }) => usePlayerStore({
        activeTracks: [],
        activeTrackIndex: index,
        setActiveTracks: vi.fn(),
        setActiveTrackIndex: vi.fn(),
        onTrackSwitch: vi.fn(),
      }),
      { initialProps: { index: 0 } },
    );

    act(() => { result.current.setRestoreTime(42); });
    // One render hands the position to playback, then the one-shot value clears.
    expect(playbackMock.options.some(options => options.initialCurrentTime === 42)).toBe(true);
    expect(result.current.restoreTime).toBe(0);

    rerender({ index: 1 });
    expect(playbackMock.options.at(-1)?.initialCurrentTime).toBe(0);
  });
});
