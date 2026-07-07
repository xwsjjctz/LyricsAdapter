import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { settingsManager } from '../services/settingsManager';

/**
 * Gives ordinary buttons a brief press-and-release bounce without coupling
 * animation state to individual components. Add data-no-gsap-bounce to opt out.
 */
export function useGsapButtonBounce(): void {
  const pressedButtonRef = useRef<HTMLButtonElement | null>(null);
  const enabledRef = useRef(settingsManager.getGsapButtonBounce());

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const release = () => {
      const button = pressedButtonRef.current;
      if (!button) return;

      pressedButtonRef.current = null;
      gsap.killTweensOf(button);
      if (!enabledRef.current) {
        gsap.set(button, { scale: 1 });
        return;
      }
      gsap.to(button, {
        scale: 1,
        duration: 0.42,
        ease: 'elastic.out(1.15, 0.42)',
        overwrite: 'auto',
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || reducedMotion.matches || !enabledRef.current) return;

      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        'button:not([data-no-gsap-bounce])',
      );
      if (!button || button.disabled) return;

      release();
      pressedButtonRef.current = button;
      gsap.killTweensOf(button);
      gsap.to(button, {
        scale: 0.93,
        duration: 0.1,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    };

    const unsubscribe = settingsManager.subscribe(() => {
      enabledRef.current = settingsManager.getGsapButtonBounce();
      if (!enabledRef.current) release();
    });

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);

    return () => {
      unsubscribe();
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
      release();
    };
  }, []);
}
