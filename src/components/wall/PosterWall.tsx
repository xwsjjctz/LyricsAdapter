import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '../../types';
import type { OnlineProgress } from '../../types/onlineProgress';
import PosterTile from './PosterTile';
import { computeWallLayout } from './wallLayout';
import { useWallSourceTransition } from './useWallSourceTransition';
import { autoLocateScrollTop, centerLocateScrollTop, type WallLocateInput } from './wallLocate';

// Covers sit flush against each other.
const WALL_GAP = 0;
/** Extra viewport heights mounted above and below the visible band. */
const OVERSCAN_VIEWPORTS = 1;

interface PosterWallProps {
  downloadProgress?: OnlineProgress | undefined;
  tracks: Track[];
  /** Identity of the source being shown; changing it plays the switch animation. */
  sourceKey: string;
  currentTrackId?: string | undefined;
  loading?: boolean;
  emptyLabel: string;
  loadingLabel: string;
  hasMore?: boolean;
  /** The last page failed; only an explicit scroll retries it. */
  loadError?: boolean;
  onLoadMore?: (() => void) | undefined;
  onTrackSelect: (index: number) => void;
  hasMenu: (track: Track) => boolean;
  onOpenMenu: (track: Track, x: number, y: number, trigger: HTMLElement) => void;
  /** Shown under the empty label, e.g. an import button. */
  emptyAction?: React.ReactNode;
  selecting?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: ((track: Track) => void) | undefined;
  /** When set, tiles can be dragged onto each other to swap places. */
  onSwap?: ((firstIndex: number, secondIndex: number) => void) | undefined;
  /** Bumped on every track switch: scroll only if the playing tile left the view. */
  autoLocateToken?: number | undefined;
  /**
   * A pending "centre the playing tile" request (explicit locate, or a source
   * switch made to locate). Handled once this source is shown and laid out.
   */
  locateRequest?: { token: number; smooth: boolean } | undefined;
  onLocateRequestHandled?: ((token: number) => void) | undefined;
  /** Saved offset of this source, applied once when it is shown; omitted starts at the top. */
  restoreScrollTop?: number | undefined;
  /** Reports the offset while this source is shown, so it can be restored later. */
  onScrollPositionChange?: ((scrollTop: number) => void) | undefined;
  /** Overlay heights the playing tile must stay clear of. */
  topInset?: number;
  bottomInset?: number;
}

/** Marks an internal tile drag so external file drops are told apart. */
const TILE_DRAG_TYPE = 'application/x-lyricsadapter-tile';

/**
 * Virtualized poster wall. Every track is a cover tile in list order; the
 * playing track is marked where it is rather than moved.
 */
