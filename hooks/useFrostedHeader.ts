import { useEffect, useRef, useState } from 'react';
import { useGlassUI } from './useGlassUI';

/**
 * Measures a view's in-flow header band so the App-level frosted overlay can be
 * sized to match, and the view can pad its scroll content (topInset) to scroll
 * under the band — mirroring LibraryView's glass layout.
 *
 * Returns a `ref` to attach to the header wrapper, the measured `headerHeight`,
 * and the current `glassUI` flag. When glass UI is off the height collapses to 0
 * and `0` is reported upstream, so callers fall back to the non-frosted layout.
 *
 * @param onHeightChange optional callback (e.g. App's setHeaderHeight) kept in
 *   sync whenever the band resizes (import-progress bar, locale change, etc.).
 *
 * @deprecated Frosted Glass UI 已从实验性功能移除，暂时停用（glassUI 恒为 false，headerHeight 恒为 0）。后续迭代或移除。
 */
export function useFrostedHeader(onHeightChange?: (height: number) => void) {
  const glassUI = useGlassUI();
  const ref = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    if (!glassUI) {
      setHeaderHeight(0);
      onHeightChange?.(0);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const h = el.getBoundingClientRect().height;
      setHeaderHeight(h);
      onHeightChange?.(h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [glassUI, onHeightChange]);

  return { ref, headerHeight, glassUI };
}
