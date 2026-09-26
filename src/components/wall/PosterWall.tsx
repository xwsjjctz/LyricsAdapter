import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '../../types';
import PosterTile from './PosterTile';
import { computeWallLayout } from './wallLayout';
import { useWallSourceTransition } from './useWallSourceTransition';

const WALL_GAP = 8;
/** Matches --wall-edge: padding on every side, equal to the gap so tiles read edge to edge. */
const WALL_EDGE = WALL_GAP;
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
  onLoadMore?: (() => void) | undefined;
  /** Space kept clear above the first row for floating chrome; tiles scroll under it. */
  topInset?: number;
  /** Space kept clear below the last row for the floating control bar. */
  bottomInset: number;
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
  hasMore = false, onLoadMore, topInset = 0, bottomInset, onTrackSelect, hasMenu, onOpenMenu,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollFrameRef = useRef<number | null>(null);
  const { renderKey, renderedTracks, isExiting } = useWallSourceTransition(sourceKey, tracks, containerRef);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      setWidth(Math.max(0, container.clientWidth - WALL_EDGE * 2));
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
    const top = scrollTop - topInset - overscan;
    const bottom = scrollTop - topInset + viewportHeight + overscan;
    return layout.tiles.filter(tile => tile.y + tile.height >= top && tile.y <= bottom);
  }, [layout.tiles, overscan, scrollTop, topInset, viewportHeight]);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const container = containerRef.current;
      if (!container) return;
      setScrollTop(container.scrollTop);
      const nearEnd = container.scrollTop + container.clientHeight >= topInset + layout.height - container.clientHeight;
      if (nearEnd && hasMore && !loading) onLoadMore?.();
    });
  }, [hasMore, layout.height, loading, onLoadMore, topInset]);

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
        <p className="poster-wall__status" style={{ color: 'var(--theme-text-muted)', marginTop: topInset }}>
          {loading ? loadingLabel : emptyLabel}
        </p>
      ) : (
        <div className="poster-wall__canvas" style={{ height: layout.height + bottomInset + WALL_GAP, marginTop: topInset }}>
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
