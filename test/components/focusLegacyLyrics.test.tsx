import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FocusLegacyLyrics from '@/components/focus-mode/FocusLegacyLyrics';
import type { Track } from '@/types';

const track: Track = {
  id: 'legacy-track',
  title: 'Legacy Renderer',
  artist: 'LyricsAdapter',
  album: 'Tests',
  duration: 10,
  audioUrl: 'blob:test',
  syncedLyrics: [
    { time: 0, text: 'Opening line' },
    { time: 4, text: 'Seekable line' },
  ],
};

describe('FocusLegacyLyrics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the pre-AMLL seek and manual-wheel behavior', () => {
    const onSeek = vi.fn();
    render(
      <FocusLegacyLyrics
        track={track}
        currentTime={5}
        currentTimeRef={{ current: 5 }}
        isPlaying={false}
        isVisible
        fontSize={30}
        lineSpacing={24}
        inactiveBlur={2}
        scale={1}
        textPrimary="#fff"
        textSecondary="#ccc"
        textMuted="#777"
        onSeek={onSeek}
      />,
    );

    fireEvent.click(screen.getByText('Opening line'));
    expect(onSeek).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Seekable line'));
    expect(onSeek).toHaveBeenCalledWith(4);

    const wheelEvent = new WheelEvent('wheel', { cancelable: true, deltaY: 20 });
    fireEvent(screen.getByTestId('focus-legacy-lyrics'), wheelEvent);
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  it('cancels pending scroll work when the renderer unmounts', () => {
    const { unmount } = render(
      <FocusLegacyLyrics
        track={track}
        currentTime={5}
        currentTimeRef={{ current: 5 }}
        isPlaying={false}
        isVisible
        fontSize={30}
        lineSpacing={24}
        inactiveBlur={2}
        scale={1}
        textPrimary="#fff"
        textSecondary="#ccc"
        textMuted="#777"
        onSeek={vi.fn()}
      />,
    );

    fireEvent.wheel(screen.getByTestId('focus-legacy-lyrics'), { deltaY: 20 });
    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops an in-flight line transition as soon as Focus becomes hidden', () => {
    const props = {
      track,
      currentTimeRef: { current: 5 },
      isPlaying: false,
      fontSize: 30,
      lineSpacing: 24,
      inactiveBlur: 2,
      scale: 1,
      textPrimary: '#fff',
      textSecondary: '#ccc',
      textMuted: '#777',
      onSeek: vi.fn(),
    };
    const { rerender } = render(
      <FocusLegacyLyrics {...props} currentTime={5} isVisible />,
    );

    vi.mocked(requestAnimationFrame).mockClear();
    vi.mocked(cancelAnimationFrame).mockClear();
    rerender(<FocusLegacyLyrics {...props} currentTime={1} isVisible />);
    expect(requestAnimationFrame).toHaveBeenCalled();

    vi.mocked(cancelAnimationFrame).mockClear();
    rerender(<FocusLegacyLyrics {...props} currentTime={1} isVisible={false} />);
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
  });
});
