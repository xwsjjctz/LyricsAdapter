import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RefObject } from 'react';
import LibraryOverlayScrollbar from '@/components/LibraryOverlayScrollbar';

describe('LibraryOverlayScrollbar', () => {
  it('maps the bottom position into the viewport above the control-bar inset', () => {
    const scrollNode = document.createElement('div');
    Object.defineProperties(scrollNode, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, writable: true, value: 500 },
    });
    const scrollRef = { current: scrollNode } as RefObject<HTMLDivElement>;
    const { container } = render(
      <LibraryOverlayScrollbar
        scrollRef={scrollRef}
        contentHeight={1_000}
        bottomInset={96}
      />,
    );

    const overlay = container.querySelector('.library-overlay-scrollbar') as HTMLDivElement;
    const thumb = container.querySelector('.library-overlay-scrollbar__thumb') as HTMLDivElement;
    expect(overlay.style.bottom).toBe('96px');
    expect(thumb.style.height).toBe('202px');
    expect(thumb.style.transform).toBe('translate3d(0, 202px, 0)');

    scrollNode.scrollTop = 250;
    act(() => scrollNode.dispatchEvent(new Event('scroll')));
    expect(overlay).toHaveClass('is-scrolling');
    expect(thumb.style.transform).toBe('translate3d(0, 101px, 0)');
  });
});
