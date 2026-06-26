import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

interface GsapModalProps {
  isOpen: boolean;
  children: React.ReactNode;
  onExited?: () => void;
  overlayClassName?: string;
  panelClassName?: string;
  overlayStyle?: React.CSSProperties;
  panelStyle?: React.CSSProperties;
  onBackdropClick?: () => void;
}

/** A presence-aware modal shell with one shared GSAP entry and exit motion. */
const GsapModal: React.FC<GsapModalProps> = ({
  isOpen,
  children,
  onExited,
  overlayClassName = '',
  panelClassName = '',
  overlayStyle,
  panelStyle,
  onBackdropClick,
}) => {
  const [isMounted, setIsMounted] = useState(isOpen);
  const [renderedChildren, setRenderedChildren] = useState(children);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  useEffect(() => {
    if (!isOpen) return;
    setRenderedChildren(children);
    setIsMounted(true);
  }, [children, isOpen]);

  useEffect(() => {
    if (!isMounted) return;
    const overlay = overlayRef.current;
    const panel = panelRef.current;
    if (!overlay || !panel) return;
    const shouldReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    gsap.killTweensOf([overlay, panel]);
    if (isOpen) {
      if (shouldReduceMotion) {
        gsap.set([overlay, panel], { autoAlpha: 1, clearProps: 'transform' });
        return;
      }
      const context = gsap.context(() => {
        gsap.timeline()
          .fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.16, ease: 'power1.out' })
          .fromTo(panel, { autoAlpha: 0, y: 12, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.24, ease: 'back.out(1.2)' }, '<');
      }, overlay);
      return () => context.revert();
    }

    if (shouldReduceMotion) {
      setIsMounted(false);
      onExitedRef.current?.();
      return;
    }
    gsap.timeline({
      onComplete: () => {
        setIsMounted(false);
        onExitedRef.current?.();
      },
    })
      .to(panel, { autoAlpha: 0, y: 8, scale: 0.98, duration: 0.14, ease: 'power1.in' })
      .to(overlay, { autoAlpha: 0, duration: 0.12, ease: 'power1.in' }, '<0.03');
  }, [isOpen, isMounted]);

  if (!isMounted) return null;

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 flex items-center justify-center ${overlayClassName}`}
      style={overlayStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBackdropClick?.();
      }}
    >
      <div ref={panelRef} className={panelClassName} style={panelStyle}>
        {renderedChildren}
      </div>
    </div>
  );
};

export default GsapModal;
