import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { gsap } from 'gsap';

type SlotId = 'local' | 'cloud';

interface GsapSlotTransition {
  containerRef: RefObject<HTMLDivElement>;
  switchSlot: (nextSlot: SlotId) => Promise<void>;
}

/**
 * Animates only the library content wrapper, leaving virtualized rows and the
 * toolbar untouched. The returned promise settles after the new list enters.
 */
export const useGsapSlotTransition = (
  slot: SlotId,
  setSlot: Dispatch<SetStateAction<SlotId>>,
): GsapSlotTransition => {
  const containerRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef(slot);
  const enterDirectionRef = useRef<number | null>(null);
  const resolveTransitionRef = useRef<(() => void) | null>(null);
  slotRef.current = slot;

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const switchSlot = useCallback((nextSlot: SlotId) => new Promise<void>((resolve) => {
    if (nextSlot === slotRef.current) {
      resolve();
      return;
    }

    const container = containerRef.current;
    if (!container || prefersReducedMotion()) {
      setSlot(nextSlot);
      resolve();
      return;
    }

    // Cloud is visually to the right of Local in the sidebar.
    const exitX = nextSlot === 'cloud' ? -16 : 16;
    gsap.killTweensOf(container);
    resolveTransitionRef.current?.();
    resolveTransitionRef.current = resolve;
    gsap.to(container, {
      autoAlpha: 0,
      x: exitX,
      duration: 0.12,
      ease: 'power1.in',
      overwrite: true,
      onComplete: () => {
        enterDirectionRef.current = exitX;
        setSlot(nextSlot);
      },
    });
  }), [setSlot]);

  useEffect(() => {
    const exitX = enterDirectionRef.current;
    if (exitX === null) return;
    enterDirectionRef.current = null;
    const container = containerRef.current;
    if (!container || prefersReducedMotion()) {
      resolveTransitionRef.current?.();
      resolveTransitionRef.current = null;
      return;
    }

    gsap.set(container, { autoAlpha: 0, x: -exitX });
    const animationFrame = requestAnimationFrame(() => {
      gsap.to(container, {
        autoAlpha: 1,
        x: 0,
        duration: 0.2,
        ease: 'power2.out',
        overwrite: true,
        onComplete: () => {
          resolveTransitionRef.current?.();
          resolveTransitionRef.current = null;
        },
      });
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [slot]);

  useEffect(() => () => {
    if (containerRef.current) gsap.killTweensOf(containerRef.current);
    resolveTransitionRef.current?.();
  }, []);

  return { containerRef, switchSlot };
};
