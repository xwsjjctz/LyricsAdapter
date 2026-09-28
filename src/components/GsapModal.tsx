import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { lastInputWasKeyboard } from '../services/inputModality';

interface GsapModalProps {
  isOpen: boolean;
  children: React.ReactNode;
  onExited?: () => void;
  overlayClassName?: string;
  panelClassName?: string;
  overlayStyle?: React.CSSProperties;
  panelStyle?: React.CSSProperties;
  /** Escape and backdrop clicks request dismissal through this callback. */
  onDismiss?: () => void;
  /** Accessible name; defaults to the first heading inside the panel. */
  ariaLabel?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusableIn = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));

/**
 * A presence-aware modal dialog with one shared GSAP entry and exit motion.
 * Moves focus into the panel on open, keeps Tab inside it, closes on Escape,
 * and returns focus to the previously focused element once it has exited.
 */
const GsapModal: React.FC<GsapModalProps> = ({
  isOpen,
  children,
  onExited,
  overlayClassName = '',
  panelClassName = '',
  overlayStyle,
  panelStyle,
  onDismiss,
  ariaLabel,
}) => {
  const headingId = useId();
  const [isMounted, setIsMounted] = useState(isOpen);
  const latestChildrenRef = useRef(children);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const returnFocusRef = useRef<HTMLElement | null>(null);
  if (isOpen) latestChildrenRef.current = children;

  useEffect(() => {
    if (!isOpen) return;
    if (document.activeElement instanceof HTMLElement) returnFocusRef.current = document.activeElement;
    setIsMounted(true);
  }, [isOpen]);

  useEffect(() => {
    if (!isMounted) return;
    const overlay = overlayRef.current;
    const panel = panelRef.current;
    if (!overlay || !panel) return;
    const shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    gsap.killTweensOf([overlay, panel]);
    // Fade with opacity, not autoAlpha: `visibility: hidden` would drop the
    // focus that was just moved into the panel.
    if (isOpen) {
      if (shouldReduceMotion) {
        gsap.set([overlay, panel], { opacity: 1, clearProps: 'transform' });
        return;
      }
      const context = gsap.context(() => {
        gsap.timeline()
          .fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.16, ease: 'power1.out' })
          .fromTo(panel, { opacity: 0, y: 12, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.24, ease: 'back.out(1.2)' }, '<');
      }, overlay);
      return () => context.revert();
    }

    const finishExit = () => {
      setIsMounted(false);
      const returnTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnTarget?.isConnected) returnTarget.focus();
      onExitedRef.current?.();
    };
    if (shouldReduceMotion) {
      finishExit();
      return;
    }
    gsap.timeline({ onComplete: finishExit })
      .to(panel, { opacity: 0, y: 8, scale: 0.98, duration: 0.14, ease: 'power1.in' })
      .to(overlay, { opacity: 0, duration: 0.12, ease: 'power1.in' }, '<0.03');
  }, [isOpen, isMounted]);

  // Declared after the motion effect so focus moves once GSAP has applied the
  // panel's initial state.
  useEffect(() => {
    if (!isOpen || !isMounted) return;
    const panel = panelRef.current;
    if (!panel) return;
    if (!ariaLabel) {
      const heading = panel.querySelector<HTMLElement>('h1, h2, h3, h4');
      if (heading && !heading.id) heading.id = headingId;
      if (heading) panel.setAttribute('aria-labelledby', heading.id);
    }
    // Keyboard users start on the first control; pointer users on the panel, so
    // no button shows a focus ring they did not ask for. Tab still cycles inside.
    if (!panel.contains(document.activeElement)) {
      (lastInputWasKeyboard() ? focusableIn(panel)[0] ?? panel : panel).focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onDismissRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableIn(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capture phase so global shortcuts never see keys meant for the dialog.
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [ariaLabel, headingId, isMounted, isOpen]);

  if (!isMounted) return null;

  const modal = (
    <div
      ref={overlayRef}
      data-controlbar-passthrough
      className={`fixed inset-0 flex items-center justify-center ${overlayClassName}`}
      style={overlayStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`outline-none ${panelClassName}`}
        style={panelStyle}
      >
        {isOpen ? children : latestChildrenRef.current}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

export default GsapModal;
