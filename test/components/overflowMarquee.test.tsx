import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OverflowMarquee from '@/components/OverflowMarquee';

describe('OverflowMarquee', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses resize fallback measurement and pauses for two seconds at each seamless loop', () => {
    vi.useFakeTimers();
    const { container } = render(<OverflowMarquee text="A deliberately long track title" />);
    const viewport = container.querySelector('.overflow-marquee') as HTMLDivElement;
    const source = container.querySelector('.overflow-marquee__copy') as HTMLSpanElement;

    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(source, 'scrollWidth', { configurable: true, value: 180 });
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue({
      bottom: 20,
      height: 20,
      left: 0,
      right: 180,
      top: 0,
      width: 180,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    act(() => window.dispatchEvent(new Event('resize')));

    const track = container.querySelector('.overflow-marquee__track--scrolling') as HTMLDivElement;
    expect(track).toBeInTheDocument();
    expect(track.querySelectorAll('.overflow-marquee__copy')).toHaveLength(2);
    expect(track.style.getPropertyValue('--overflow-marquee-distance')).toBe('212px');

    const iterationEvent = new Event('animationiteration', { bubbles: true });
    Object.defineProperty(iterationEvent, 'animationName', { value: 'overflow-marquee-loop' });
    fireEvent(track, iterationEvent);
    expect(track.style.animationPlayState).toBe('paused');

    act(() => vi.advanceTimersByTime(1_999));
    expect(track.style.animationPlayState).toBe('paused');
    act(() => vi.advanceTimersByTime(1));
    expect(track.style.animationPlayState).toBe('');
  });
});
