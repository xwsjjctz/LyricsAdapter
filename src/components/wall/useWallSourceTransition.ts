import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { gsap } from 'gsap';
import type { Track } from '../../types';

const TILE_INNER_SELECTOR = '[data-wall-tile-inner]';

interface WallSourceTransition {
  /** Source whose tiles are currently on screen (lags `sourceKey` while exiting). */
  renderKey: string;
  /** Tracks to render: the outgoing snapshot while exiting, otherwise the live list. */
  renderedTracks: Track[];
  isExiting: boolean;
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const tileInners = (container: HTMLElement | null): HTMLElement[] =>
  container ? Array.from(container.querySelectorAll<HTMLElement>(TILE_INNER_SELECTOR)) : [];

/** DOM order is track order; the entrance should read top-left to bottom-right instead. */
const inReadingOrder = (inners: HTMLElement[]): HTMLElement[] => inners
  .map(inner => ({ inner, rect: inner.getBoundingClientRect() }))
  .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
  .map(entry => entry.inner);

/**
 * Source switch choreography for the poster wall: the visible posters sink and
 * fade out of step, then the target source's posters pop in one after another.
 * Only mounted (on-screen) tiles animate, so cost is bounded by the viewport.
 */
export function useWallSourceTransition(
  sourceKey: string,
  tracks: Track[],
  containerRef: RefObject<HTMLElement>,
): WallSourceTransition {
  const [renderKey, setRenderKey] = useState(sourceKey);
  const [isExiting, setIsExiting] = useState(false);
  // Bumped on every swap so returning to the same source still re-renders and replays the entrance.
  const [, setEnterToken] = useState(0);
  const snapshotRef = useRef(tracks);
  const latestKeyRef = useRef(sourceKey);
  const pendingEnterRef = useRef(true);
  latestKeyRef.current = sourceKey;

  const renderedTracks = renderKey === sourceKey ? tracks : snapshotRef.current;

  useLayoutEffect(() => {
    if (renderKey === sourceKey) snapshotRef.current = tracks;
  });

  useEffect(() => {
    if (sourceKey === renderKey || isExiting) return;
    const finish = () => {
      pendingEnterRef.current = true;
      setIsExiting(false);
      setRenderKey(latestKeyRef.current);
      setEnterToken(token => token + 1);
    };
    const inners = tileInners(containerRef.current);
    if (inners.length === 0 || prefersReducedMotion()) {
      finish();
      return;
    }
    setIsExiting(true);
    gsap.killTweensOf(inners);
    gsap.to(inners, {
      y: 40,
      scale: 0.86,
      opacity: 0,
      duration: 0.3,
      ease: 'power2.in',
      stagger: { amount: 0.3, from: 'random' },
      onComplete: finish,
    });
  }, [containerRef, isExiting, renderKey, sourceKey]);

  // Entrance waits until the new source has mounted tiles: a playlist may still
  // be loading, and the wall only mounts tiles once its width is measured. The
  // guard is a ref check, so running after every commit is cheap.
  useLayoutEffect(() => {
    if (!pendingEnterRef.current || isExiting) return;
    const inners = tileInners(containerRef.current);
    if (inners.length === 0) return;
    pendingEnterRef.current = false;
    gsap.killTweensOf(inners);
    if (prefersReducedMotion()) {
      gsap.set(inners, { clearProps: 'transform,opacity' });
      return;
    }
    gsap.fromTo(inReadingOrder(inners), { y: 48, scale: 0.82, opacity: 0 }, {
      y: 0,
      scale: 1,
      opacity: 1,
      duration: 0.55,
      ease: 'back.out(1.5)',
      stagger: { amount: 0.45, from: 'start' },
      clearProps: 'transform,opacity',
    });
  });

  useEffect(() => () => {
    gsap.killTweensOf(tileInners(containerRef.current));
  }, [containerRef]);

  return { renderKey, renderedTracks, isExiting };
}
