import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFocusGlassPresentation, useFocusGlassControls } from '@/components/focus-mode/useFocusGlassControls';
import type { FocusGlassAction } from '@/types/focusGlass';
const mocks = vi.hoisted(() => ({ platform: 'darwin', start: vi.fn(), update: vi.fn(), stop: vi.fn(), onAction: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPI: () => ({ platform: mocks.platform, ipc: { focusGlass: mocks } }) }));
const options = () => ({
  anchorRef: { current: null }, focusVisible: true, visible: true, enabled: true, isPlaying: false, currentTime: 10, duration: 60, volume: 0.5, playbackMode: 'order' as const, scale: 1,
  onSeek: vi.fn(), onTogglePlay: vi.fn(), onSkipNext: vi.fn(), onSkipPrev: vi.fn(), onVolumeChange: vi.fn(), onToggleMute: vi.fn(),
  onTogglePlaybackMode: vi.fn(), onMouseEnter: vi.fn(), onMouseLeave: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.platform = 'darwin';
  mocks.start.mockResolvedValue({ ok: true, data: true }); mocks.update.mockResolvedValue({ ok: true });
  mocks.stop.mockResolvedValue({ ok: true }); mocks.onAction.mockReturnValue(mocks.unsubscribe);
});
describe('useFocusGlassControls', () => {
  it('forwards intents to the latest callbacks and releases the surface on unmount', async () => {
    const first = options();
    const { result, rerender, unmount } = renderHook(props => useFocusGlassControls(props), { initialProps: first });
    await waitFor(() => expect(result.current).toBe(true));
    const latest = options(); rerender(latest);
    const emit = mocks.onAction.mock.calls[0]![0] as (event: FocusGlassAction) => void;
    act(() => { emit({ type: 'toggle-play', value: 0 }); emit({ type: 'seek', value: 80 }); emit({ type: 'volume', value: -1 }); });
    expect(first.onTogglePlay).not.toHaveBeenCalled();
    expect(latest.onTogglePlay).toHaveBeenCalledOnce();
    expect(latest.onSeek).toHaveBeenCalledWith(60);
    expect(latest.onVolumeChange).toHaveBeenCalledWith(0);
    expect(mocks.start).toHaveBeenCalledOnce();
    unmount();
    expect(mocks.stop).toHaveBeenCalledOnce(); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
  it('leaves Windows on its existing controls', () => {
    mocks.platform = 'win32';
    const { result } = renderHook(() => useFocusGlassControls(options()));
    expect(result.current).toBe(false); expect(mocks.start).not.toHaveBeenCalled();
  });
  it('falls back when AppKit cannot update the surface', async () => {
    mocks.update.mockResolvedValue({ ok: false, error: 'surface lost' });
    const { result } = renderHook(() => useFocusGlassControls(options()));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBe(false));
    expect(mocks.stop).toHaveBeenCalled();
  });
  it('does not revive a native surface after its owner has unmounted', async () => {
    let complete!: (result: unknown) => void;
    mocks.start.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const { unmount } = renderHook(() => useFocusGlassControls(options()));
    unmount();
    await act(async () => { complete({ ok: true, data: true }); });
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.stop).toHaveBeenCalledOnce();
  });
});

describe('native presentation follows the page', () => {
  it('combines the animated rectangle with both page and auto-hide opacity', () => {
    const page = document.createElement('div');
    const controls = document.createElement('div');
    page.style.opacity = '0.5'; controls.style.opacity = '0.4';
    page.append(controls); document.body.append(page);
    vi.spyOn(controls, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 700, width: 420, height: 96,
    } as DOMRect);
    expect(readFocusGlassPresentation(controls)).toEqual({
      x: 100 / innerWidth, y: 700 / innerHeight, width: 420 / innerWidth,
      height: 96 / innerHeight, opacity: 0.2,
    });
    page.style.display = 'none';
    expect(readFocusGlassPresentation(controls).opacity).toBe(0);
    page.remove();
  });
});
