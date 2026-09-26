import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '../../types';
import PosterTile from './PosterTile';
import { computeWallLayout } from './wallLayout';
import { useWallSourceTransition } from './useWallSourceTransition';

const WALL_GAP = 8;
/** Matches --wall-bleed: padding on every side of the scroll box. */
const WALL_BLEED = 12;
/** Extra viewport heights mounted above and below the visible band. */
const OVERSCAN_VIEWPORTS = 1;
/** Suppress re-flow transitions while the width is being dragged. */
const RESIZE_SETTLE_MS = 180;

interface PosterWallProps {
  tracks: Track[];
  /** Identity of the source being shown; changing it plays the switch animation. */
  sourceKey: string;
  currentTrackId?: string | undefined;
  loading?: boolean;
  emptyLabel: string;
  loadingLabel: string;
  hasMore?: boolean;
  onLoadMore?: (() => void) | undefined;
  /** Space kept clear below the last row for the floating control bar. */
  bottomInset: number;
  onTrackSelect: (index: number) => void;
  hasMenu: (track: Track) => boolean;
  onOpenMenu: (track: Track, x: number, y: number, trigger: HTMLElement) => void;
}

/**
 * Virtualized poster wall. Every track is a cover tile; the playing track is
 * featured at 6x6 in the top-left and neighbours re-flow around it.
 */
const PosterWall: React.FC<PosterWallProps> = ({
  tracks, sourceKey, currentTrackId, loading = false, emptyLabel, loadingLabel,
  hasMore = false, onLoadMore, bottomInset, onTrackSelect, hasMenu, onOpenMenu,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [animateLayout, setAnimateLayout] = useState(false);
  const scrollFrameRef = useRef<number | null>(null);
  const { renderKey, renderedTracks, isExiting } = useWallSourceTransition(sourceKey, tracks, containerRef);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      setWidth(Math.max(0, container.clientWidth - WALL_BLEED * 2));
      setViewportHeight(container.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(() => {
      setAnimateLayout(false);
      measure();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => setAnimateLayout(true), RESIZE_SETTLE_MS);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      clearTimeout(settleTimer);
    };
  }, []);

  // A new source starts from the top, where its featured tile lives.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = 0;
    setScrollTop(0);
  }, [renderKey]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const featuredIndex = useMemo(
    () => (currentTrackId ? renderedTracks.findIndex(track => track.id === currentTrackId) : -1),
    [currentTrackId, renderedTracks],
  );
  const layout = useMemo(
    () => computeWallLayout({ count: renderedTracks.length, featuredIndex, width, gap: WALL_GAP }),
    [featuredIndex, renderedTracks.length, width],
  );

  const overscan = viewportHeight * OVERSCAN_VIEWPORTS;
  const visibleTiles = useMemo(() => {
    const top = scrollTop - overscan;
    const bottom = scrollTop + viewportHeight + overscan;
    // Render in track order, not layout order: reordering DOM nodes when the
    // featured track changes would cancel the tiles' position transitions.
    return layout.tiles
      .filter(tile => tile.y + tile.height >= top && tile.y <= bottom)
      .sort((a, b) => a.index - b.index);
  }, [layout.tiles, overscan, scrollTop, viewportHeight]);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const container = containerRef.current;
      if (!container) return;
      setScrollTop(container.scrollTop);
      const nearEnd = container.scrollTop + container.clientHeight >= layout.height - container.clientHeight;
      if (nearEnd && hasMore && !loading) onLoadMore?.();
    });
  }, [hasMore, layout.height, loading, onLoadMore]);

  const isEmpty = renderedTracks.length === 0;

  return (
    <div
      ref={containerRef}
      className="poster-wall"
      data-slot-transition="self"
      data-animate-layout={animateLayout}
      aria-busy={isExiting || loading || undefined}
      style={isExiting ? { pointerEvents: 'none' } : undefined}
      onScroll={handleScroll}
    >
      {isEmpty ? (
        <p className="poster-wall__status" style={{ color: 'var(--theme-text-muted)' }}>
          {loading ? loadingLabel : emptyLabel}
        </p>
      ) : (
        <div className="poster-wall__canvas" style={{ height: layout.height + bottomInset + WALL_GAP }}>
          {visibleTiles.map(tile => {
            const track = renderedTracks[tile.index]!;
            return (
              <PosterTile
                key={`${renderKey}:${track.id}`}
                track={track}
                tile={tile}
                hasMenu={hasMenu(track)}
                onSelect={onTrackSelect}
                onOpenMenu={onOpenMenu}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PosterWall;
