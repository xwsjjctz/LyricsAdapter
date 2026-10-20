import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';
import FocusAmlLyrics, { FocusDomLyricPlayer } from '@/components/focus-mode/FocusAmlLyrics';
import { settingsManager } from '@/services/settingsManager';

const desktopMocks = vi.hoisted(() => ({ platform: 'win32' as string | undefined }));
vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => desktopMocks.platform ? { platform: desktopMocks.platform } : null,
  isDesktop: () => false,
}));

const playerMocks = vi.hoisted(() => ({
  resetScroll: vi.fn(),
  calcLayout: vi.fn().mockResolvedValue(undefined),
}));

const renderedLyricLines = vi.hoisted(() => [] as unknown[]);

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

    update(): void {}

    getCurrentTime(): number {
      return 0;
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
      renderedLyricLines.push((props as { lyricLines?: unknown }).lyricLines);
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
    desktopMocks.platform = 'win32';
    vi.useFakeTimers();
    playerMocks.resetScroll.mockClear();
    playerMocks.calcLayout.mockClear();
    coreCleanupMocks.resetScroll.mockClear();
    coreCleanupMocks.disconnect.mockClear();
    coreCleanupMocks.dispose.mockClear();
    renderedLyricLines.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the AMLL line array when only the translations change', () => {
    const props = {
      track, currentTime: 2, isPlaying: true, isVisible: true,
      fontSize: 30, lineSpacing: 24, inactiveBlur: 2, onSeek: vi.fn(),
    };
    const { rerender } = render(<FocusAmlLyrics {...props} />);
    rerender(<FocusAmlLyrics {...props} translations={{ 'line-0': 'Translated' }} />);

    expect(renderedLyricLines.length).toBeGreaterThan(1);
    expect(renderedLyricLines.at(-1)).toBe(renderedLyricLines[0]);
  });

  it('writes translations into the lines already on screen', () => {
    const makeLine = (translatedLyric = '') => ({
      words: [], translatedLyric, romanLyric: '', startTime: 0, endTime: 1, isBG: false, isDuet: false,
    });
    const processed = makeLine();
    const element = document.createElement('div');
    element.append(document.createElement('div'), document.createElement('div'), document.createElement('div'));
    const player = new FocusDomLyricPlayer();
    Object.assign(player, {
      currentLyricLines: [makeLine()],
      processedLines: [processed],
      currentLyricGroups: [{
        element: document.createElement('div'),
        mainLine: { getElement: () => element, getLine: () => processed },
      }],
    });

    player.updateTranslations([makeLine('Translated')]);
    expect(element.children[1]).toHaveTextContent('Translated');
    expect(processed.translatedLyric).toBe('Translated');

    player.updateTranslations([makeLine()]);
    expect(element.children[1]).toBeEmptyDOMElement();
  });

  describe('lines whose translation changed off screen', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const makeGroup = (height: number) => {
      const element = document.createElement('div');
      const line = document.createElement('div');
      line.append(document.createElement('div'), document.createElement('div'), document.createElement('div'));
      element.append(line);
      Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => height });
      const lyric = {
        words: [], translatedLyric: '', romanLyric: '', startTime: 0, endTime: 1, isBG: false, isDuet: false,
      };
      return {
        element,
        lyric,
        mainLine: { getElement: () => line, getLine: () => lyric },
        isInSight: false,
        show: vi.fn(() => host.append(element)),
        hide: vi.fn(() => element.remove()),
        onLineSizeChange: vi.fn(),
      };
    };
    const makePlayer = (groups: readonly ReturnType<typeof makeGroup>[]) => {
      const player = new FocusDomLyricPlayer();
      Object.assign(player, {
        currentLyricLines: groups.map(group => ({ ...group.lyric })),
        processedLines: groups.map(group => group.lyric),
        currentLyricGroups: groups,
        lyricGroupSize: new WeakMap(groups.map(group => [group, [800, 63]])),
        timelineState: { scrollToIndex: 1 },
        layoutState: { alignPosition: 0.35 },
        size: [800, 600],
        getOverscanPx: () => 300,
      });
      return player;
    };
    const translate = (player: FocusDomLyricPlayer, count: number) => player.updateTranslations(
      Array.from({ length: count }, () => ({
        words: [], translatedLyric: 'Translated', romanLyric: '', startTime: 0, endTime: 1, isBG: false, isDuet: false,
      })),
    );

    afterEach(() => {
      host.replaceChildren();
    });

    it('measures their real height before returning to the current line', () => {
      const [above, current, below] = [makeGroup(82), makeGroup(82), makeGroup(82)];
      const player = makePlayer([above, current, below]);
      host.append(below.element);
      translate(player, 3);

      player.measureStaleGroupsOnReturn();

      expect(current.show).toHaveBeenCalledTimes(1);
      expect(player.lyricGroupSize.get(current as never)).toEqual([0, 82]);
      expect(current.onLineSizeChange).toHaveBeenCalledWith([0, 82]);
      expect(current.hide).toHaveBeenCalledTimes(1);
      expect(above.show).toHaveBeenCalledTimes(1);
      // AMLL observes the connected line itself.
      expect(below.show).not.toHaveBeenCalled();
      expect(player.lyricGroupSize.get(below as never)).toEqual([800, 63]);
    });

    it('keeps their content rendered until a frame has shown them', () => {
      const group = makeGroup(82);
      const player = makePlayer([group]);
      translate(player, 1);
      expect(group.element).toHaveAttribute('data-focus-amll-remeasure');

      player.update(16);
      expect(group.element).toHaveAttribute('data-focus-amll-remeasure');

      host.append(group.element);
      player.update(16);
      expect(group.element).toHaveAttribute('data-focus-amll-remeasure');
      player.update(16);
      expect(group.element).not.toHaveAttribute('data-focus-amll-remeasure');
    });
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

  it('switches Windows typography live without replacing the lyric player', async () => {
    await settingsManager.setFocusEnhancedFontEnabled(false);
    const { getByTestId } = render(
      <FocusAmlLyrics track={track} currentTime={2} isPlaying isVisible fontSize={32} lineSpacing={30} inactiveBlur={2} onSeek={vi.fn()} />,
    );
    const player = getByTestId('lyric-player');
    expect(player).not.toHaveClass('focus-amll-lyrics--enhanced-font');
    playerMocks.calcLayout.mockClear();
    await act(async () => { await settingsManager.setFocusEnhancedFontEnabled(true); });
    expect(player).toHaveClass('focus-amll-lyrics--enhanced-font');
    expect(playerMocks.calcLayout).toHaveBeenCalledWith(true, true);
    expect(getByTestId('lyric-player')).toBe(player);
    await act(async () => { await settingsManager.setFocusEnhancedFontEnabled(false); });
    expect(player).not.toHaveClass('focus-amll-lyrics--enhanced-font');
    expect(player.style.getPropertyValue('--amll-lp-font-size')).toBe('32px');
  });

  it.each(['darwin', 'linux', undefined])('keeps %s typography independent of the Windows preference', async platform => {
    desktopMocks.platform = platform;
    await settingsManager.setFocusEnhancedFontEnabled(false);
    const { getByTestId } = render(
      <FocusAmlLyrics track={track} currentTime={2} isPlaying isVisible fontSize={32} lineSpacing={30} inactiveBlur={2} onSeek={vi.fn()} />,
    );
    const player = getByTestId('lyric-player');
    expect(player.classList.contains('focus-amll-lyrics--enhanced-font')).toBe(platform === 'darwin');
    await act(async () => { await settingsManager.setFocusEnhancedFontEnabled(true); });
    expect(player.classList.contains('focus-amll-lyrics--enhanced-font')).toBe(platform === 'darwin');
  });
});
