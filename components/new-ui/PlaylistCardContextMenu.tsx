import React, { useEffect } from 'react';
import type { SlotId } from '../../types';
import { i18n } from '../../services/i18n';
import type { PlaylistEntry } from './types';

interface PlaylistCardContextMenuProps {
  entry: PlaylistEntry;
  x: number;
  y: number;
  cloudImportDisabled: boolean;
  cloudImportDisabledReason?: string;
  onOpen: (entry: PlaylistEntry) => void;
  onImport: (slotId: SlotId) => void;
  onClose: () => void;
}

const PlaylistCardContextMenu: React.FC<PlaylistCardContextMenuProps> = ({
  entry,
  x,
  y,
  cloudImportDisabled,
  cloudImportDisabledReason,
  onOpen,
  onImport,
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

  const canImport = entry.id === 'local' || entry.id === 'cloud';
  const importDisabled = entry.id === 'cloud' && cloudImportDisabled;

  const runAction = (action: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    action();
    onClose();
  };

  return (
    <div
      className="new-ux-context-menu"
      style={{ left: x, top: y }}
      onPointerDown={event => event.stopPropagation()}
    >
      <button type="button" className="new-ux-button-reset new-ux-context-menu__item" onClick={runAction(() => onOpen(entry))}>
        <span className="material-symbols-outlined text-[18px]">open_in_new</span>
        <span>{i18n.t('common.open')}</span>
      </button>
      {canImport && (
        <button
          type="button"
          className="new-ux-button-reset new-ux-context-menu__item"
          onClick={runAction(() => onImport(entry.id))}
          disabled={importDisabled}
          title={importDisabled ? cloudImportDisabledReason : undefined}
        >
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          <span>{i18n.t('sidebar.importFiles')}</span>
        </button>
      )}
    </div>
  );
};

export default PlaylistCardContextMenu;
