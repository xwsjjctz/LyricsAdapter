import { useCallback, useEffect, useRef, useState, type RefObject, type MouseEvent, type PointerEvent, type KeyboardEvent } from 'react';
import { FocusControlsIdle } from './focusControlsIdle';

/** Keep native and DOM controls on one idle clock without consuming scroll or handle drags. */
export function useFocusControlsIdle(enabled: boolean, visible: boolean, overlayRef: RefObject<HTMLDivElement>) {
  const [shown, setShown] = useState(true);
  const controller = useRef<FocusControlsIdle>();
  if (!controller.current) controller.current = new FocusControlsIdle(setShown);
  const wakeGesture = useRef(false);
  const wakeKeyboard = useRef(false);
  const activePointers = useRef(new Set<number>());
  const wakeCleanup = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerFocus = useRef<Element | null>(null);
  const idle = controller.current;
  const activity = useCallback(() => idle.activity(), [idle]);
  const nativeStart = useCallback(() => idle.hold('native'), [idle]);
  const nativeEnd = useCallback(() => idle.release('native'), [idle]);
  const keyboardActivity = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    pointerFocus.current = null;
    wakeKeyboard.current = (event.key === 'Enter' || event.key === ' ') && !idle.visible;
    idle.activity();
    idle.protectFocus(!!overlayRef.current?.querySelector('[data-focus-controls]')?.contains(document.activeElement));
  }, [idle, overlayRef]);
  useEffect(() => {
    if (!enabled) return;
    idle.activate(visible && !document.hidden);
    const release = (event: globalThis.PointerEvent) => {
      idle.release(`pointer:${event.pointerId}`);
      activePointers.current.delete(event.pointerId);
      if (activePointers.current.size) return;
      if (wakeCleanup.current !== null) clearTimeout(wakeCleanup.current);
      if (event.type === 'pointercancel') wakeGesture.current = false;
      else wakeCleanup.current = setTimeout(() => {wakeGesture.current = false; wakeCleanup.current = null;}, 700);
    };
    const onVisibility = () => { wakeGesture.current = false; wakeKeyboard.current = false; activePointers.current.clear(); idle.activate(visible && !document.hidden); };
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
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('focusin', focus); document.addEventListener('focusout', blur);
    return () => {
      alive = false; idle.dispose(); wakeGesture.current = false;
      wakeKeyboard.current = false; activePointers.current.clear();
      pointerFocus.current = null;
      if (wakeCleanup.current !== null) clearTimeout(wakeCleanup.current); wakeCleanup.current = null;
      window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('focusin', focus); document.removeEventListener('focusout', blur);
    };
  }, [enabled, visible, idle, overlayRef]);
  const pointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || !visible) return;
    const handle = (event.target as Element).closest('[data-testid="focus-dismiss-handle"]');
    pointerFocus.current = event.target as Element;
    idle.protectFocus(false);
    if (wakeCleanup.current !== null) clearTimeout(wakeCleanup.current); wakeCleanup.current = null;
    // Preserve wake-only intent for the whole multi-pointer gesture. A second
    // finger arrives after the first already made the controls visible.
    if (!activePointers.current.size) wakeGesture.current = !handle && !idle.visible;
    else wakeGesture.current ||= !handle && !idle.visible;
    activePointers.current.add(event.pointerId);
    wakeKeyboard.current = false;
    idle.hold(`pointer:${event.pointerId}`, !handle);
  }, [enabled, visible, idle]);
  const click = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!enabled || !visible || (event.target as Element).closest('[data-testid="focus-dismiss-handle"]')) return;
    // AMLL's touchend calls target.click(), whose detail is zero. The gesture
    // flag therefore also guards programmatic clicks before any seek callback.
    const wakeOnly = !idle.visible || wakeGesture.current || wakeKeyboard.current;
    wakeKeyboard.current = false; idle.activity();
    // The first hidden-page tap is wake intent, never an implicit lyric seek/play.
    if (wakeOnly) { event.preventDefault(); event.stopPropagation(); }
  }, [enabled, visible, idle]);
  return {shown, activity, keyboardActivity, nativeStart, nativeEnd, pointerDown, click};
}
