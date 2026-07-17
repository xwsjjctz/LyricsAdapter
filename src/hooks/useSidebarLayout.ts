import { useCallback, useEffect, useState } from 'react';
import { indexedDBStorage } from '../services/indexedDBStorage';
import { logger } from '../services/logger';

/** Manual-resize bounds for the sidebar (px). Dragging below the minimum
 *  collapses the sidebar instead of shrinking it further. */
export const SIDEBAR_MIN_WIDTH = 192;
export const SIDEBAR_MAX_WIDTH = 232;
export const SIDEBAR_DEFAULT_WIDTH = 208;

const STORAGE_KEY = 'sidebar-layout';

interface PersistedSidebarLayout {
  /** Expanded width, always clamped to [MIN, MAX]. */
  width?: number;
  collapsed?: boolean;
}

const clampWidth = (value: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));

export interface SidebarLayout {
  /** Current expanded width in px (unaffected by `collapsed`). */
  width: number;
  collapsed: boolean;
  /** True while a drag-resize is in progress (used to suspend width transitions). */
  isResizing: boolean;
  /** Toggle collapse; expanding restores the last expanded width. */
  toggleCollapsed: () => void;
  /** Begin a pointer drag-resize from the sidebar's right edge. */
  startResize: (event: React.PointerEvent) => void;
}

/**
 * Owns the resizable/collapsible sidebar layout and persists it across
 * restarts. The expanded `width` is always kept within [MIN, MAX]; dragging
 * narrower than MIN collapses the sidebar and pins the restore width to MIN,
 * so re-opening a drag-collapsed sidebar returns it to MIN (not an invalid
 * sub-minimum width).
 */
export function useSidebarLayout(): SidebarLayout {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  // Load persisted layout once on mount.
  useEffect(() => {
    let cancelled = false;
    void indexedDBStorage.getSetting(STORAGE_KEY).then((raw) => {
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw) as PersistedSidebarLayout;
        if (typeof parsed.width === 'number') setWidth(clampWidth(parsed.width));
        if (typeof parsed.collapsed === 'boolean') setCollapsed(parsed.collapsed);
      } catch (error) {
        logger.warn('[SidebarLayout] load failed:', error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: PersistedSidebarLayout) => {
    void indexedDBStorage.setSetting(STORAGE_KEY, JSON.stringify(next)).catch((error) => {
      logger.error('[SidebarLayout] save failed:', error);
    });
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      persist({ width, collapsed: next });
      return next;
    });
  }, [persist, width]);

  const startResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const originWidth = collapsed ? SIDEBAR_MIN_WIDTH : width;
    let nextWidth = originWidth;
    let nextCollapsed = collapsed;

    setIsResizing(true);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: PointerEvent) => {
      const raw = originWidth + (moveEvent.clientX - startX);
      if (raw < SIDEBAR_MIN_WIDTH) {
        // Drag past the minimum collapses the sidebar; restore width pins to MIN.
        nextCollapsed = true;
        nextWidth = SIDEBAR_MIN_WIDTH;
        setCollapsed(true);
        setWidth(SIDEBAR_MIN_WIDTH);
      } else {
        nextCollapsed = false;
        nextWidth = clampWidth(raw);
        setCollapsed(false);
        setWidth(nextWidth);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setIsResizing(false);
      persist({ width: nextWidth, collapsed: nextCollapsed });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [collapsed, persist, width]);

  return { width, collapsed, isResizing, toggleCollapsed, startResize };
}
