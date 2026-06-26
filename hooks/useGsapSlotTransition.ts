import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { gsap } from 'gsap';

type SlotId = 'local' | 'cloud';

interface GsapSlotTransition {
  containerRef: RefObject<HTMLDivElement>;
  switchSlot: (nextSlot: SlotId) => Promise<void>;
  completeEnter: (slot: SlotId) => void;
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
  const shouldEnterRef = useRef(false);
  const pendingSlotRef = useRef<SlotId | null>(null);
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

    gsap.killTweensOf(container);
    resolveTransitionRef.current?.();
    resolveTransitionRef.current = resolve;
    gsap.to(container, {
      autoAlpha: 0,
      y: -8,
      duration: 0.14,
      ease: 'power1.in',
      overwrite: true,
      onComplete: () => {
        shouldEnterRef.current = true;
        pendingSlotRef.current = nextSlot;
        setSlot(nextSlot);
      },
    });
  }), [setSlot]);

  const completeEnter = useCallback((readySlot: SlotId) => {
    if (!shouldEnterRef.current || pendingSlotRef.current !== readySlot) return;
    shouldEnterRef.current = false;
    pendingSlotRef.current = null;
    const container = containerRef.current;
    if (!container || prefersReducedMotion()) {
      resolveTransitionRef.current?.();
      resolveTransitionRef.current = null;
      return;
    }

    gsap.set(container, { autoAlpha: 0, y: 10 });
    const animationFrame = requestAnimationFrame(() => {
      gsap.to(container, {
        autoAlpha: 1,
        y: 0,
        duration: 0.26,
        ease: 'power2.out',
        overwrite: true,
        onComplete: () => {
          resolveTransitionRef.current?.();
          resolveTransitionRef.current = null;
        },
      });
    });
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => () => {
    if (containerRef.current) gsap.killTweensOf(containerRef.current);
    resolveTransitionRef.current?.();
  }, []);

  return { containerRef, switchSlot, completeEnter };
};
