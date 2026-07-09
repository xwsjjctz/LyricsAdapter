import React, { useEffect } from 'react';
import type { SlotId } from '../../types';
import { useTranslation } from 'react-i18next';
import type { CardEntry } from './types';
import type { LibrarySlotsById } from './types';

interface PlaylistCardContextMenuProps {
  entry: CardEntry;
  /** Slot tracks, used to detect unavailable/local-only menu actions. Only the
   *  slot this card points at is read, but passing the full map keeps the caller
   *  symmetric with the rest of the new-UI data flow. */
  slots: LibrarySlotsById;
  x: number;
  y: number;
  cloudImportDisabled: boolean;
  cloudImportDisabledReason?: string;
  onOpen: (entry: CardEntry) => void;
  onImport: (slotId: SlotId) => void;
  onReloadUnavailable: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

const PlaylistCardContextMenu: React.FC<PlaylistCardContextMenuProps> = ({
  entry,
  slots,
  x,
  y,
  cloudImportDisabled,
  onOpen,
  onImport,
  onReloadUnavailable,
  onOpenSettings,
  onClose,
}) => {
  const { t } = useTranslation();
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

  // Menu actions only apply to slot-backed cards. Overlay / online-playlist
  // cards fall through to a plain "open" + caption.
  const slotId: SlotId | null = entry.kind === 'slot' ? entry.slotId : null;
  const slotTracks = slotId ? slots[slotId].tracks : [];
  const canImport = slotId === 'local' || slotId === 'cloud';
  const importDisabled = slotId === 'cloud' && cloudImportDisabled;
  const hasUnavailableTracks = slotTracks.some(track => track.available === false);
  const isCloud = slotId === 'cloud';
  const isOnline = slotId === 'online';

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
        <span>{t('common.open')}</span>
      </button>
      {canImport && slotId && (
        <button
          type="button"
          className="new-ux-button-reset new-ux-context-menu__item"
          onClick={runAction(() => onImport(slotId))}
          disabled={importDisabled}
        >
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          <span>{t('sidebar.importFiles')}</span>
        </button>
      )}
      {slotId === 'local' && (
        <button
          type="button"
          className="new-ux-button-reset new-ux-context-menu__item"
          onClick={runAction(onReloadUnavailable)}
          disabled={!hasUnavailableTracks}
        >
          <span className="material-symbols-outlined text-[18px]">sync_problem</span>
          <span>重新加载不可用歌曲</span>
        </button>
      )}
      {isCloud && (
        <>
          <button
            type="button"
            className="new-ux-button-reset new-ux-context-menu__item"
            disabled
          >
            <span className="material-symbols-outlined text-[18px]">sync</span>
            <span>刷新云端歌曲</span>
          </button>
          <button
            type="button"
            className="new-ux-button-reset new-ux-context-menu__item"
            onClick={runAction(onOpenSettings)}
          >
            <span className="material-symbols-outlined text-[18px]">settings</span>
            <span>WebDAV 设置</span>
          </button>
        </>
      )}
      {isOnline && (
        <button
          type="button"
          className="new-ux-button-reset new-ux-context-menu__item"
          disabled
        >
          <span className="material-symbols-outlined text-[18px]">playlist_remove</span>
          <span>清空在线播放历史</span>
        </button>
      )}
      <div className="new-ux-context-menu__caption">{entry.subtitle}</div>
    </div>
  );
};

export default PlaylistCardContextMenu;
