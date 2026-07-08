import React, { useEffect } from 'react';
import type { Track } from '../../types';

interface TrackContextMenuProps {
  track: Track;
  x: number;
  y: number;
  isEditMode: boolean;
  selectedCount: number;
  onPlay: () => void;
  onEditMetadata: () => void;
  onDelete: () => void;
  onEnterEditMode: () => void;
  onExitEditMode: () => void;
  onClose: () => void;
}

const TrackContextMenu: React.FC<TrackContextMenuProps> = ({
  track,
  x,
  y,
  isEditMode,
  selectedCount,
  onPlay,
  onEditMetadata,
  onDelete,
  onEnterEditMode,
  onExitEditMode,
  onClose,
}) => {
  useEffect(() => {
    const handlePointerDown = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const runAction = (action: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    action();
    onClose();
  };

  const deleteLabel = selectedCount > 1 ? `Delete ${selectedCount} Tracks` : 'Delete';

  return (
    <div
      className="new-ux-context-menu"
      style={{ left: x, top: y }}
      onPointerDown={event => event.stopPropagation()}
    >
      {isEditMode ? (
        <>
          <button type="button" className="new-ux-button-reset new-ux-context-menu__item" onClick={runAction(onExitEditMode)}>
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            <span>Return</span>
          </button>
          <button type="button" className="new-ux-button-reset new-ux-context-menu__item new-ux-context-menu__item--danger" onClick={runAction(onDelete)}>
            <span className="material-symbols-outlined text-[18px]">delete</span>
            <span>{deleteLabel}</span>
          </button>
        </>
      ) : (
        <>
          <button type="button" className="new-ux-button-reset new-ux-context-menu__item" onClick={runAction(onPlay)}>
            <span className="material-symbols-outlined text-[18px]">play_arrow</span>
            <span>Play</span>
          </button>
          <button type="button" className="new-ux-button-reset new-ux-context-menu__item" onClick={runAction(onEditMetadata)}>
            <span className="material-symbols-outlined text-[18px]">edit</span>
            <span>Edit Metadata</span>
          </button>
          <button type="button" className="new-ux-button-reset new-ux-context-menu__item" onClick={runAction(onEnterEditMode)}>
            <span className="material-symbols-outlined text-[18px]">checklist</span>
            <span>Select</span>
          </button>
          <button type="button" className="new-ux-button-reset new-ux-context-menu__item new-ux-context-menu__item--danger" onClick={runAction(onDelete)}>
            <span className="material-symbols-outlined text-[18px]">delete</span>
            <span>Delete</span>
          </button>
        </>
      )}
      <div className="new-ux-context-menu__caption">{track.title}</div>
    </div>
  );
};

export default TrackContextMenu;
