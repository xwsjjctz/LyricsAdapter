import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';
import FocusAmlLyrics, { FocusDomLyricPlayer } from '@/components/focus-mode/FocusAmlLyrics';

const playerMocks = vi.hoisted(() => ({
  resetScroll: vi.fn(),
  calcLayout: vi.fn().mockResolvedValue(undefined),
}));

const coreCleanupMocks = vi.hoisted(() => ({
  resetScroll: vi.fn(),
  disconnect: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('@applemusic-like-lyrics/core', () => ({
  DomLyricPlayer: class MockDomLyricPlayer {
    resizeObserver = { disconnect: coreCleanupMocks.disconnect };

    resetScroll(): void {
      coreCleanupMocks.resetScroll();
    }

    dispose(): void {
      coreCleanupMocks.dispose();
    }
  },
}));

vi.mock('@applemusic-like-lyrics/react', async () => {
  const React = await import('react');

  return {
    LyricPlayer: React.forwardRef(function MockLyricPlayer(
      props: React.HTMLAttributes<HTMLDivElement>,
      ref: React.ForwardedRef<unknown>,
    ) {
      const wrapperRef = React.useRef<HTMLDivElement>(null);
      React.useImperativeHandle(ref, () => ({
        wrapperEl: wrapperRef.current,
        lyricPlayer: playerMocks,
      }));

      return React.createElement('div', {
        ref: wrapperRef,
        className: props.className,
        style: props.style,
        'data-testid': 'lyric-player',
      });
    }),
  };
});

const track: Track = {
  id: 'track-1',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  duration: 10,
  audioUrl: 'blob:test',
  syncedLyrics: [{ time: 1, text: 'Current line' }],
};

describe('FocusAmlLyrics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    playerMocks.resetScroll.mockClear();
    playerMocks.calcLayout.mockClear();
    coreCleanupMocks.resetScroll.mockClear();
    coreCleanupMocks.disconnect.mockClear();
    coreCleanupMocks.dispose.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses configured pixel typography instead of viewport-relative sizing', () => {
    const { getByTestId } = render(
      <FocusAmlLyrics
        track={track}
        currentTime={2}
        isPlaying
        isVisible
        fontSize={34}
        lineSpacing={28}
        inactiveBlur={2}
        onSeek={vi.fn()}
      />,
    );

    const player = getByTestId('lyric-player');
    expect(player.style.getPropertyValue('--amll-lp-font-size')).toBe('34px');
    expect(player.style.getPropertyValue('--focus-amll-line-spacing-adjustment')).toBe('2px');
  });

  it('returns to the current lyric three seconds after the last wheel input', () => {
    const { getByTestId } = render(
      <FocusAmlLyrics
        track={track}
        currentTime={2}
        isPlaying
        isVisible
        fontSize={30}
        lineSpacing={24}
        inactiveBlur={2}
        onSeek={vi.fn()}
      />,
    );

    playerMocks.calcLayout.mockClear();
    const player = getByTestId('lyric-player');
    fireEvent.wheel(player);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    fireEvent.wheel(player);
    act(() => {
      vi.advanceTimersByTime(2_999);
    });

    expect(playerMocks.resetScroll).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(playerMocks.resetScroll).toHaveBeenCalledTimes(1);
    expect(playerMocks.calcLayout).toHaveBeenCalledWith(false, false);
  });

  it('disconnects the observer before disposing the AMLL player', () => {
    const player = new FocusDomLyricPlayer();

    player.dispose();

    expect(coreCleanupMocks.resetScroll).toHaveBeenCalledOnce();
    expect(coreCleanupMocks.disconnect).toHaveBeenCalledOnce();
    expect(coreCleanupMocks.dispose).toHaveBeenCalledOnce();
    expect(coreCleanupMocks.resetScroll.mock.invocationCallOrder[0])
      .toBeLessThan(coreCleanupMocks.disconnect.mock.invocationCallOrder[0]!);
    expect(coreCleanupMocks.disconnect.mock.invocationCallOrder[0])
      .toBeLessThan(coreCleanupMocks.dispose.mock.invocationCallOrder[0]!);
  });
});
