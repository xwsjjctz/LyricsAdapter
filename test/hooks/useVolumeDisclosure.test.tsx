import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVolumeDisclosure } from '@/hooks/useVolumeDisclosure';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('volume disclosure across web/native controls', () => {
  it('keeps the strip open when the pointer crosses onto the native slider', () => {
    const { result } = renderHook(() => useVolumeDisclosure(true));
    act(() => { result.current.enter(); result.current.open(); result.current.leave(); });
    act(() => result.current.onNativePresence(true));
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.expanded).toBe(true);
    act(() => result.current.onNativePresence(false));
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.expanded).toBe(false);
  });
  it('ignores a late native exit after the pointer returns to the speaker', () => {
    const { result } = renderHook(() => useVolumeDisclosure(true));
    act(() => { result.current.onNativePresence(true); result.current.enter(); result.current.open(); result.current.onNativePresence(false); });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.expanded).toBe(true);
    act(() => result.current.leave());
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.expanded).toBe(false);
  });
  it('closes and clears presence when the player is hidden', () => {
    const { result, rerender } = renderHook(({ visible }) => useVolumeDisclosure(visible), { initialProps: { visible: true } });
    act(() => result.current.onNativePresence(true));
    rerender({ visible: false });
    expect(result.current.expanded).toBe(false);
    rerender({ visible: true });
    expect(result.current.expanded).toBe(false);
  });
});
