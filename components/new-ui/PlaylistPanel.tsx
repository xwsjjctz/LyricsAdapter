import React from 'react';
import { toCoverThumb } from '../../services/coverUrl';
import type { Track } from '../../types';
import type { PlaylistEntry } from './types';

interface PlaylistPanelProps {
  entry: PlaylistEntry;
  currentTrackId?: string;
  onClose: () => void;
  onTrackSelect: (index: number) => void;
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
  onTrackSelect: (index: number) => void;
}> = ({ track, index, active, onTrackSelect }) => (
  <button
    type="button"
    className={`new-ux-button-reset new-ux-track-row ${active ? 'new-ux-track-row--active' : ''}`}
    onClick={() => onTrackSelect(index)}
  >
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

const PlaylistPanel: React.FC<PlaylistPanelProps> = ({ entry, currentTrackId, onClose, onTrackSelect }) => {
  return (
    <aside className="new-ux-playlist-panel new-ux-panel-in">
      <header className="new-ux-playlist-panel__header">
        <div className="min-w-0">
          <div className="new-ux-playlist-panel__title">{entry.title}</div>
          <div className="new-ux-playlist-panel__meta">{entry.count} tracks</div>
        </div>
        <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onClose} aria-label="Close playlist">
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>
      </header>
      <div className="new-ux-track-list new-ux-scrollbar">
        {entry.tracks.length > 0 ? (
          entry.tracks.map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              index={index}
              active={track.id === currentTrackId}
              onTrackSelect={onTrackSelect}
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
