import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { gsap } from 'gsap';

interface GsapPageTransition<T> {
  containerRef: RefObject<HTMLDivElement>;
  navigate: (nextView: T) => void;
}

/**
 * Keeps view changes out of React's render path: only the page container is
 * animated, while the player and title bar remain responsive.
 */
export const useGsapPageTransition = <T,>(
  view: T,
  setView: Dispatch<SetStateAction<T>>,
): GsapPageTransition<T> => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingEnterRef = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const navigate = useCallback((nextView: T) => {
    if (Object.is(nextView, viewRef.current)) return;
    const container = containerRef.current;
    if (!container || reducedMotion()) {
      setView(nextView);
      return;
    }

    gsap.killTweensOf(container);
    gsap.to(container, {
      autoAlpha: 0,
      y: -8,
      duration: 0.14,
      ease: 'power1.in',
      overwrite: true,
      onComplete: () => {
        pendingEnterRef.current = true;
        setView(nextView);
      },
    });
  }, [setView]);

  useEffect(() => {
    if (!pendingEnterRef.current) return;
    pendingEnterRef.current = false;
    const container = containerRef.current;
    if (!container || reducedMotion()) return;

    gsap.set(container, { autoAlpha: 0, y: 10 });
    const animationFrame = requestAnimationFrame(() => {
      gsap.to(container, {
        autoAlpha: 1,
        y: 0,
        duration: 0.26,
        ease: 'power2.out',
        overwrite: true,
      });
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [view]);

  useEffect(() => () => {
    if (containerRef.current) gsap.killTweensOf(containerRef.current);
  }, []);

  return { containerRef, navigate };
};
