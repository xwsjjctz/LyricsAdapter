import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryVirtualScroll } from '../../src/hooks/useLibraryVirtualScroll';

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

function makeRef(clientHeight: number): React.RefObject<HTMLDivElement> {
  const node = document.createElement('div');
  Object.defineProperty(node, 'clientHeight', { configurable: true, value: clientHeight });
  return { current: node };
}

describe('useLibraryVirtualScroll', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  it('uses a bounded initial window before the viewport can be measured', () => {
    const scrollContainerRef = makeRef(0);
    const listRef = makeRef(0);

    const { result } = renderHook(() => useLibraryVirtualScroll({
      itemCount: 500,
      scrollTop: 0,
      scrollContainerRef,
      listRef,
      isEditMode: false,
    }));

    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBeGreaterThan(0);
    expect(result.current.endIndex).toBeLessThan(30);
    expect(result.current.visibleCount).toBe(result.current.endIndex);
    expect(result.current.paddingBottom).toBeGreaterThan(0);
  });

  it('covers a tall window before the viewport can be measured', () => {
    const innerHeight = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1600);
    const scrollContainerRef = makeRef(0);
    const listRef = makeRef(0);

    const { result } = renderHook(() => useLibraryVirtualScroll({
      itemCount: 500,
      scrollTop: 0,
      scrollContainerRef,
      listRef,
      isEditMode: false,
    }));

    expect(result.current.endIndex)
      .toBe(Math.ceil(1600 / result.current.rowStride) + 6);
    expect(result.current.endIndex).toBeLessThan(500);
    innerHeight.mockRestore();
  });

  it('centres the initial window around a restored scroll position', () => {
    const scrollContainerRef = makeRef(0);
    const listRef = makeRef(0);

    const { result } = renderHook(() => useLibraryVirtualScroll({
      itemCount: 500,
      scrollTop: 7200,
      scrollContainerRef,
      listRef,
      isEditMode: false,
    }));

    const expectedStart = Math.floor(7200 / result.current.rowStride) - 6;
    expect(result.current.startIndex).toBe(expectedStart);
    expect(result.current.endIndex).toBeGreaterThan(expectedStart);
    expect(result.current.endIndex - result.current.startIndex).toBeLessThan(30);
    expect(result.current.paddingTop).toBe(expectedStart * result.current.rowStride);
  });

  it('keeps small libraries fully rendered', () => {
    const scrollContainerRef = makeRef(0);
    const listRef = makeRef(0);

    const { result } = renderHook(() => useLibraryVirtualScroll({
      itemCount: 40,
      scrollTop: 0,
      scrollContainerRef,
      listRef,
      isEditMode: false,
    }));

    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(40);
    expect(result.current.paddingBottom).toBe(0);
  });

  it('clamps a stale restored scroll position to the final row', () => {
    const scrollContainerRef = makeRef(0);
    const listRef = makeRef(0);

    const { result } = renderHook(() => useLibraryVirtualScroll({
      itemCount: 75,
      scrollTop: 100_000,
      scrollContainerRef,
      listRef,
      isEditMode: false,
    }));

    expect(result.current.startIndex).toBe(74);
    expect(result.current.endIndex).toBe(75);
    expect(result.current.visibleCount).toBe(1);
  });
});
