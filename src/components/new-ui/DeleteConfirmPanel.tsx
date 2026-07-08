import React, { useMemo, useState } from 'react';
import type { Track } from '../../types';

interface DeleteConfirmPanelProps {
  tracks: Track[];
  onCancel: () => void;
  onConfirm: (deleteFiles: boolean) => void;
}

const DeleteConfirmPanel: React.FC<DeleteConfirmPanelProps> = ({ tracks, onCancel, onConfirm }) => {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const canDeleteFiles = useMemo(() => tracks.some(track => Boolean(track.filePath)), [tracks]);
  const title = tracks.length > 1 ? `Delete ${tracks.length} Tracks` : 'Delete Track';
  const names = tracks.slice(0, 3).map(track => track.title).join(', ');
  const overflow = tracks.length > 3 ? ` and ${tracks.length - 3} more` : '';

  return (
    <aside className="new-ux-side-panel new-ux-side-panel--danger new-ux-panel-in">
      <header className="new-ux-side-panel__header">
        <div>
          <div className="new-ux-side-panel__eyebrow">Confirm</div>
          <h2 className="new-ux-side-panel__title">{title}</h2>
        </div>
        <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onCancel} aria-label="Close delete panel">
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>
      </header>
      <div className="new-ux-side-panel__body">
        <p className="new-ux-side-panel__copy">{names}{overflow}</p>
        {canDeleteFiles && (
          <label className="new-ux-check-row">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={event => setDeleteFiles(event.target.checked)}
            />
            <span>Also delete local audio files</span>
          </label>
        )}
      </div>
      <footer className="new-ux-side-panel__footer">
        <button type="button" className="new-ux-button-reset new-ux-text-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="new-ux-button-reset new-ux-text-button new-ux-text-button--danger" onClick={() => onConfirm(deleteFiles)}>
          Delete
        </button>
      </footer>
    </aside>
  );
};

export default DeleteConfirmPanel;
