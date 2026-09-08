import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarySlot, SlotId } from '@/types';
import { createEmptySlot } from '@/types';

const mocks = vi.hoisted(() => ({
  updateSlot: vi.fn(),
  switchSlot: vi.fn(async () => undefined),
  slots: {
    local: null as unknown as LibrarySlot,
    cloud: null as unknown as LibrarySlot,
    online: null as unknown as LibrarySlot,
    playlist: null as unknown as LibrarySlot,
  },
  hasConfig: vi.fn(() => false),
}));

vi.mock('@/hooks/useLibrarySlots', () => ({
  useLibrarySlots: () => ({
    slots: mocks.slots,
    updateSlot: mocks.updateSlot,
    viewSlot: 'local' as SlotId,
  }),
}));

vi.mock('@/hooks/useGsapSlotTransition', () => ({
  useGsapSlotTransition: () => ({
    containerRef: { current: null },
    switchSlot: mocks.switchSlot,
    completeEnter: vi.fn(),
  }),
}));

vi.mock('@/services/webdavClient', () => ({
  webdavClient: { hasConfig: mocks.hasConfig },
}));

import { useLibraryStore } from '@/stores/libraryStore';

function slotWith(scrollPosition: number): LibrarySlot {
  return { ...createEmptySlot('local'), scrollPosition };
}

/** Apply the updater that updateSlot received and return the resulting slot. */
function appliedSlot(callIndex: number): LibrarySlot {
  const call = mocks.updateSlot.mock.calls[callIndex];
  const updater = call?.[1] as ((slot: LibrarySlot) => LibrarySlot) | undefined;
  if (!updater) throw new Error(`updateSlot call ${callIndex} had no updater`);
  return updater(slotWith(0));
}

describe('useLibraryStore scroll position commits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.updateSlot.mockClear();
    mocks.switchSlot.mockClear();
    mocks.slots.local = slotWith(0);
    mocks.slots.cloud = { ...createEmptySlot('cloud'), scrollPosition: 40 };
    mocks.slots.online = createEmptySlot('online');
    mocks.slots.playlist = createEmptySlot('playlist');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps scroll events in a ref and commits once after scrolling settles', () => {
    const { result } = renderHook(() => useLibraryStore());

    act(() => {
      result.current.handleLibraryScrollPositionChange(120);
      result.current.handleLibraryScrollPositionChange(260);
      result.current.handleLibraryScrollPositionChange(300);
    });

    expect(mocks.updateSlot).not.toHaveBeenCalled();
    expect(result.current.getLiveScrollPosition()).toEqual({ slot: 'local', position: 300 });

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(mocks.updateSlot).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(mocks.updateSlot).toHaveBeenCalledTimes(1);
    expect(mocks.updateSlot.mock.calls[0]?.[0]).toBe('local');
    expect(appliedSlot(0).scrollPosition).toBe(300);
  });

  it('does not rewrite slot state when the committed position is unchanged', () => {
    const { result } = renderHook(() => useLibraryStore());

    act(() => {
      result.current.handleLibraryScrollPositionChange(0);
      vi.advanceTimersByTime(250);
    });

    expect(mocks.updateSlot).toHaveBeenCalledTimes(1);
    // The updater must return the identical slot object so React can bail out.
    const call = mocks.updateSlot.mock.calls[0];
    const updater = call?.[1] as (slot: LibrarySlot) => LibrarySlot;
    const existing = slotWith(0);
    expect(updater(existing)).toBe(existing);
  });

  it('flushes the live position immediately on a slot switch and cancels the pending commit', async () => {
    const { result } = renderHook(() => useLibraryStore());

    act(() => {
      result.current.handleLibraryScrollPositionChange(512);
    });

    await act(async () => {
      await result.current.handleSwitchSlot('cloud');
    });

    expect(mocks.updateSlot).toHaveBeenCalledTimes(1);
    expect(mocks.updateSlot.mock.calls[0]?.[0]).toBe('local');
    expect(appliedSlot(0).scrollPosition).toBe(512);
    expect(mocks.switchSlot).toHaveBeenCalledWith('cloud');
    // The ref now belongs to the incoming slot and carries its saved position.
    expect(result.current.getLiveScrollPosition()).toEqual({ slot: 'cloud', position: 40 });

    // A late scroll/unmount callback from the outgoing LibraryView must not
    // overwrite the new slot's position.
    act(() => {
      result.current.handleLibraryScrollPositionChange(999);
    });
    expect(result.current.getLiveScrollPosition()).toEqual({ slot: 'cloud', position: 40 });

    // The debounced commit was cancelled, so no duplicate write lands later.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(mocks.updateSlot).toHaveBeenCalledTimes(1);
  });

  it('clears a pending commit when the store unmounts', () => {
    const { result, unmount } = renderHook(() => useLibraryStore());

    act(() => {
      result.current.handleLibraryScrollPositionChange(88);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(mocks.updateSlot).not.toHaveBeenCalled();
  });
});
