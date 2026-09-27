import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '../../types';
import PosterTile from './PosterTile';
import { computeWallLayout } from './wallLayout';
import { useWallSourceTransition } from './useWallSourceTransition';

// Covers sit flush against each other.
const WALL_GAP = 0;
/** Extra viewport heights mounted above and below the visible band. */
const OVERSCAN_VIEWPORTS = 1;

interface PosterWallProps {
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
}

/**
 * Virtualized poster wall. Every track is a cover tile in list order; the
 * playing track is marked where it is rather than moved.
 */
const PosterWall: React.FC<PosterWallProps> = ({
  tracks, sourceKey, currentTrackId, loading = false, emptyLabel, loadingLabel,
  hasMore = false, loadError = false, onLoadMore, onTrackSelect, hasMenu, onOpenMenu,
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

  // A new source starts from the top.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = 0;
    setScrollTop(0);
    autoRequestedLengthRef.current = null;
  }, [renderKey]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const layout = useMemo(
    () => computeWallLayout({ count: renderedTracks.length, width, gap: WALL_GAP }),
    [renderedTracks.length, width],
  );

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
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const container = containerRef.current;
      if (!container) return;
      setScrollTop(container.scrollTop);
      loadMoreIfNearEnd(false);
    });
  }, [loadMoreIfNearEnd]);

  const isEmpty = renderedTracks.length === 0;

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
        <p className="poster-wall__status" style={{ color: 'var(--theme-text-muted)' }}>
          {loading ? loadingLabel : emptyLabel}
        </p>
      ) : (
        <div className="poster-wall__canvas" style={{ height: layout.height }}>
          {visibleTiles.map(tile => {
            const track = renderedTracks[tile.index]!;
            return (
              <PosterTile
                key={`${renderKey}:${track.id}`}
                track={track}
                tile={tile}
                isCurrent={track.id === currentTrackId}
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
