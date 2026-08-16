import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

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

/** A non-interactive overlay indicator that never consumes track-grid width. */
export default function LibraryOverlayScrollbar({
  scrollRef,
  contentHeight,
  bottomInset = 0,
}: LibraryOverlayScrollbarProps) {
  const [metrics, setMetrics] = useState<ScrollMetrics>(EMPTY_METRICS);
  const [isScrolling, setIsScrolling] = useState(false);
  const idleTimerRef = useRef<number | null>(null);

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

  return (
    <div
      aria-hidden="true"
      className={`library-overlay-scrollbar${isScrolling ? ' is-scrolling' : ''}`}
      style={{ bottom: bottomInset }}
    >
      <div
        className="library-overlay-scrollbar__thumb"
        style={{ height: thumbHeight, transform: `translate3d(0, ${thumbTop}px, 0)` }}
      />
    </div>
  );
}
