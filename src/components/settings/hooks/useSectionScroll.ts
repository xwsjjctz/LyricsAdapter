import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Space kept above a section heading when the list scrolls to it. */
const SCROLL_OFFSET_PX = 12;
/** A section counts as current once its heading is this close to the top. */
const ACTIVE_OFFSET_PX = 48;
/** Fallback for a programmatic scroll that never fires `scrollend` (already in place). */
const SCROLL_SETTLE_MS = 700;

const sectionElement = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);

/**
 * One scrolling list of settings sections with a navigation bar: `scrollTo` moves the list
 * to a section, and scrolling by hand marks the section being read. The container must be
 * the sections' offset parent. Chromium's scroll anchoring keeps a section in place when
 * content above it loads later.
 */
export function useSectionScroll<T extends string>(containerRef: RefObject<HTMLElement | null>, ids: readonly T[], initial: T) {
  const [active, setActive] = useState<T>(initial);
  // While a navigation scroll runs, the sections it passes are not "current".
  const navigating = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();
  const frame = useRef(0);

  const scrollTo = useCallback((id: T, behavior: ScrollBehavior = 'smooth') => {
    setActive(id);
    const container = containerRef.current;
    const target = container && sectionElement(container, id);
    if (!container || !target) return;
    navigating.current = true;
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => { navigating.current = false; }, SCROLL_SETTLE_MS);
    const top = Math.max(0, target.offsetTop - SCROLL_OFFSET_PX);
    if (typeof container.scrollTo === 'function') container.scrollTo({ top, behavior });
    else container.scrollTop = top;
  }, [containerRef]);

  // Open on the requested section before the first paint.
  useLayoutEffect(() => { scrollTo(initial, 'auto'); }, [initial, scrollTo]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const settle = () => { clearTimeout(settleTimer.current); navigating.current = false; };
    const update = () => {
      frame.current = 0;
      if (navigating.current) return;
      // At the end of the list the last section is current, even when it is short.
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
        setActive(ids[ids.length - 1]!);
        return;
      }
      const line = container.scrollTop + ACTIVE_OFFSET_PX;
      let current = ids[0]!;
      for (const id of ids) {
        const element = sectionElement(container, id);
        if (element && element.offsetTop <= line) current = id;
      }
      setActive(current);
    };
    const onScroll = () => { if (!frame.current) frame.current = requestAnimationFrame(update); };
    container.addEventListener('scroll', onScroll, { passive: true });
    container.addEventListener('scrollend', settle);
    return () => {
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('scrollend', settle);
      cancelAnimationFrame(frame.current);
      clearTimeout(settleTimer.current);
    };
  }, [containerRef, ids]);

  return { active, scrollTo };
}
