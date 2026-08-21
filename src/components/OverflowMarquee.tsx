import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type AnimationEvent,
  type CSSProperties,
} from 'react';
import './OverflowMarquee.css';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const COPY_GAP_PX = 32;
const LOOP_PAUSE_MS = 2_000;
const PIXELS_PER_SECOND = 28;
const MIN_TRAVEL_SECONDS = 5;

interface MarqueeMetrics {
  distance: number;
  isOverflowing: boolean;
}

interface OverflowMarqueeProps {
  text: string;
}

type MarqueeStyle = CSSProperties & {
  '--overflow-marquee-distance': string;
  '--overflow-marquee-duration': string;
  '--overflow-marquee-gap': string;
};

const getReducedMotionMediaQuery = (): MediaQueryList | null => (
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null
);

const subscribeToReducedMotion = (onChange: () => void): (() => void) => {
  const mediaQuery = getReducedMotionMediaQuery();
  if (!mediaQuery) return () => {};

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }

  mediaQuery.addListener(onChange);
  return () => mediaQuery.removeListener(onChange);
};

const getReducedMotionSnapshot = (): boolean => getReducedMotionMediaQuery()?.matches ?? false;

const getReducedMotionServerSnapshot = (): boolean => false;

/**
 * Scrolls only when the rendered text is wider than its viewport. A duplicate
 * copy makes the wrap point seamless; after each traversal the animation rests
 * at that visually identical wrap point for two seconds.
 */
const OverflowMarquee = memo(({ text }: OverflowMarqueeProps) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLSpanElement>(null);
  const pauseTimerRef = useRef<number | null>(null);
  const prefersReducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const [metrics, setMetrics] = useState<MarqueeMetrics>({
    distance: 0,
    isOverflowing: false,
  });
  const shouldScroll = metrics.isOverflowing && !prefersReducedMotion;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const source = sourceRef.current;
    if (!viewport || !source) return;

    const measure = () => {
      // scrollWidth is integer-rounded. Once the track is in its flex layout,
      // the bounding box preserves sub-pixel width and keeps the wrap point exact.
      const contentWidth = Math.max(source.scrollWidth, source.getBoundingClientRect().width);
      const isOverflowing = contentWidth > viewport.clientWidth + 1;
      const distance = isOverflowing ? contentWidth + COPY_GAP_PX : 0;

      setMetrics(previous => (
        previous.isOverflowing === isOverflowing && previous.distance === distance
          ? previous
          : { distance, isOverflowing }
      ));
    };

    measure();

    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(measure)
      : null;
    if (observer) {
      observer.observe(viewport);
      observer.observe(source);
    } else {
      window.addEventListener('resize', measure);
    }

    const fontSet = document.fonts;
    fontSet?.addEventListener?.('loadingdone', measure);

    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', measure);
      fontSet?.removeEventListener?.('loadingdone', measure);
    };
  }, [shouldScroll, text]);
  const travelSeconds = Math.max(
    MIN_TRAVEL_SECONDS,
    metrics.distance / PIXELS_PER_SECOND,
  );

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track) track.style.animationPlayState = '';

    return () => {
      if (pauseTimerRef.current !== null) {
        window.clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = null;
      }
      if (track) track.style.animationPlayState = '';
    };
  }, [shouldScroll, metrics.distance, text]);

  const handleAnimationIteration = useCallback((event: AnimationEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (
      !track
      || !shouldScroll
      || event.target !== event.currentTarget
      || event.animationName !== 'overflow-marquee-loop'
    ) return;

    track.style.animationPlayState = 'paused';
    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current);
    }
    pauseTimerRef.current = window.setTimeout(() => {
      pauseTimerRef.current = null;
      if (trackRef.current === track) {
        track.style.animationPlayState = '';
      }
    }, LOOP_PAUSE_MS);
  }, [shouldScroll]);

  const animationStyle: MarqueeStyle | undefined = shouldScroll
    ? {
        '--overflow-marquee-distance': `${metrics.distance}px`,
        '--overflow-marquee-duration': `${travelSeconds}s`,
        '--overflow-marquee-gap': `${COPY_GAP_PX}px`,
      }
    : undefined;

  return (
    <div ref={viewportRef} className="overflow-marquee" title={text}>
      <div
        ref={trackRef}
        className={shouldScroll
          ? 'overflow-marquee__track--scrolling'
          : 'overflow-marquee__track--static'
        }
        style={animationStyle}
        onAnimationIteration={handleAnimationIteration}
      >
        <span ref={sourceRef} className="overflow-marquee__copy">{text}</span>
        {shouldScroll ? (
          <span aria-hidden="true" className="overflow-marquee__copy">{text}</span>
        ) : null}
      </div>
    </div>
  );
});

OverflowMarquee.displayName = 'OverflowMarquee';

export default OverflowMarquee;
