import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toCoverThumb } from '../../services/coverUrl';
import type { Track } from '../../types';

interface PlaylistPanelProps {
  /** Panel title (the opened card's title). */
  title: string;
  /** Tracks displayed in this panel. Provided by the caller from the slot. */
  tracks: Track[];
  /** Total tracks reported by the provider; does not change as pages append. */
  totalTrackCount?: number;
  currentTrackId?: string;
  isEditMode: boolean;
  selectedTrackIds: Set<string>;
  locateTrackId?: string;
  locateToken: number;
  onClose: () => void;
  onTrackSelect: (index: number) => void;
  onTrackContextMenu: (track: Track, index: number, event: React.MouseEvent) => void;
  onToggleTrackSelected: (trackId: string) => void;
  onSelectAll: (trackIds: string[]) => void;
  onExitEditMode: () => void;
  onDeleteSelected: () => void;
  onCurrentTrackVisibilityChange: (visible: boolean) => void;
  onLoadMore?: () => void | Promise<void>;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  loadError?: string | null;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const TrackRow: React.FC<{
  track: Track;
  index: number;
  active: boolean;
  isEditMode: boolean;
  selected: boolean;
  onTrackSelect: (index: number) => void;
  onTrackContextMenu: (track: Track, index: number, event: React.MouseEvent) => void;
  onToggleTrackSelected: (trackId: string) => void;
  rowRef: (node: HTMLButtonElement | null) => void;
}> = ({ track, index, active, isEditMode, selected, onTrackSelect, onTrackContextMenu, onToggleTrackSelected, rowRef }) => (
  <button
    type="button"
    ref={rowRef}
    className={`new-ux-button-reset new-ux-track-row ${active ? 'new-ux-track-row--active' : ''} ${isEditMode ? 'new-ux-track-row--editing' : ''} ${selected ? 'new-ux-track-row--selected' : ''}`}
    onClick={() => {
      if (isEditMode) {
        onToggleTrackSelected(track.id);
        return;
      }
      onTrackSelect(index);
    }}
    onContextMenu={event => onTrackContextMenu(track, index, event)}
  >
    {isEditMode && (
      <span className={`new-ux-track-row__check${selected ? ' new-ux-track-row__check--selected' : ''}`}>
        <span className="material-symbols-outlined text-[16px]">{selected ? 'check' : ''}</span>
      </span>
    )}
    <div className="new-ux-track-row__cover">
      {track.coverUrl ? (
        <img
          src={toCoverThumb(track.coverUrl, 128)}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="material-symbols-outlined flex size-full items-center justify-center text-[22px]">music_note</span>
      )}
    </div>
    <div className="min-w-0">
      <div className="new-ux-track-row__title">{track.title}</div>
      <div className="new-ux-track-row__artist">{track.artist} · {track.album}</div>
    </div>
    <div className="text-xs tabular-nums" style={{ color: 'var(--theme-text-muted)' }}>
      {formatDuration(track.duration)}
    </div>
  </button>
);

type SortMode = 'default' | 'title' | 'artist' | 'album' | 'duration';

const SORT_CYCLE: SortMode[] = ['default', 'title', 'artist', 'album', 'duration'];
const SORT_LABELS: Record<SortMode, string> = {
  default: 'Default',
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  duration: 'Duration',
};

const PlaylistPanel: React.FC<PlaylistPanelProps> = ({
  title,
  tracks,
  totalTrackCount,
  currentTrackId,
  isEditMode,
  selectedTrackIds,
  locateTrackId,
  locateToken,
  onClose,
  onTrackSelect,
  onTrackContextMenu,
  onToggleTrackSelected,
  onSelectAll,
  onExitEditMode,
  onDeleteSelected,
  onCurrentTrackVisibilityChange,
  onLoadMore,
  isLoadingMore = false,
  hasMore = false,
  loadError = null,
}) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const trackRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [sortMode, setSortMode] = useState<SortMode>('default');

  const cycleSortMode = useCallback(() => {
    setSortMode(prev => {
      const nextIndex = (SORT_CYCLE.indexOf(prev) + 1) % SORT_CYCLE.length;
      return SORT_CYCLE[nextIndex] ?? 'default';
    });
  }, []);

