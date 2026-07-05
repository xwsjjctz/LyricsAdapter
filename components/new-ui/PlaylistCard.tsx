import React, { useState } from 'react';
import { toCoverThumb } from '../../services/coverUrl';
import type { CardEntry } from './types';

interface PlaylistCardProps {
  entry: CardEntry;
  onOpen: (entry: CardEntry) => void;
  onContextMenu: (entry: CardEntry, event: React.MouseEvent) => void;
  cardRef?: (node: HTMLButtonElement | null) => void;
  style?: React.CSSProperties;
  isCardEditMode?: boolean;
  overrideCover?: string;
  overrideName?: string;
  onToggleHidden?: () => void;
  onChangeCover?: () => void;
  onChangeName?: (name: string) => void;
}

const PlaylistCard: React.FC<PlaylistCardProps> = ({
  entry, onOpen, onContextMenu, cardRef, style,
  isCardEditMode, overrideCover, overrideName,
  onToggleHidden, onChangeCover, onChangeName,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');

  const covers = entry.coverUrls.length > 0 ? entry.coverUrls : [undefined, undefined, undefined];
  const primaryCover = overrideCover ?? covers[0];
  const displayName = overrideName ?? entry.title;

  const handleStartEditName = () => {
    setNameValue(overrideName ?? entry.title);
    setIsEditingName(true);
  };

  const handleSaveName = () => {
    setIsEditingName(false);
    const trimmed = nameValue.trim();
    onChangeName?.(trimmed !== entry.title ? trimmed : '');
  };

  return (
    <button
      type="button"
      className="new-ux-button-reset new-ux-playlist-card"
      ref={cardRef}
      style={style}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onClick={() => !isCardEditMode && onOpen(entry)}
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
          {/* Edit mode overlay */}
          {isCardEditMode && (
            <div className="new-ux-edit-overlay">
              <div className="new-ux-edit-overlay__actions">
                <button
                  className="new-ux-edit-overlay__btn"
                  onClick={(e) => { e.stopPropagation(); onChangeCover?.(); }}
                  title="更换封面"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>image</span>
                </button>
                <button
                  className="new-ux-edit-overlay__btn"
                  onClick={(e) => { e.stopPropagation(); handleStartEditName(); }}
                  title="编辑名称"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>drive_file_rename_outline</span>
                </button>
                <button
                  className="new-ux-edit-overlay__btn"
                  onClick={(e) => { e.stopPropagation(); onToggleHidden?.(); }}
                  title="隐藏"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    visibility_off
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className={`new-ux-playlist-card__info${entry.kind === 'overlay' ? ' new-ux-playlist-card__info--no-play' : ''}`}>
        <div className="min-w-0">
          {isEditingName ? (
            <input
              className="new-ux-playlist-card__title w-full bg-transparent outline-none"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.3)', color: '#fff' }}
              value={nameValue}
              autoFocus
              onChange={e => setNameValue(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setIsEditingName(false); }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <div className="new-ux-playlist-card__title">{displayName}</div>
          )}
          <div className="new-ux-playlist-card__meta">{entry.subtitle}</div>
        </div>
        {entry.kind !== 'overlay' && !isCardEditMode && (
          <span className="new-ux-playlist-card__play material-symbols-outlined">play_arrow</span>
        )}
      </div>
    </button>
  );
};

export default PlaylistCard;
