import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/** Hover opens the panel; a short grace period bridges the gap above the speaker. */
export function useVolumeDisclosure(visible: boolean) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const pointerInside = useRef(false);
  const keyboardInside = useRef(false);
  const dragging = useRef(false);
  const ignoreFocus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  const open = useCallback(() => { cancel(); setExpanded(true); }, [cancel]);
  const close = useCallback(() => {
    cancel(); pointerInside.current = false; keyboardInside.current = false; dragging.current = false;
    setExpanded(false);
  }, [cancel]);
  const closeSoon = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => {
      if (!pointerInside.current && !keyboardInside.current && !dragging.current) setExpanded(false);
    }, 500);
  }, [cancel]);
  const enter = useCallback(() => { pointerInside.current = true; open(); }, [open]);
  const leave = useCallback(() => { pointerInside.current = false; closeSoon(); }, [closeSoon]);
  const pointerDown = useCallback(() => { keyboardInside.current = false; }, []);
  const keyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey) { keyboardInside.current = true; open(); }
  }, [open]);
  const startDrag = useCallback(() => { dragging.current = true; open(); }, [open]);
  const focusIn = useCallback((event: FocusEvent<HTMLElement>) => {
    if (!ignoreFocus.current && event.target.matches(':focus-visible')) { keyboardInside.current = true; open(); }
  }, [open]);
  const focusOut = useCallback((event: FocusEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
    keyboardInside.current = false; closeSoon();
  }, [closeSoon]);

  useEffect(() => { if (!visible) close(); }, [visible, close]);
  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    if (!visible || !expanded) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close();
    };
    const endDrag = () => { dragging.current = false; closeSoon(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); close();
      // Returning keyboard focus must not immediately reveal the panel again.
      ignoreFocus.current = true;
      triggerRef.current?.focus({ preventScroll: true });
      ignoreFocus.current = false;
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('pointerup', endDrag, true);
    document.addEventListener('pointercancel', endDrag, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('pointerup', endDrag, true);
      document.removeEventListener('pointercancel', endDrag, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', close);
    };
  }, [visible, expanded, close, closeSoon]);

  return { expanded: visible && expanded, rootRef, triggerRef, sliderRef, open, close, enter, leave, pointerDown, keyDown, startDrag, focusIn, focusOut };
}
