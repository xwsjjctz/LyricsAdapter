import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const playbackMock = vi.hoisted(() => ({
  currentTime: 0,
  volume: 0.5,
  playbackMode: 'order' as const,
}));

vi.mock('@/hooks/usePlayback', () => ({
  usePlayback: () => playbackMock,
}));

vi.mock('@/hooks/useBlobUrls', () => ({
  useBlobUrls: () => ({
    activeBlobUrlsRef: { current: new Set<string>() },
    createTrackedBlobUrl: vi.fn(),
    revokeBlobUrl: vi.fn(),
  }),
}));

import { usePlayerStore } from '@/stores/playerStore';

describe('usePlayerStore playback clock boundary', () => {
  it('does not copy each playback time tick into slot state', () => {
    const updateSlot = vi.fn();
    const { rerender } = renderHook(
      ({ currentTime }: { currentTime: number }) => {
        playbackMock.currentTime = currentTime;
        return usePlayerStore({
          activeTracks: [],
          activeTrackIndex: -1,
          activeSlotId: 'local',
          setActiveTracks: vi.fn(),
          setActiveTrackIndex: vi.fn(),
          updateSlot,
          onTrackSwitch: vi.fn(),
        });
      },
      { initialProps: { currentTime: 0 } },
    );

    // Initial volume and playback-mode synchronization are unrelated to the
    // clock. A later clock-only render must not enqueue another slot update.
    updateSlot.mockClear();
    rerender({ currentTime: 0.25 });
    rerender({ currentTime: 0.5 });

    expect(updateSlot).not.toHaveBeenCalled();
  });
});
