import React, { useState, useCallback, useRef, useId } from 'react';
import { Track } from '../types';
import { logger } from '../services/logger';
import { getDesktopAPI } from '../services/desktopAdapter';
import { useTranslation } from 'react-i18next';
import { notify } from '../services/notificationService';
import TrackCover from './TrackCover';
import GsapModal from './GsapModal';
import Button from './ui/Button';
import { parseLRCLyrics } from '../services/metadataService';
import { parseCoverDataUrl, sanitizePersistedCoverUrl } from '../services/coverUrl';
import '../styles/metadataEditor.css';

type TextField = 'title' | 'artist' | 'album';
type EditableField = TextField | 'lyrics';

/** Any `[mm:ss]` line tag marks the text as time-synced LRC. */
const LRC_TIMESTAMP = /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/m;

interface MetadataEditorPopupProps {
  track: Track;
  isOpen: boolean;
  onUpdateTrack: (track: Track) => void;
  onClose: () => void;
  onExited: () => void;
}

const MetadataEditorPopup: React.FC<MetadataEditorPopupProps> = ({ track, isOpen, onUpdateTrack, onClose, onExited }) => {
  const [edited, setEdited] = useState<Track>({ ...track });
  const [saving, setSaving] = useState(false);
  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null);
  const [pendingCoverDataUrl, setPendingCoverDataUrl] = useState<string | null>(null);
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldIdPrefix = useId();

  const hasChanges =
    edited.title !== track.title ||
    edited.artist !== track.artist ||
    edited.album !== track.album ||
    edited.lyrics !== track.lyrics ||
    pendingCoverFile !== null;

  const fieldValue = useCallback((field: EditableField): string => {
    return edited[field] || '';
  }, [edited]);

  const updateField = useCallback((field: EditableField, value: string) => {
    setEdited(prev => (field === 'lyrics'
      ? { ...prev, lyrics: value, syncedLyrics: undefined }
      : { ...prev, [field]: value }));
  }, []);

  const handleCoverImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleCoverFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input so choosing the same image again still fires onChange.
    e.target.value = '';
    if (!file) return;
    setPendingCoverFile(file);
    const reader = new FileReader();
    reader.onload = () => setPendingCoverDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleSave = useCallback(async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const lyrics = edited.lyrics;
      const desktopAPI = getDesktopAPI();
      if (edited.filePath && desktopAPI?.writeAudioMetadata) {
        const coverUrl = pendingCoverDataUrl || edited.coverUrl;
        const result = await desktopAPI.writeAudioMetadata(edited.filePath, {
          title: edited.title || undefined,
          artist: edited.artist || undefined,
          album: edited.album || undefined,
          ...(lyrics != null ? { lyrics } : {}),
          ...(coverUrl != null ? { coverUrl } : {}),
        });
        if (!result.success) throw new Error(result.error || 'Write failed');
      }

      // 保存成功后重新解析歌词文本，重建 syncedLyrics。
      // 否则编辑歌词后 syncedLyrics 残留为 undefined，FocusMode 无法滚动。
      const nextSynced = lyrics != null ? parseLRCLyrics(lyrics).syncedLyrics : edited.syncedLyrics;
      let finalCoverUrl = sanitizePersistedCoverUrl(edited.coverUrl);

      if (pendingCoverDataUrl) {
        const parsedCover = parseCoverDataUrl(pendingCoverDataUrl);
        if (parsedCover && desktopAPI?.saveCoverThumbnail) {
          const coverResult = await desktopAPI.saveCoverThumbnail({
            id: edited.id,
            data: parsedCover.base64,
            mime: parsedCover.mime,
          });
          if (coverResult.success && coverResult.coverUrl) {
            finalCoverUrl = coverResult.coverUrl;
          } else {
            logger.warn('[MetadataEditor] Failed to save cover thumbnail:', coverResult.error);
          }
        } else {
          logger.warn('[MetadataEditor] Pending cover could not be cached');
        }
      }

      const finalTrack = {
        ...edited,
        syncedLyrics: nextSynced,
        coverUrl: finalCoverUrl,
      };
      onUpdateTrack(finalTrack);
      notify(t('notifications.saveSuccess'), t('notifications.metadataSaved'), { silent: true });
      onClose();
    } catch (err: any) {
      logger.error('[MetadataEditor] Save failed:', err);
      notify(t('notifications.saveFailed'), err.message || '');
    } finally {
      setSaving(false);
    }
  }, [hasChanges, edited, pendingCoverDataUrl, onUpdateTrack, onClose]);

  const fieldChanged = (field: EditableField): boolean => fieldValue(field) !== (track[field] || '');
  const fileLabel = track.fileName || track.filePath?.split(/[\\/]/).pop() || '';
  const hasTimedLyrics = LRC_TIMESTAMP.test(fieldValue('lyrics'));

  const renderLabel = (field: EditableField, labelKey: string, htmlFor: string, trailing?: React.ReactNode) => (
    <div className="metadata-editor__label-row">
      <label htmlFor={htmlFor} className="metadata-editor__label">{t(labelKey)}</label>
      {fieldChanged(field) && (
        <span className="metadata-editor__edited">
          <span className="metadata-editor__edited-dot" aria-hidden="true" />
          {t('metadataView.edited')}
        </span>
      )}
      {trailing}
    </div>
  );

  const renderInput = (field: TextField, labelKey: string) => {
    const id = `${fieldIdPrefix}-${field}`;
    return (
      <div className="metadata-editor__field" key={field}>
        {renderLabel(field, labelKey, id)}
        <input
          id={id}
          type="text"
          value={fieldValue(field)}
          onChange={e => updateField(field, e.target.value)}
          spellCheck={false}
          className="metadata-editor__input"
          data-edited={fieldChanged(field) || undefined}
        />
      </div>
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSave();
    }
  };

  const coverSource = pendingCoverDataUrl || edited.coverUrl;
  const lyricsId = `${fieldIdPrefix}-lyrics`;

  return (
    <GsapModal
      isOpen={isOpen}
      onExited={onExited}
      onDismiss={onClose}
      overlayClassName="metadata-editor-backdrop"
      panelClassName="metadata-editor"
    >
      <div className="metadata-editor__frame" onKeyDown={handleKeyDown}>
        <header className="metadata-editor__header">
          <div className="min-w-0">
            <h2 className="metadata-editor__title">{t('metadataView.title')}</h2>
            {fileLabel && <p className="metadata-editor__file">{fileLabel}</p>}
          </div>
          <button type="button" className="wall-float__button metadata-editor__close" onClick={onClose} aria-label={t('common.close')}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>

        <div className="metadata-editor__body no-scrollbar">
          <div className="metadata-editor__hero">
            <button
              type="button"
              className="metadata-editor__cover"
              onClick={handleCoverImport}
              aria-label={t('metadataView.importCover')}
              data-edited={pendingCoverFile !== null || undefined}
            >
              <TrackCover
                trackId={edited.id}
                filePath={edited.filePath}
                fallbackUrl={coverSource}
                className="metadata-editor__cover-image"
                thumbSize={320}
              />
              <span className="metadata-editor__cover-overlay" aria-hidden="true">
                <span className="material-symbols-outlined">add_photo_alternate</span>
                <span>{t('metadataView.importCover')}</span>
              </span>
            </button>
            <div className="metadata-editor__fields">
              {renderInput('title', 'metadataView.fieldTitle')}
              {renderInput('artist', 'metadataView.fieldArtist')}
              {renderInput('album', 'metadataView.fieldAlbum')}
            </div>
          </div>

          <div className="metadata-editor__field metadata-editor__field--lyrics">
            {renderLabel('lyrics', 'metadataView.fieldLyrics', lyricsId,
              hasTimedLyrics ? <span className="metadata-editor__badge">LRC</span> : null)}
            <textarea
              id={lyricsId}
              value={fieldValue('lyrics')}
              onChange={e => updateField('lyrics', e.target.value)}
              placeholder={t('metadataView.lyricsPlaceholder')}
              spellCheck={false}
              className="metadata-editor__input metadata-editor__lyrics no-scrollbar"
              data-edited={fieldChanged('lyrics') || undefined}
            />
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverFileChange} />
        </div>

        <footer className="metadata-editor__footer">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={handleSave} disabled={!hasChanges || saving}>
            {saving ? t('metadataView.saving') : t('common.save')}
          </Button>
        </footer>
      </div>
    </GsapModal>
  );
};

export default MetadataEditorPopup;
