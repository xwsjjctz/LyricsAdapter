import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toCoverThumb } from '../../services/coverUrl';
import type { Track } from '../../types';
import type { PlaylistEntry } from './types';

interface PlaylistPanelProps {
  entry: PlaylistEntry;
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
        <img src={toCoverThumb(track.coverUrl, 128)} alt="" />
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

const PlaylistPanel: React.FC<PlaylistPanelProps> = ({
  entry,
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
}) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const trackRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('default');

  const visibleTracks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const rows = entry.tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => {
        if (!normalizedQuery) return true;
        return [track.title, track.artist, track.album]
          .filter(Boolean)
          .some(value => value.toLowerCase().includes(normalizedQuery));
      });

    if (sortMode === 'default') return rows;

    return rows.sort((a, b) => {
      if (sortMode === 'duration') return a.track.duration - b.track.duration;
      return (a.track[sortMode] || '').localeCompare(b.track[sortMode] || '');
    });
  }, [entry.tracks, query, sortMode]);

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

    setQuery('');
    setSortMode('default');

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        trackRefs.current[locateTrackId]?.scrollIntoView({
          block: 'center',
          behavior: 'smooth',
        });
      });
    });
  }, [locateToken, locateTrackId]);

  return (
    <aside className="new-ux-playlist-panel new-ux-panel-in">
      <header className="new-ux-playlist-panel__header">
        <div className="min-w-0">
          <div className="new-ux-playlist-panel__title">{entry.title}</div>
          <div className="new-ux-playlist-panel__meta">
            {isEditMode ? `${selectedTrackIds.size} selected` : `${entry.count} tracks`}
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
          <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onClose} aria-label="Close playlist">
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>
      </header>
      <div className="new-ux-playlist-panel__tools">
        <label className="new-ux-search-field">
          <span className="material-symbols-outlined text-[18px]">search</span>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" />
        </label>
        <label className="new-ux-select-field">
          <span className="material-symbols-outlined text-[18px]">sort</span>
          <select value={sortMode} onChange={event => setSortMode(event.target.value as SortMode)}>
            <option value="default">Default</option>
            <option value="title">Title</option>
            <option value="artist">Artist</option>
            <option value="album">Album</option>
            <option value="duration">Duration</option>
          </select>
        </label>
      </div>
      <div ref={listRef} className="new-ux-track-list new-ux-scrollbar">
        {visibleTracks.length > 0 ? (
          visibleTracks.map(({ track, index }) => (
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
          ))
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
