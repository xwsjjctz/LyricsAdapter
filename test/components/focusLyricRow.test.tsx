import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FocusLyricRow, { wordFillProgress } from '@/components/focus-mode/FocusLyricRow';

const lyric = {
  time: 1,
  text: '你好',
  words: [
    { time: 1, duration: 0.5, text: '你' },
    { time: 1.5, duration: 0.5, text: '好' },
  ],
};

describe('FocusLyricRow', () => {
  it('clamps word fill progress to the word timing window', () => {
    expect(wordFillProgress(0.5, lyric.words[0]!)).toBe(0);
    expect(wordFillProgress(1.25, lyric.words[0]!)).toBe(0.5);
    expect(wordFillProgress(2, lyric.words[0]!)).toBe(1);
  });

  it('paints each word from the live playback-time ref without rerendering', () => {
    let nextFrame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const currentTimeRef = { current: 1.25 };

    const { container, unmount } = render(
      <FocusLyricRow
        lyric={lyric}
        isActive
        hasTimestamp
        shouldAnimate
        currentTimeRef={currentTimeRef}
        fontSize={36}
        inactiveBlur={1}
        textPrimary="#fff"
        textSecondary="#ccc"
        textMuted="#777"
        index={0}
        onSeek={vi.fn()}
      />,
    );
    const words = container.querySelectorAll('span');
    expect(words[0]).toHaveStyle({ backgroundSize: '50% 100%, 100% 100%' });
    expect(words[1]).toHaveStyle({ backgroundSize: '0% 100%, 100% 100%' });

    currentTimeRef.current = 1.75;
    act(() => nextFrame?.(16));
    expect(words[0]).toHaveStyle({ backgroundSize: '100% 100%, 100% 100%' });
    expect(words[1]).toHaveStyle({ backgroundSize: '50% 100%, 100% 100%' });

    unmount();
    vi.unstubAllGlobals();
  });

  it('repaints once from the paused snapshot without starting an RAF loop', () => {
    const requestFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    const currentTimeRef = { current: 1.25 };

    const { container, rerender } = render(
      <FocusLyricRow
        lyric={lyric}
        isActive
        hasTimestamp
        shouldAnimate={false}
        currentTimeRef={currentTimeRef}
        pausedTime={1.25}
        fontSize={36}
        inactiveBlur={1}
        textPrimary="#fff"
        textSecondary="#ccc"
        textMuted="#777"
        index={0}
        onSeek={vi.fn()}
      />,
    );

    const words = container.querySelectorAll('span');
    expect(words[0]).toHaveStyle({ backgroundSize: '50% 100%, 100% 100%' });

    rerender(
      <FocusLyricRow
        lyric={lyric}
        isActive
        hasTimestamp
        shouldAnimate={false}
        currentTimeRef={currentTimeRef}
        pausedTime={1.75}
        fontSize={36}
        inactiveBlur={1}
        textPrimary="#fff"
        textSecondary="#ccc"
        textMuted="#777"
        index={0}
        onSeek={vi.fn()}
      />,
    );

    expect(words[0]).toHaveStyle({ backgroundSize: '100% 100%, 100% 100%' });
    expect(words[1]).toHaveStyle({ backgroundSize: '50% 100%, 100% 100%' });
    expect(requestFrame).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
