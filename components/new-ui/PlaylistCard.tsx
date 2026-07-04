import React from 'react';
import { toCoverThumb } from '../../services/coverUrl';
import type { PlaylistEntry } from './types';

interface PlaylistCardProps {
  entry: PlaylistEntry;
  onOpen: (entry: PlaylistEntry) => void;
  onContextMenu: (entry: PlaylistEntry, event: React.MouseEvent) => void;
  cardRef?: (node: HTMLButtonElement | null) => void;
  style?: React.CSSProperties;
}

const PlaylistCard: React.FC<PlaylistCardProps> = ({ entry, onOpen, onContextMenu, cardRef, style }) => {
  const covers = entry.coverUrls.length > 0 ? entry.coverUrls : [undefined, undefined, undefined];
  const primaryCover = covers[0];

  return (
    <button
      type="button"
      className="new-ux-button-reset new-ux-playlist-card"
      ref={cardRef}
      style={style}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onClick={() => onOpen(entry)}
      onContextMenu={(event) => onContextMenu(entry, event)}
    >
      <div className="new-ux-playlist-card__stack" aria-hidden="true">
        {covers.slice(1, 3).map((coverUrl, index) => (
          <div className="new-ux-playlist-card__back-cover" key={`${entry.id}-back-${index}`}>
            {coverUrl ? <img src={toCoverThumb(coverUrl, 256)} alt="" draggable={false} /> : null}
          </div>
        ))}
        <div className="new-ux-playlist-card__main-cover">
          {primaryCover ? (
            <img src={toCoverThumb(primaryCover, 512)} alt="" draggable={false} />
          ) : (
            <span className="new-ux-playlist-card__icon material-symbols-outlined">{entry.icon}</span>
          )}
        </div>
      </div>
      <div className="new-ux-playlist-card__info">
        <div className="min-w-0">
          <div className="new-ux-playlist-card__title">{entry.title}</div>
          <div className="new-ux-playlist-card__meta">{entry.subtitle}</div>
        </div>
        <span className="new-ux-playlist-card__play material-symbols-outlined">play_arrow</span>
      </div>
    </button>
  );
};

export default PlaylistCard;
