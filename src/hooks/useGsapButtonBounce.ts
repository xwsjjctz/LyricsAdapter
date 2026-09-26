import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { settingsManager } from '../services/settingsManager';

// CSS transitions on `transform` would re-interpolate every GSAP frame, so
// while a bounce runs only non-transform properties keep transitioning.
const BOUNCE_TRANSITION_PROPERTY = 'color, background-color, border-color, box-shadow, opacity';

/**
 * Gives ordinary buttons a brief press-and-release bounce without coupling
 * animation state to individual components. Add data-no-gsap-bounce to opt out.
 * The inline transform is cleared once the bounce settles so CSS hover/active
 * transforms (e.g. `hover:scale-105`, `.ui-btn--primary:active`) keep working.
 */
export function useGsapButtonBounce(): void {
  const pressedButtonRef = useRef<HTMLButtonElement | null>(null);
  const enabledRef = useRef(settingsManager.getGsapButtonBounce());

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    // Original inline transition-property of each button a bounce owns.
    const suspendedTransitions = new Map<HTMLButtonElement, string>();

    const suspendTransition = (button: HTMLButtonElement) => {
      if (suspendedTransitions.has(button)) return;
      suspendedTransitions.set(button, button.style.transitionProperty);
      button.style.transitionProperty = BOUNCE_TRANSITION_PROPERTY;
    };

    const settle = (button: HTMLButtonElement) => {
      gsap.set(button, { clearProps: 'transform' });
      const original = suspendedTransitions.get(button);
      if (original === undefined) return;
      suspendedTransitions.delete(button);
      button.style.transitionProperty = original;
    };

    const release = () => {
      const button = pressedButtonRef.current;
      if (!button) return;

      pressedButtonRef.current = null;
      gsap.killTweensOf(button);
      if (!enabledRef.current) {
        settle(button);
        return;
      }
      gsap.to(button, {
        scale: 1,
        duration: 0.42,
        ease: 'elastic.out(1.15, 0.42)',
        overwrite: 'auto',
        onComplete: () => settle(button),
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
      suspendTransition(button);
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
      suspendedTransitions.forEach((_, button) => {
        gsap.killTweensOf(button);
        settle(button);
      });
    };
  }, []);
}
