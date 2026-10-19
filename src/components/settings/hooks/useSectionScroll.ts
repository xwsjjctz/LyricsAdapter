import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Space kept above a section heading when the list scrolls to it. */
const SCROLL_OFFSET_PX = 12;
/** A section counts as current once its heading is this close to the top. */
const ACTIVE_OFFSET_PX = 48;
/** Input that means the person is scrolling the list themselves. */
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

const sectionElement = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);

/**
 * One scrolling list of settings sections with a navigation bar: `scrollTo` moves the list
 * to a section, and scrolling by hand marks the section being read. The container must be
 * the sections' offset parent.
 *
 * Sections finish loading after they mount (plugin lists, shortcut rows), which moves the
 * content and fires scroll events. So a requested section stays pinned, and is realigned
 * whenever a section changes size, until the person scrolls themselves.
 */
export function useSectionScroll<T extends string>(containerRef: RefObject<HTMLElement | null>, ids: readonly T[], initial: T) {
  const [active, setActive] = useState<T>(initial);
  const pinned = useRef<T | null>(null);

  const align = useCallback((id: T, behavior: ScrollBehavior) => {
    const container = containerRef.current;
    const target = container && sectionElement(container, id);
    if (!container || !target) return;
    const top = Math.max(0, target.offsetTop - SCROLL_OFFSET_PX);
    if (typeof container.scrollTo === 'function') container.scrollTo({ top, behavior });
    else container.scrollTop = top;
  }, [containerRef]);

  const scrollTo = useCallback((id: T, behavior: ScrollBehavior = 'smooth') => {
    pinned.current = id;
    setActive(id);
    align(id, behavior);
  }, [align]);

  // Open on the requested section before the first paint.
  useLayoutEffect(() => { scrollTo(initial, 'auto'); }, [initial, scrollTo]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const release = () => { pinned.current = null; };
    const update = () => {
      frame = 0;
      if (pinned.current) return;
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
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (pinned.current) align(pinned.current, 'auto');
    });
    for (const id of ids) {
      const element = sectionElement(container, id);
      if (element) resize?.observe(element);
    }
    container.addEventListener('scroll', onScroll, { passive: true });
    for (const type of USER_SCROLL_EVENTS) container.addEventListener(type, release, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      for (const type of USER_SCROLL_EVENTS) container.removeEventListener(type, release);
      resize?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [align, containerRef, ids]);

  return { active, scrollTo };
}
