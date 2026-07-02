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
  onReloadUnavailable: () => void;
  onOpenSettings: () => void;
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
  onReloadUnavailable,
  onOpenSettings,
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
  const hasUnavailableTracks = entry.tracks.some(track => track.available === false);
  const isCloud = entry.id === 'cloud';
  const isOnline = entry.id === 'online';

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
      {entry.id === 'local' && (
        <button
          type="button"
          className="new-ux-button-reset new-ux-context-menu__item"
          onClick={runAction(onReloadUnavailable)}
          disabled={!hasUnavailableTracks}
          title={hasUnavailableTracks ? undefined : '当前没有不可用歌曲'}
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
            title="后续接入云端刷新流程"
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
          title="在线播放历史管理后续接入"
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
