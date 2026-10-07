import { useCallback, useEffect, useRef, useState, type RefObject, type MouseEvent, type PointerEvent, type KeyboardEvent } from 'react';
import { FocusControlsIdle } from './focusControlsIdle';

/** Reveal portrait controls only inside their bounds, even while they are inert. */
export function useFocusControlsIdle(enabled: boolean, visible: boolean, overlayRef: RefObject<HTMLDivElement>) {
  const [shown, setShown] = useState(false);
  const controller = useRef<FocusControlsIdle>();
  if (!controller.current) controller.current = new FocusControlsIdle(setShown);
  const wakeGesture = useRef(false);
  const wakeKeyboard = useRef(false);
  const activePointers = useRef(new Set<number>());
  const wakeCleanup = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerFocus = useRef<Element | null>(null);
  const lastPointer = useRef<{ clientX: number; clientY: number } | null>(null);
  const idle = controller.current;
  const containsPointer = useCallback((point: { clientX: number; clientY: number }) => {
    const bounds = overlayRef.current?.querySelector('[data-focus-controls]')?.getBoundingClientRect();
    return !!bounds && bounds.width > 0 && bounds.height > 0
      && point.clientX >= bounds.left && point.clientX < bounds.right
      && point.clientY >= bounds.top && point.clientY < bounds.bottom;
  }, [overlayRef]);
  const nativeStart = useCallback(() => {
    if (enabled && visible) idle.hold('hover');
  }, [enabled, visible, idle]);
  const nativeEnd = useCallback(() => idle.release('hover'), [idle]);
  const syncHover = useCallback(() => {
    if (!enabled || !visible) return;
    if (lastPointer.current && containsPointer(lastPointer.current)) idle.hold('hover');
    else idle.release('hover');
  }, [enabled, visible, idle, containsPointer]);
  const pointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    lastPointer.current = { clientX: event.clientX, clientY: event.clientY };
    syncHover();
  }, [syncHover]);
  const pointerLeave = useCallback(() => {
    lastPointer.current = null;
    nativeEnd();
  }, [nativeEnd]);
  const keyboardActivity = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled || !visible || !overlayRef.current?.querySelector('[data-focus-controls]')?.contains(event.target as Element)) return;
    pointerFocus.current = null;
    wakeKeyboard.current = (event.key === 'Enter' || event.key === ' ') && !idle.visible;
    idle.activity();
    idle.protectFocus(!!overlayRef.current?.querySelector('[data-focus-controls]')?.contains(document.activeElement));
  }, [enabled, visible, idle, overlayRef]);
  useEffect(() => {
    if (!enabled) return;
    idle.activate(visible && !document.hidden, false);
    syncHover();
    const release = (event: globalThis.PointerEvent) => {
      idle.release(`pointer:${event.pointerId}`);
      activePointers.current.delete(event.pointerId);
      if (activePointers.current.size) return;
      if (wakeCleanup.current !== null) clearTimeout(wakeCleanup.current);
      if (event.type === 'pointercancel') wakeGesture.current = false;
      else wakeCleanup.current = setTimeout(() => {wakeGesture.current = false; wakeCleanup.current = null;}, 700);
    };
    const onVisibility = () => {
      wakeGesture.current = false; wakeKeyboard.current = false; activePointers.current.clear();
      lastPointer.current = null;
      idle.activate(visible && !document.hidden, false);
    };
    const focus = () => {
      const active = document.activeElement;
      // Range inputs take focus from touch by default. That incidental focus
      // must not permanently disable idle; keyboard/assistive focus is protected.
      const fromPointer = !!pointerFocus.current && !!active?.contains(pointerFocus.current);
      idle.protectFocus(!fromPointer && !!overlayRef.current?.querySelector('[data-focus-controls]')?.contains(active));
    };
    let alive = true;
    const blur = () => queueMicrotask(() => {if (alive) focus();});
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    window.addEventListener('resize', syncHover); window.addEventListener('blur', pointerLeave);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('focusin', focus); document.addEventListener('focusout', blur);
    return () => {
      alive = false; idle.dispose(); wakeGesture.current = false;
      wakeKeyboard.current = false; activePointers.current.clear();
      pointerFocus.current = null;
      if (wakeCleanup.current !== null) clearTimeout(wakeCleanup.current); wakeCleanup.current = null;
      window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release);
      window.removeEventListener('resize', syncHover); window.removeEventListener('blur', pointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('focusin', focus); document.removeEventListener('focusout', blur);
    };
  }, [enabled, visible, idle, overlayRef, syncHover, pointerLeave]);
  const pointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || !visible) return;
    const handle = (event.target as Element).closest('[data-testid="focus-dismiss-handle"]');
    if (handle) return;
    pointerFocus.current = event.target as Element;
    if (!containsPointer(event)) {
      if (!activePointers.current.size) wakeGesture.current = false;
      wakeKeyboard.current = false;
      return;
    }
    idle.protectFocus(false);
    if (wakeCleanup.current !== null) clearTimeout(wakeCleanup.current); wakeCleanup.current = null;
    // Preserve wake-only intent for the whole multi-pointer gesture. A second
    // finger arrives after the first already made the controls visible.
    if (!activePointers.current.size) wakeGesture.current = !idle.visible;
    else wakeGesture.current ||= !idle.visible;
    activePointers.current.add(event.pointerId);
    wakeKeyboard.current = false;
    idle.hold(`pointer:${event.pointerId}`);
  }, [enabled, visible, idle, containsPointer]);
  const click = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!enabled || !visible || (event.target as Element).closest('[data-testid="focus-dismiss-handle"]')) return;
    // AMLL's touchend calls target.click(), whose detail is zero. The gesture
    // flag therefore also guards programmatic clicks before any seek callback.
    const inside = containsPointer(event)
      || !!overlayRef.current?.querySelector('[data-focus-controls]')?.contains(event.target as Element);
    const wakeOnly = (inside && !idle.visible) || wakeGesture.current || wakeKeyboard.current;
    wakeKeyboard.current = false;
    if (inside) idle.activity();
    // A tap in the hidden controls' bounds reveals them without seeking through them.
    if (wakeOnly) { event.preventDefault(); event.stopPropagation(); }
  }, [enabled, visible, idle, containsPointer, overlayRef]);
  return {shown, pointerMove, pointerLeave, keyboardActivity, nativeStart, nativeEnd, pointerDown, click};
}
