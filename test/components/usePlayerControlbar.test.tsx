import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTROLBAR_PASSTHROUGH_ATTR, controlbarPresentation, usePlayerControlbar } from '@/hooks/usePlayerControlbar';
import type { PlayerControlbarAction } from '@/types/playerControlbar';

const mocks = vi.hoisted(() => ({
  platform: 'darwin', start: vi.fn(), update: vi.fn(), updateArtwork: vi.fn(),
  stop: vi.fn(), onAction: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => ({ platform: mocks.platform, ipc: { playerControlbar: mocks } }),
}));

const options = () => ({
  anchorRef: { current: null }, visible: true, artworkUrl: 'cover://track.png',
  state: {
    enabled: true, layout: 'full' as const, isPlaying: false, currentTime: 10, duration: 60, volume: 0.5,
    playbackMode: 'order' as const, title: 'Track', artist: 'Artist',
    labels: { focus: 'Focus', playPause: 'Play', previous: 'Previous', next: 'Next', seek: 'Seek', volume: 'Volume', mute: 'Mute', mode: 'Mode' },
  },
  onFocus: vi.fn(), onSeek: vi.fn(), onTogglePlay: vi.fn(), onSkipNext: vi.fn(),
  onSkipPrev: vi.fn(), onVolumeChange: vi.fn(), onToggleMute: vi.fn(), onTogglePlaybackMode: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks(); mocks.platform = 'darwin';
  mocks.start.mockResolvedValue({ ok: true, data: true }); mocks.update.mockResolvedValue({ ok: true });
  mocks.updateArtwork.mockResolvedValue({ ok: true }); mocks.stop.mockResolvedValue({ ok: true });
  mocks.onAction.mockReturnValue(mocks.unsubscribe);
});

describe('usePlayerControlbar', () => {
  it('keeps the native bar above the FocusMode transition while hiding it behind other overlays', () => {
    const anchor = document.createElement('div');
    anchor.style.opacity = '1';
    document.body.appendChild(anchor);
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      x: 20, y: 80, left: 20, top: 80, right: 420, bottom: 144,
      width: 400, height: 64, toJSON: () => ({}),
    });
    const focusOverlay = document.createElement('div');
    focusOverlay.className = 'focus-mode-overlay';
    const focusChild = document.createElement('div');
    focusOverlay.appendChild(focusChild);
    const regularOverlay = document.createElement('div');
    const elementFromPoint = vi.fn<() => Element | null>().mockReturnValue(focusChild);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: elementFromPoint });

    expect(controlbarPresentation(anchor, true).opacity).toBe(1);
    elementFromPoint.mockReturnValue(regularOverlay);
    expect(controlbarPresentation(anchor, true).opacity).toBe(0);
    anchor.remove();
  });

  it('stays visible over pass-through scrims but hides behind their panels', () => {
    const anchor = document.createElement('div');
    anchor.style.opacity = '1';
    document.body.appendChild(anchor);
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      x: 20, y: 80, left: 20, top: 80, right: 420, bottom: 144,
      width: 400, height: 64, toJSON: () => ({}),
    });
    const scrim = document.createElement('div');
    scrim.setAttribute(CONTROLBAR_PASSTHROUGH_ATTR, '');
    const panel = document.createElement('div');
    scrim.appendChild(panel);
    const elementFromPoint = vi.fn<() => Element | null>().mockReturnValue(scrim);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: elementFromPoint });

    expect(controlbarPresentation(anchor, true).opacity).toBe(1);
    elementFromPoint.mockReturnValue(panel);
    expect(controlbarPresentation(anchor, true).opacity).toBe(0);
    anchor.remove();
  });

  it('routes native actions to the latest player intents and releases the surface', async () => {
    const first = options();
    const { result, rerender, unmount } = renderHook(props => usePlayerControlbar(props), { initialProps: first });
    await waitFor(() => expect(result.current).toBe(true));
    const latest = options(); rerender(latest);
    const emit = mocks.onAction.mock.calls[0]![0] as (action: PlayerControlbarAction) => void;
    act(() => {
      emit({ type: 'focus', value: 0 }); emit({ type: 'toggle-play', value: 0 });
      emit({ type: 'seek', value: 90 }); emit({ type: 'volume', value: -1 });
    });
    expect(first.onFocus).not.toHaveBeenCalled(); expect(latest.onFocus).toHaveBeenCalledOnce();
    expect(latest.onTogglePlay).toHaveBeenCalledOnce(); expect(latest.onSeek).toHaveBeenCalledWith(60);
    expect(latest.onVolumeChange).toHaveBeenCalledWith(0);
    await waitFor(() => expect(mocks.updateArtwork).toHaveBeenCalledWith('cover://track.png?size=128'));
    unmount(); expect(mocks.stop).toHaveBeenCalledOnce(); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps the web control bar outside macOS', () => {
    mocks.platform = 'win32';
    const { result } = renderHook(() => usePlayerControlbar(options()));
    expect(result.current).toBe(false); expect(mocks.start).not.toHaveBeenCalled();
  });

  it('restores web controls after a native update failure', async () => {
    mocks.update.mockResolvedValue({ ok: false, error: 'surface lost' });
    const { result } = renderHook(() => usePlayerControlbar(options()));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBe(false));
    expect(mocks.stop).toHaveBeenCalled();
  });
});