  const handleListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (!onLoadMore || !hasMore || isLoadingMore) return;
    const list = event.currentTarget;
    const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (distanceToBottom < 240) void onLoadMore();
  }, [hasMore, isLoadingMore, onLoadMore]);

  // If a short first page does not create a scrollbar, keep requesting pages
  // until the panel can scroll or the provider reports the end.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !onLoadMore || !hasMore || isLoadingMore) return;
    if (list.scrollHeight <= list.clientHeight + 240) void onLoadMore();
  }, [hasMore, isLoadingMore, onLoadMore, tracks.length]);

  const visibleTracks = useMemo(() => {
    const rows = tracks.map((track, index) => ({ track, index }));

    if (sortMode === 'default') return rows;

    return rows.sort((a, b) => {
      if (sortMode === 'duration') return a.track.duration - b.track.duration;
      return (a.track[sortMode] || '').localeCompare(b.track[sortMode] || '');
    });
  }, [tracks, sortMode]);

  const visibleTrackIds = useMemo(() => visibleTracks.map(({ track }) => track.id), [visibleTracks]);
  const registerTrack = useCallback((trackId: string) => (node: HTMLButtonElement | null) => {
    trackRefs.current[trackId] = node;
  }, []);

  useEffect(() => {
    const list = listRef.current;
    const trackId = currentTrackId;
    if (!list || !trackId) {
      onCurrentTrackVisibilityChange(false);
      return;
    }

    const node = trackRefs.current[trackId];
    if (!node) {
      onCurrentTrackVisibilityChange(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => onCurrentTrackVisibilityChange(Boolean(entry?.isIntersecting)),
      {
        root: list,
        threshold: 0.72,
      }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [currentTrackId, onCurrentTrackVisibilityChange, visibleTracks]);

  useEffect(() => {
    if (!locateTrackId || locateToken <= 0) return;

    setSortMode('default');

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const node = trackRefs.current[locateTrackId];
        const list = listRef.current;
        if (!node || !list) return;
        // Scroll only within the panel's own list container — never bubble to ancestors.
        const nodeRect = node.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const offset = nodeRect.top - listRect.top - (listRect.height / 2 - nodeRect.height / 2);
        list.scrollTo({ top: list.scrollTop + offset, behavior: 'smooth' });
      });
    });
  }, [locateToken, locateTrackId]);

  return (
    <aside className="new-ux-playlist-panel new-ux-panel-in">
      <header className="new-ux-playlist-panel__header">
        <div className="min-w-0">
          <div className="new-ux-playlist-panel__title">{title}</div>
          <div className="new-ux-playlist-panel__meta">
            {isEditMode ? `${selectedTrackIds.size} selected` : `${totalTrackCount ?? tracks.length} tracks`}
          </div>
        </div>
        <div className="new-ux-playlist-panel__actions">
          {isEditMode && (
            <>
              <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={() => onSelectAll(visibleTrackIds)} aria-label="Select visible tracks">
                <span className="material-symbols-outlined text-[22px]">select_all</span>
              </button>
              <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onDeleteSelected} aria-label="Delete selected tracks" disabled={selectedTrackIds.size === 0}>
                <span className="material-symbols-outlined text-[22px]">delete</span>
              </button>
              <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onExitEditMode} aria-label="Exit edit mode">
                <span className="material-symbols-outlined text-[22px]">arrow_back</span>
              </button>
            </>
          )}
          <button
            type="button"
            className="new-ux-button-reset new-ux-playlist-panel__sort"
            onClick={cycleSortMode}
          >
            <span className="material-symbols-outlined text-[20px]">sort</span>
            <span className="new-ux-playlist-panel__sort-label">{SORT_LABELS[sortMode]}</span>
          </button>
          <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onClose} aria-label="Close playlist">
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>
      </header>
      <div ref={listRef} className="new-ux-track-list new-ux-scrollbar" onScroll={handleListScroll}>
        {visibleTracks.length > 0 ? (
          <>
            {visibleTracks.map(({ track, index }) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                active={track.id === currentTrackId}
                isEditMode={isEditMode}
                selected={selectedTrackIds.has(track.id)}
                onTrackSelect={onTrackSelect}
                onTrackContextMenu={onTrackContextMenu}
                onToggleTrackSelected={onToggleTrackSelected}
                rowRef={registerTrack(track.id)}
              />
            ))}
            {onLoadMore && loadError && (
              <div className="px-4 py-3 text-center text-xs text-red-300">
                {loadError}
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--theme-text-muted)' }}>
            No tracks in this playlist yet.
          </div>
        )}
      </div>
    </aside>
  );
};

export default PlaylistPanel;
