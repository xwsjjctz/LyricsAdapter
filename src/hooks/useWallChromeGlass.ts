import { useEffect, useRef, useState, type RefObject } from 'react';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';
import { readFocusGlassPresentation } from '../components/focus-mode/useFocusGlassControls';
import type { FocusGlassPresentation } from '../types/focusGlass';
import type { WallChromeAction, WallChromeState } from '../types/wallChrome';

interface Options {
  /** Invisible DOM element marking where the native chrome sits. */
  anchorRef: RefObject<HTMLElement | null>;
  title: string;
  labels: WallChromeState['labels'];
  sections: WallChromeState['sections'];
  onBack: () => void;
  onSelect: (id: string) => void;
}

/** Follow layout changes for this long after a trigger (view transitions animate the anchor). */
const FOLLOW_MS = 750;

/** Hidden whenever any web layer (dialog, menu, focus mode) sits on top of the anchor. */
export function wallChromePresentation(element: HTMLElement | null): FocusGlassPresentation {
  const result = readFocusGlassPresentation(element);
  if (!element) return { ...result, opacity: 0 };
  const rect = element.getBoundingClientRect();
  const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return top && element.contains(top) ? result : { ...result, opacity: 0 };
}

/**
 * Drives the macOS 26+ native poster-wall chrome (glass back button + system
 * source menu). Returns whether it is active; callers render the web chrome
 * otherwise. Navigation stays in React: the native side only reports intents.
 */
export function useWallChromeGlass(options: Options): boolean {
  const latest = useRef(options);
  latest.current = options;
  const [active, setActive] = useState(false);
  const desktop = getDesktopAPI();
  const api = desktop?.platform === 'darwin' ? desktop.ipc?.wallChrome : undefined;

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const unsubscribe = api.onAction((action: WallChromeAction) => {
      if (cancelled) return;
      if (action.type === 'back') latest.current.onBack();
      else latest.current.onSelect(action.id);
    });
    void api.start()
      .then(result => { if (!cancelled) setActive(result.ok && result.data); })
      .catch(error => logger.warn('[WallChrome] Using web chrome:', error));
    return () => {
      cancelled = true;
      unsubscribe();
      void api.stop().catch(error => logger.warn('[WallChrome] Cleanup failed:', error));
    };
  }, [api]);

  const sendRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!active || !api) return;
    let cancelled = false;
    let frame = 0;
    let deadline = 0;
    let last = '';
    const fallback = () => {
      if (cancelled) return;
      cancelled = true;
      setActive(false);
      void api.stop().catch(error => logger.warn('[WallChrome] Cleanup failed:', error));
    };
    const send = () => {
      if (cancelled) return;
      const current = latest.current;
      const payload: WallChromeState = {
        presentation: wallChromePresentation(current.anchorRef.current),
        darkMode: document.documentElement.classList.contains('theme-dark'),
        title: current.title,
        labels: current.labels,
        sections: current.sections,
      };
      const serialized = JSON.stringify(payload);
      if (serialized === last) return;
      last = serialized;
      void api.update(payload).then(result => { if (!result.ok) fallback(); }).catch(fallback);
    };
    const tick = () => {
      frame = 0;
      send();
      if (!cancelled && performance.now() < deadline) frame = requestAnimationFrame(tick);
    };
    const follow = () => {
      send();
      deadline = performance.now() + FOLLOW_MS;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    sendRef.current = send;
    // Dialogs and menus mount into <body>; theme changes flip <html> classes.
    const layers = new MutationObserver(follow);
    layers.observe(document.body, { childList: true, subtree: true });
    const theme = new MutationObserver(follow);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', follow);
    // Covering layers such as focus mode animate away; re-check when any
    // transition starts and once more when it settles, however long it runs.
    document.addEventListener('transitionrun', follow);
    document.addEventListener('transitionend', send);
    document.addEventListener('transitioncancel', send);
    follow();
    return () => {
      cancelled = true;
      sendRef.current = null;
      cancelAnimationFrame(frame);
      layers.disconnect();
      theme.disconnect();
      window.removeEventListener('resize', follow);
      document.removeEventListener('transitionrun', follow);
      document.removeEventListener('transitionend', send);
      document.removeEventListener('transitioncancel', send);
    };
  }, [active, api]);

  // Title, labels or menu content changed: push them without waiting for layout.
  useEffect(() => {
    sendRef.current?.();
  }, [options.title, options.labels, options.sections]);

  return active;
}
