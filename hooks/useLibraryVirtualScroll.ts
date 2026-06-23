import { useCallback, useEffect, useState } from 'react';

interface UseLibraryVirtualScrollParams {
  itemCount: number;
  scrollTop: number;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  listRef: React.RefObject<HTMLDivElement>;
  isEditMode: boolean;
}

interface UseLibraryVirtualScrollResult {
  baseRowHeight: number;
  rowStride: number;
  rowGap: number;
  totalHeight: number;
  startIndex: number;
  endIndex: number;
  visibleCount: number;
  paddingTop: number;
  paddingBottom: number;
  rowMeasureRef: (node: HTMLDivElement | null) => void;
}

/**
 * Virtual scroll math for the track list.
 *
 * Owns viewport measurement (ResizeObserver), dynamic row-height/gap detection,
 * and the start/end/slice computation. scrollTop is owned by the parent (shared
 * with scroll-tracking/highlight) and passed in. The row-measure ref is attached
 * to the first rendered row so the actual height can be sampled.
 */
export function useLibraryVirtualScroll({
  itemCount,
  scrollTop,
  scrollContainerRef,
  listRef,
  isEditMode,
}: UseLibraryVirtualScrollParams): UseLibraryVirtualScrollResult {
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(0);
  const [rowGap, setRowGap] = useState(8);

  const overscan = 6;
  const baseRowHeight = rowHeight || 64;
  const rowStride = baseRowHeight + rowGap;

  const totalHeight = itemCount > 0
    ? (itemCount - 1) * rowStride + baseRowHeight
    : 0;
  // 阈值降到 40：避免中小曲库（≤200）全量渲染所有行，减少 DOM 节点与封面解码后的 GPU 纹理占用。
  // 虚拟化下首行始终渲染，rowMeasure 高度测量不受影响。
  const shouldVirtualize = itemCount > 40 && viewportHeight > 0;
  const startIndex = shouldVirtualize
    ? Math.max(0, Math.floor(scrollTop / rowStride) - overscan)
    : 0;
  const endIndex = shouldVirtualize
    ? Math.min(itemCount, Math.ceil((scrollTop + viewportHeight) / rowStride) + overscan)
    : itemCount;
  const visibleCount = shouldVirtualize ? endIndex - startIndex : itemCount;
  const paddingTop = shouldVirtualize ? startIndex * rowStride : 0;
  const visibleHeight = visibleCount > 0
    ? (visibleCount - 1) * rowStride + baseRowHeight
    : 0;
  const paddingBottom = shouldVirtualize
    ? Math.max(0, totalHeight - paddingTop - visibleHeight)
    : 0;

  const rowMeasureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const nextHeight = node.getBoundingClientRect().height;
    if (nextHeight > 0 && nextHeight !== rowHeight) {
      setRowHeight(nextHeight);
    }
  }, [rowHeight]);

  // Initialize viewport size
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const update = () => {
      setViewportHeight(container.clientHeight || 0);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [scrollContainerRef]);

  // Detect actual row-gap from the list element's computed style
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const style = window.getComputedStyle(list);
    const gapValue = parseFloat(style.rowGap || style.gap || '0');
    if (!Number.isNaN(gapValue) && gapValue !== rowGap) {
      setRowGap(gapValue);
    }
  }, [isEditMode, rowGap, listRef]);

  // Reset measured row height when edit mode toggles (columns change)
  useEffect(() => {
    setRowHeight(0);
  }, [isEditMode]);

  return {
    baseRowHeight,
    rowStride,
    rowGap,
    totalHeight,
    startIndex,
    endIndex,
    visibleCount,
    paddingTop,
    paddingBottom,
    rowMeasureRef,
  };
}
