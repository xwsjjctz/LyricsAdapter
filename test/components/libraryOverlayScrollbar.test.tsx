import { act, fireEvent, render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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

  // jsdom has neither PointerEvent nor pointer capture: give the events their
  // mouse fields and let capture calls succeed.
  beforeAll(() => {
    if (!('PointerEvent' in window)) {
      class TestPointerEvent extends MouseEvent {
        readonly pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
      }
      Object.assign(window, { PointerEvent: TestPointerEvent });
    }
    Object.assign(Element.prototype, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true) });
  });
  const setup = (scrollTop = 0) => {
    const scrollNode = document.createElement('div');
    Object.defineProperties(scrollNode, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, writable: true, value: scrollTop },
    });
    const scrollRef = { current: scrollNode } as RefObject<HTMLDivElement>;
    const { container } = render(<LibraryOverlayScrollbar scrollRef={scrollRef} contentHeight={1_000} />);
    // Thumb: 250px tall over a 500px track, so each pixel moves the list 2px.
    return { scrollNode, track: container.querySelector('.library-overlay-scrollbar') as HTMLDivElement };
  };

  it('scrolls the list by dragging its thumb', () => {
    const { scrollNode, track } = setup();
    fireEvent.pointerDown(track, { button: 0, clientY: 100, pointerId: 1 });
    expect(track).toHaveClass('is-dragging');
    fireEvent.pointerMove(track, { clientY: 150, pointerId: 1 });
    expect(scrollNode.scrollTop).toBe(100);
    fireEvent.pointerUp(track, { clientY: 150, pointerId: 1 });
    expect(track).not.toHaveClass('is-dragging');
    fireEvent.pointerMove(track, { clientY: 300, pointerId: 1 });
    expect(scrollNode.scrollTop).toBe(100);
  });

  it('jumps to a pressed spot on the track and keeps dragging from there', () => {
    const { scrollNode, track } = setup();
    fireEvent.pointerDown(track, { button: 0, clientY: 400, pointerId: 1 });
    // The thumb's middle lands under the pointer: (400 - 125) * 2.
    expect(scrollNode.scrollTop).toBe(550);
    fireEvent.pointerMove(track, { clientY: 410, pointerId: 1 });
    expect(scrollNode.scrollTop).toBe(570);
  });

  it('ignores the secondary button', () => {
    const { scrollNode, track } = setup();
    fireEvent.pointerDown(track, { button: 2, clientY: 400, pointerId: 1 });
    expect(scrollNode.scrollTop).toBe(0);
    expect(track).not.toHaveClass('is-dragging');
  });
});
