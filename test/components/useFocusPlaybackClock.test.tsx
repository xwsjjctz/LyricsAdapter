import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFocusPlaybackClock } from '@/components/focus-mode/useFocusPlaybackClock';

describe('useFocusPlaybackClock', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an old React clock when Focus mounts during a debounced track switch', () => {
    const getCurrentPlaybackTime = vi.fn(() => 0);
    const { result } = renderHook(() => useFocusPlaybackClock({
      trackId: 'new-track',
      isVisible: true,
      currentTime: 7.75,
      isPlaying: true,
      getCurrentPlaybackTime,
    }));

    expect(result.current.activeCurrentTime).toBe(0);
    expect(result.current.realtimeCurrentTimeRef.current).toBe(0);
  });

  it('never rehydrates a paused clock from an unowned currentTime prop', () => {
    const getCurrentPlaybackTime = vi.fn(() => 0);
    const { result, rerender } = renderHook(
      ({ currentTime }) => useFocusPlaybackClock({
        trackId: 'new-track',
        isVisible: true,
        currentTime,
        isPlaying: false,
        getCurrentPlaybackTime,
      }),
      { initialProps: { currentTime: 7.75 } },
    );

    act(() => rerender({ currentTime: 8.5 }));

    expect(result.current.activeCurrentTime).toBe(0);
    expect(result.current.realtimeCurrentTimeRef.current).toBe(0);
  });
});
