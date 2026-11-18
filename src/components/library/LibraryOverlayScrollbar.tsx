import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

const MIN_THUMB_HEIGHT = 28;
const SCROLL_IDLE_DELAY_MS = 700;

interface ScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

interface LibraryOverlayScrollbarProps {
  scrollRef: RefObject<HTMLDivElement>;
  contentHeight: number;
  bottomInset?: number;
}

const EMPTY_METRICS: ScrollMetrics = { clientHeight: 0, scrollHeight: 0, scrollTop: 0 };

/**
 * The list's scrollbar, in a gutter beside the rows: drag the thumb, or press
 * the track to jump there and keep dragging. Wheel and keyboard scrolling stay
 * on the list itself, so this is hidden from assistive technology.
 */
export default function LibraryOverlayScrollbar({
  scrollRef,
  contentHeight,
  bottomInset = 0,
}: LibraryOverlayScrollbarProps) {
  const [metrics, setMetrics] = useState<ScrollMetrics>(EMPTY_METRICS);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const idleTimerRef = useRef<number | null>(null);
  /** Pointer position and scroll offset where the drag began. */
  const dragRef = useRef<{ startY: number; startScrollTop: number } | null>(null);

  const measure = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const next = {
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      scrollTop: node.scrollTop,
    };
    setMetrics(previous => (
      previous.clientHeight === next.clientHeight
      && previous.scrollHeight === next.scrollHeight
      && previous.scrollTop === next.scrollTop
        ? previous
        : next
    ));
  }, [scrollRef]);

  // Track-count, row measurement and bottom padding all flow into contentHeight.
  // Re-measure only when that geometry changes; scroll events update the thumb
  // separately, avoiding a duplicate synchronous read after every parent render.
  useLayoutEffect(measure, [bottomInset, contentHeight, measure]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const revealDuringScroll = () => {
      measure();
      setIsScrolling(true);
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = null;
        setIsScrolling(false);
      }, SCROLL_IDLE_DELAY_MS);
    };

    node.addEventListener('scroll', revealDuringScroll, { passive: true });
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(measure)
      : null;
    if (observer) observer.observe(node);
    else window.addEventListener('resize', measure);

    measure();
    return () => {
      node.removeEventListener('scroll', revealDuringScroll);
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', measure);
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [measure, scrollRef]);

  const { clientHeight, scrollHeight, scrollTop } = metrics;
  const trackHeight = Math.max(0, clientHeight - bottomInset);
  if (trackHeight <= 0 || scrollHeight <= clientHeight + 1) return null;

  const thumbHeight = Math.min(
    trackHeight,
    Math.max(MIN_THUMB_HEIGHT, trackHeight * (clientHeight / scrollHeight)),
  );
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const maxScrollTop = Math.max(1, scrollHeight - clientHeight);
  const thumbTop = Math.min(maxThumbTop, Math.max(0, (scrollTop / maxScrollTop) * maxThumbTop));
  // Scroll distance per pixel of thumb travel.
  const scrollPerPixel = maxThumbTop > 0 ? maxScrollTop / maxThumbTop : 0;

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const node = scrollRef.current;
    if (!node || event.button !== 0) return;
    event.preventDefault();
    const trackTop = event.currentTarget.getBoundingClientRect().top;
    const pointer = event.clientY - trackTop;
    if (pointer < thumbTop || pointer > thumbTop + thumbHeight) {
      // On the track: bring the thumb's middle under the pointer first.
      node.scrollTop = Math.max(0, pointer - thumbHeight / 2) * scrollPerPixel;
    }
    dragRef.current = { startY: event.clientY, startScrollTop: node.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const node = scrollRef.current, start = dragRef.current;
    if (!node || !start) return;
    node.scrollTop = start.startScrollTop + (event.clientY - start.startY) * scrollPerPixel;
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setIsDragging(false);
  };

  return (
    <div
      aria-hidden="true"
      className={`library-overlay-scrollbar${isScrolling ? ' is-scrolling' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={{ bottom: bottomInset }}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="library-overlay-scrollbar__thumb"
        style={{ height: thumbHeight, transform: `translate3d(0, ${thumbTop}px, 0)` }}
      />
    </div>
  );
}