const PosterWall: React.FC<PosterWallProps> = ({
  tracks, sourceKey, currentTrackId, loading = false, emptyLabel, loadingLabel, downloadProgress,
  hasMore = false, loadError = false, onLoadMore, onTrackSelect, hasMenu, onOpenMenu,
  emptyAction, selecting = false, selectedIds, onToggleSelect, onSwap,
  autoLocateToken = 0, locateRequest, onLocateRequestHandled,
  topInset = 0, bottomInset = 0, restoreScrollTop, onScrollPositionChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollFrameRef = useRef<number | null>(null);
  const autoRequestedLengthRef = useRef<number | null>(null);
  const { renderKey, renderedTracks, isExiting } = useWallSourceTransition(sourceKey, tracks, containerRef);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      // No horizontal padding: tiles span the full width.
      setWidth(container.clientWidth);
      setViewportHeight(container.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // A new source starts from the top until its saved offset is restored below.
  const restorePendingRef = useRef(true);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = 0;
    lastScrollTopRef.current = 0;
    setScrollTop(0);
    autoRequestedLengthRef.current = null;
    restorePendingRef.current = true;
  }, [renderKey]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const layout = useMemo(
    () => computeWallLayout({ count: renderedTracks.length, width, gap: WALL_GAP }),
    [renderedTracks.length, width],
  );

  // Tiles scale with the width (cell = width / 12), so a fixed pixel offset
  // shows different songs after a resize. Rescale it around the viewport
  // centre, before paint, so the songs in view stay put; a height-only
  // resize leaves the layout and the offset unchanged.
  const lastScrollTopRef = useRef(0);
  const measuredWidthRef = useRef(width);
  useLayoutEffect(() => {
    const previous = measuredWidthRef.current;
    measuredWidthRef.current = width;
    const container = containerRef.current;
    if (!container || previous <= 0 || width <= 0 || previous === width || restorePendingRef.current) return;
    const half = container.clientHeight / 2;
    const maxTop = Math.max(0, layout.height - container.clientHeight);
    const top = Math.max(0, Math.min((lastScrollTopRef.current + half) * (width / previous) - half, maxTop));
    container.scrollTop = top;
    lastScrollTopRef.current = top;
    setScrollTop(top);
  }, [width, layout.height]);

  const overscan = viewportHeight * OVERSCAN_VIEWPORTS;
  const visibleTiles = useMemo(() => {
    const top = scrollTop - overscan;
    const bottom = scrollTop + viewportHeight + overscan;
    return layout.tiles.filter(tile => tile.y + tile.height >= top && tile.y <= bottom);
  }, [layout.tiles, overscan, scrollTop, viewportHeight]);

  // Within one viewport of the end, ask for the next page.
  const loadMoreIfNearEnd = useCallback((automatic: boolean) => {
    const container = containerRef.current;
    // Mid-transition the wall still lays out the outgoing source.
    if (!container || !hasMore || loading || isExiting) return;
    const nearEnd = container.scrollTop + container.clientHeight >= layout.height - container.clientHeight;
    if (!nearEnd) return;
    // Layout settling re-runs the check; ask once per list length.
    if (automatic && autoRequestedLengthRef.current === renderedTracks.length) return;
    autoRequestedLengthRef.current = renderedTracks.length;
    onLoadMore?.();
  }, [hasMore, isExiting, layout.height, loading, onLoadMore, renderedTracks.length]);

  // Scroll events alone miss a page that lands while the user rests at the
  // bottom, and a first page too short to scroll. Re-check whenever the
  // wall grows or a load settles; a failed page waits for the user instead.
  useEffect(() => {
    if (!loadError) loadMoreIfNearEnd(true);
  }, [loadError, loadMoreIfNearEnd]);

  const handleScroll = useCallback(() => {
    lastScrollTopRef.current = containerRef.current?.scrollTop ?? 0;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const container = containerRef.current;
      if (!container) return;
      setScrollTop(container.scrollTop);
      if (settledRef.current && !restorePendingRef.current) reportScrollRef.current?.(container.scrollTop);
      loadMoreIfNearEnd(false);
    });
  }, [loadMoreIfNearEnd]);

  const isEmpty = renderedTracks.length === 0;
  const settled = !isExiting && renderKey === sourceKey;

  // Reopen a source where it was left (like the list view) instead of jumping
  // to the playing track. Runs before paint, once the tracks are laid out; the
  // saved offset may arrive after mount (restored settings), so read it late.
  const requestToken = locateRequest?.token;
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!restorePendingRef.current || !settled || !container) return;
    // An explicit or cross-source locate decides where this source opens.
    if (requestToken != null) { restorePendingRef.current = false; return; }
    if (renderedTracks.length === 0 || layout.height === 0 || viewportHeight === 0) return;
    restorePendingRef.current = false;
    const top = Math.max(0, Math.min(restoreScrollTop ?? 0, layout.height - viewportHeight));
    if (top === 0) return;
    container.scrollTop = top;
    // The scroll event arrives later; a resize before it must see this offset.
    lastScrollTopRef.current = top;
    setScrollTop(top);
  }, [layout.height, renderedTracks.length, requestToken, restoreScrollTop, settled, viewportHeight]);

  // Only the settled source reports its offset: the reset to the top on entry
  // and the outgoing source's exit animation must not overwrite saved offsets.
  const reportScrollRef = useRef(onScrollPositionChange);
  reportScrollRef.current = onScrollPositionChange;
  const settledRef = useRef(settled);
  settledRef.current = settled;

  // Locating the playing tile (ported from the list view).
  const currentIndex = useMemo(
    () => (currentTrackId ? renderedTracks.findIndex(track => track.id === currentTrackId) : -1),
    [currentTrackId, renderedTracks],
  );
  const locateInput = useCallback((index: number): WallLocateInput | null => {
    const container = containerRef.current;
    const tile = layout.tiles[index]?.index === index ? layout.tiles[index] : layout.tiles.find(t => t.index === index);
    if (!container || !tile) return null;
    return {
      tileTop: tile.y, tileBottom: tile.y + tile.height, scrollTop: container.scrollTop,
      viewportHeight: container.clientHeight, contentHeight: layout.height, topInset, bottomInset,
    };
  }, [bottomInset, layout, topInset]);
  const scrollWall = useCallback((top: number, behavior: ScrollBehavior) => {
    containerRef.current?.scrollTo({ top, behavior });
  }, []);

  const previousIndexRef = useRef(currentIndex);
  const handledAutoLocateRef = useRef(autoLocateToken);
  useEffect(() => {
    if (handledAutoLocateRef.current === autoLocateToken) return;
    // Startup restores the playing track before the wall is measured or
    // filled; keep the request until there is a layout to locate in.
    if (isExiting || layout.tiles.length === 0) return;
    handledAutoLocateRef.current = autoLocateToken;
    const previous = previousIndexRef.current;
    const input = currentIndex >= 0 ? locateInput(currentIndex) : null;
    if (!input) return;
    previousIndexRef.current = currentIndex;
    const target = autoLocateScrollTop(input, previous < 0 || currentIndex > previous);
    if (target !== null) scrollWall(target, 'smooth');
  }, [autoLocateToken, currentIndex, isExiting, layout.tiles.length, locateInput, scrollWall]);

  // Centre the playing tile once this source has entered and is laid out.
  const requestSmooth = locateRequest?.smooth ?? false;
  useEffect(() => {
    if (requestToken == null || isExiting || renderKey !== sourceKey) return;
    if (loading && currentIndex < 0) return; // It may be on a page still loading.
    if (currentIndex >= 0) {
      const input = locateInput(currentIndex);
      if (!input) return; // Not measured yet.
      previousIndexRef.current = currentIndex;
      scrollWall(centerLocateScrollTop(input), requestSmooth ? 'smooth' : 'auto');
    }
    onLocateRequestHandled?.(requestToken);
  }, [currentIndex, isExiting, loading, locateInput, onLocateRequestHandled, renderKey, requestSmooth, requestToken, scrollWall, sourceKey]);

  // Drag-to-swap: tile geometry is fixed by index, so the two tiles keep their
  // size and place and only exchange the songs they show.
  const [dragSource, setDragSource] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const canSwap = !!onSwap && !selecting && !isExiting;
  useEffect(() => { setDragSource(null); setDropTarget(null); }, [renderKey, selecting]);

  const handleDragStart = useCallback((index: number, event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(TILE_DRAG_TYPE, String(index));
    setDragSource(index);
  }, []);
  const handleDragOver = useCallback((index: number, event: React.DragEvent) => {
    if (dragSource === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(index === dragSource ? null : index);
  }, [dragSource]);
  const handleDragEnd = useCallback(() => {
    setDragSource(null);
    setDropTarget(null);
  }, []);
  const handleDrop = useCallback((index: number, event: React.DragEvent) => {
    if (dragSource === null) return;
    event.preventDefault();
    event.stopPropagation();
    const from = dragSource;
    handleDragEnd();
    if (from !== index) onSwap?.(from, index);
  }, [dragSource, handleDragEnd, onSwap]);

  return (
    <div
      ref={containerRef}
      className="poster-wall"
      data-slot-transition="self"
      aria-busy={isExiting || loading || undefined}
      style={isExiting ? { pointerEvents: 'none' } : undefined}
      onScroll={handleScroll}
    >
      {isEmpty ? (
        <div className="poster-wall__status" style={{ color: 'var(--theme-text-muted)' }}>
          <p>{loading ? loadingLabel : emptyLabel}</p>
          {!loading && emptyAction}
        </div>
      ) : (
        <div className="poster-wall__canvas" style={{ height: layout.height }}>
          {visibleTiles.map(tile => {
            const track = renderedTracks[tile.index]!;
            const progress = downloadProgress?.[track.id];
            return (
              <PosterTile
                key={`${renderKey}:${track.id}`}
                track={track}
                download={progress?.type === 'download' ? progress : undefined}
                tile={tile}
                isCurrent={track.id === currentTrackId}
                hasMenu={hasMenu(track)}
                onSelect={onTrackSelect}
                onOpenMenu={onOpenMenu}
                selecting={selecting}
                selected={selectedIds?.has(track.id) ?? false}
                onToggleSelect={onToggleSelect}
                draggable={canSwap}
                dragState={tile.index === dragSource ? 'source' : tile.index === dropTarget ? 'target' : undefined}
                onDragStartTile={handleDragStart}
                onDragOverTile={handleDragOver}
                onDropTile={handleDrop}
                onDragEndTile={handleDragEnd}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PosterWall;
