import React, { useCallback, useEffect, useState } from 'react';
import { toCoverThumb } from '../../services/coverUrl';
import { i18n } from '../../services/i18n';
import { logger } from '../../services/logger';
import { parseLRCLyrics } from '../../services/metadataService';
import { notify } from '../../services/notificationService';
import type { Track } from '../../types';

interface MetadataEditPanelProps {
  track: Track;
  onClose: () => void;
  onSave: (track: Track) => void;
}

const MetadataEditPanel: React.FC<MetadataEditPanelProps> = ({ track, onClose, onSave }) => {
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => ({
    title: track.title,
    artist: track.artist,
    album: track.album,
    lyrics: track.lyrics ?? '',
  }));

  useEffect(() => {
    setDraft({
      title: track.title,
      artist: track.artist,
      album: track.album,
      lyrics: track.lyrics ?? '',
    });
  }, [track]);

  const updateField = useCallback((field: keyof typeof draft, value: string) => {
    setDraft(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const parsedLyrics = parseLRCLyrics(draft.lyrics);
    const finalTrack = {
      ...track,
      title: draft.title.trim() || track.title,
      artist: draft.artist.trim(),
      album: draft.album.trim(),
      lyrics: draft.lyrics,
      syncedLyrics: parsedLyrics.syncedLyrics,
    };

    try {
      if (finalTrack.filePath && window.electron?.writeAudioMetadata) {
        const result = await window.electron.writeAudioMetadata(finalTrack.filePath, {
          title: finalTrack.title || undefined,
          artist: finalTrack.artist || undefined,
          album: finalTrack.album || undefined,
          lyrics: finalTrack.lyrics || undefined,
        });
        if (!result.success) throw new Error(result.error || 'Write failed');
      }
      onSave(finalTrack);
      notify(i18n.t('notifications.saveSuccess'), i18n.t('notifications.metadataSaved'), { silent: true });
    } catch (error) {
      logger.error('[NewUxMetadataEditPanel] Save failed:', error);
      notify(i18n.t('notifications.saveFailed'), error instanceof Error ? error.message : '');
    } finally {
      setSaving(false);
    }
  }, [draft, onSave, track]);

  return (
    <aside className="new-ux-side-panel new-ux-panel-in">
      <header className="new-ux-side-panel__header">
        <div>
          <div className="new-ux-side-panel__eyebrow">Metadata</div>
          <h2 className="new-ux-side-panel__title">Edit Track</h2>
        </div>
        <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onClose} aria-label="Close metadata panel">
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>
      </header>
      <div className="new-ux-side-panel__body">
        <div className="new-ux-metadata-card">
          <div className="new-ux-metadata-card__cover">
            {track.coverUrl ? <img src={toCoverThumb(track.coverUrl, 256)} alt="" /> : <span className="material-symbols-outlined">music_note</span>}
          </div>
          <div className="min-w-0">
            <div className="new-ux-metadata-card__title">{track.title}</div>
            <div className="new-ux-metadata-card__meta">{track.artist || 'Unknown Artist'}</div>
          </div>
        </div>
        <label className="new-ux-field">
          <span>Title</span>
          <input value={draft.title} onChange={event => updateField('title', event.target.value)} />
        </label>
        <label className="new-ux-field">
          <span>Artist</span>
          <input value={draft.artist} onChange={event => updateField('artist', event.target.value)} />
        </label>
        <label className="new-ux-field">
          <span>Album</span>
          <input value={draft.album} onChange={event => updateField('album', event.target.value)} />
        </label>
        <label className="new-ux-field new-ux-field--lyrics">
          <span>Lyrics</span>
          <textarea value={draft.lyrics} onChange={event => updateField('lyrics', event.target.value)} />
        </label>
      </div>
      <footer className="new-ux-side-panel__footer">
        <button type="button" className="new-ux-button-reset new-ux-text-button" onClick={onClose}>Cancel</button>
        <button type="button" className="new-ux-button-reset new-ux-text-button new-ux-text-button--primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving' : 'Save'}
        </button>
      </footer>
    </aside>
  );
};

export default MetadataEditPanel;
