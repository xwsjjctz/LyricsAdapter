import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarySlot } from '@/types';
import { createEmptySlot } from '@/types';
import { createLibraryState, type LibraryStateStore } from '@/stores/libraryState';

const mocks = vi.hoisted(() => ({
  switchSlot: vi.fn(async () => undefined),
  hasConfig: vi.fn(() => false),
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

import { useLibraryStore } from '@/hooks/useLibraryStore';

function slotWith(scrollPosition: number): LibrarySlot {
  return { ...createEmptySlot('local'), scrollPosition };
}

/** A store seeded with saved offsets, plus a counter of state changes. */
function seededStore(localPosition = 0): { store: LibraryStateStore; writes: () => number } {
  const store = createLibraryState();
  store.setState(state => ({
    ...state,
    slots: { ...state.slots, local: slotWith(localPosition), cloud: { ...createEmptySlot('cloud'), scrollPosition: 40 } },
  }));
  let count = 0;
  store.subscribe(() => { count++; });
  return { store, writes: () => count };
}

describe('useLibraryStore scroll position commits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.switchSlot.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps scroll events in a ref and commits once after scrolling settles', () => {
    const { store, writes } = seededStore();
    const { result } = renderHook(() => useLibraryStore(store));

    act(() => {
      result.current.handleLibraryScrollPositionChange(120);
      result.current.handleLibraryScrollPositionChange(260);
      result.current.handleLibraryScrollPositionChange(300);
    });

    expect(writes()).toBe(0);
    expect(result.current.getLiveScrollPosition()).toEqual({ slot: 'local', position: 300 });

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(writes()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(writes()).toBe(1);
    expect(store.getState().slots.local.scrollPosition).toBe(300);
  });

  it('does not rewrite slot state when the committed position is unchanged', () => {
    const { store, writes } = seededStore();
    const before = store.getState().slots.local;
    const { result } = renderHook(() => useLibraryStore(store));

    act(() => {
      result.current.handleLibraryScrollPositionChange(0);
      vi.advanceTimersByTime(250);
    });

    // The identical slot leaves the store untouched, so nothing re-renders.
    expect(writes()).toBe(0);
    expect(store.getState().slots.local).toBe(before);
  });

  it('flushes the live position immediately on a slot switch and cancels the pending commit', async () => {
    const { store, writes } = seededStore();
    const { result } = renderHook(() => useLibraryStore(store));

    act(() => {
      result.current.handleLibraryScrollPositionChange(512);
    });

    await act(async () => {
      await result.current.handleSwitchSlot('cloud');
    });

    expect(writes()).toBe(1);
    expect(store.getState().slots.local.scrollPosition).toBe(512);
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
    expect(writes()).toBe(1);
  });

  it('clears a pending commit when the store unmounts', () => {
    const { store, writes } = seededStore();
    const { result, unmount } = renderHook(() => useLibraryStore(store));

    act(() => {
      result.current.handleLibraryScrollPositionChange(88);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(writes()).toBe(0);
  });
});

describe('useLibraryStore restoring saved offsets at startup', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('keeps an offset restored after mount, so an unscrolled quit does not save 0', () => {
    const { store } = seededStore();
    const { result } = renderHook(() => useLibraryStore(store));
    act(() => {
      store.setState(state => ({ ...state, slots: { ...state.slots, local: slotWith(500) } }));
    });
    expect(result.current.getLiveScrollPosition()).toEqual({ slot: 'local', position: 500 });
  });

  it('tracks a view slot restored without a switch, so its scrolling is saved', () => {
    const { store } = seededStore();
    const { result } = renderHook(() => useLibraryStore(store));
    // Startup restore sets the view directly, not through handleSwitchSlot.
    act(() => { result.current.setViewSlot('cloud'); });
    expect(store.getState().viewSlot).toBe('cloud');
    expect(result.current.getLiveScrollPosition()).toEqual({ slot: 'cloud', position: 40 });
    act(() => { result.current.handleLibraryScrollPositionChange(320); });
    expect(result.current.getLiveScrollPosition()).toEqual({ slot: 'cloud', position: 320 });
  });
});

describe('library slot writes', () => {
  it('applies updates immediately so the next read sees them before a render', () => {
    const { store } = seededStore();
    const { result } = renderHook(() => useLibraryStore(store));
    act(() => {
      result.current.updateSlot('local', slot => ({ ...slot, currentTrackIndex: 3 }));
      expect(result.current.getSlots().local.currentTrackIndex).toBe(3);
    });
  });
});
