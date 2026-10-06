import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVolumeDisclosure } from '@/hooks/useVolumeDisclosure';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('hover volume disclosure', () => {
  it('bridges the pointer gap and closes half a second after leaving', () => {
    const { result } = renderHook(() => useVolumeDisclosure(true));
    act(() => { result.current.enter(); result.current.leave(); });
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.expanded).toBe(true);
    act(() => result.current.enter());
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.expanded).toBe(true);
    act(() => result.current.leave());
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.expanded).toBe(false);
  });
  it('consumes Escape only while open and releases listeners and timers on unmount', () => {
    const { result, unmount } = renderHook(() => useVolumeDisclosure(true));
    act(() => result.current.enter());
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => document.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(result.current.expanded).toBe(false);
    act(() => { result.current.enter(); result.current.leave(); });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    const after = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
  it('closes when the player or its window is hidden', () => {
    const { result, rerender } = renderHook(({ visible }) => useVolumeDisclosure(visible), { initialProps: { visible: true } });
    act(() => result.current.enter());
    act(() => window.dispatchEvent(new Event('blur')));
    expect(result.current.expanded).toBe(false);
    act(() => result.current.enter());
    rerender({ visible: false });
    rerender({ visible: true });
    expect(result.current.expanded).toBe(false);
  });
});
