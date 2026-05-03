import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Track } from '../types';
import { logger } from '../services/logger';
import { i18n } from '../services/i18n';
import { notify } from '../services/notificationService';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';
import TrackCover from './TrackCover';

interface MetadataEditorPopupProps {
  track: Track;
  onUpdateTrack: (track: Track) => void;
  onClose: () => void;
}

const MetadataEditorPopup: React.FC<MetadataEditorPopupProps> = ({ track, onUpdateTrack, onClose }) => {
  const [edited, setEdited] = useState<Track>({ ...track });
  const [saving, setSaving] = useState(false);
  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null);
  const [pendingCoverDataUrl, setPendingCoverDataUrl] = useState<string | null>(null);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  const [, setLangVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u1 = themeManager.subscribe(() => setCurrentTheme(themeManager.getCurrentTheme()));
    const u2 = i18n.subscribe(() => setLangVersion(v => v + 1));
    return () => { u1(); u2(); };
  }, []);

  const colors = currentTheme.colors;

  const hasChanges =
    edited.title !== track.title ||
    edited.artist !== track.artist ||
    edited.album !== track.album ||
    edited.lyrics !== track.lyrics ||
    pendingCoverFile !== null;

  const fieldValue = useCallback((field: 'title' | 'artist' | 'album' | 'lyrics'): string => {
    return (edited[field] as string) || '';
  }, [edited]);

  const updateField = useCallback((field: 'title' | 'artist' | 'album' | 'lyrics', value: string) => {
    setEdited(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'lyrics') (next as any).syncedLyrics = undefined;
      return next;
    });
  }, []);

  const handleCoverImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleCoverFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
      if (edited.filePath && window.electron?.writeAudioMetadata) {
        const lyrics = edited.lyrics;
        const coverUrl = pendingCoverDataUrl || edited.coverUrl;
        const result = await window.electron.writeAudioMetadata(edited.filePath, {
          title: edited.title || undefined,
          artist: edited.artist || undefined,
          album: edited.album || undefined,
          ...(lyrics != null ? { lyrics } : {}),
          ...(coverUrl != null ? { coverUrl } : {}),
        });
        if (!result.success) throw new Error(result.error || 'Write failed');
      }

      const finalTrack = {
        ...edited,
        coverUrl: pendingCoverDataUrl || edited.coverUrl,
      };
      onUpdateTrack(finalTrack);
      notify(i18n.t('notifications.saveSuccess'), i18n.t('notifications.metadataSaved'), { silent: true });
      onClose();
    } catch (err: any) {
      logger.error('[MetadataEditor] Save failed:', err);
      notify(i18n.t('notifications.saveFailed'), err.message || '');
    } finally {
      setSaving(false);
    }
  }, [hasChanges, edited, pendingCoverDataUrl, onUpdateTrack, onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const renderInput = (label: string, field: 'title' | 'artist' | 'album') => (
    <div className="flex items-center gap-4" key={field}>
      <span className="text-sm font-bold uppercase tracking-widest w-16 flex-shrink-0" style={{ color: colors.textMuted }}>{label}:</span>
      <div className="relative flex-1">
        <input
          type="text"
          value={fieldValue(field)}
          onChange={e => updateField(field, e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-all"
          style={{
            backgroundColor: colors.backgroundCard,
            border: `1px solid ${fieldValue(field) !== ((track as any)[field] || '') ? colors.primary : colors.borderLight}`,
            color: colors.textPrimary,
          }}
        />
      </div>
    </div>
  );

  const lyricsValue = fieldValue('lyrics');
  const lyricsChanged = lyricsValue !== (track.lyrics || '');

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="rounded-2xl shadow-2xl w-[520px] max-h-[85vh] flex flex-col overflow-hidden"
        style={{ backgroundColor: colors.backgroundDark, border: `1px solid ${colors.borderLight}` }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: `1px solid ${colors.borderLight}` }}>
          <h2 className="text-lg font-bold" style={{ color: colors.textPrimary }}>{i18n.t('metadataView.title')}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
            style={{ color: colors.textMuted }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textPrimary; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.textMuted; }}>
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-5 flex flex-col gap-4">
          {/* Cover + basic fields */}
          <div className="flex gap-5 flex-shrink-0">
            <div className="relative group flex-shrink-0">
              <TrackCover
                trackId={edited.id}
                filePath={edited.filePath}
                fallbackUrl={pendingCoverDataUrl || edited.coverUrl}
                className="w-32 h-32 rounded-2xl object-cover shadow-xl"
              />
              <button onClick={handleCoverImport}
                className="absolute bottom-2 right-2 px-2 py-1 rounded-lg bg-black/60 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
                <span className="material-symbols-outlined text-sm" style={{ color: colors.textPrimary }}>add_photo_alternate</span>
                <span className="text-xs" style={{ color: colors.textPrimary }}>{i18n.t('metadataView.importCover')}</span>
              </button>
            </div>
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              {renderInput('TITLE', 'title')}
              {renderInput('ARTIST', 'artist')}
              {renderInput('ALBUM', 'album')}
            </div>
          </div>

          {/* Lyrics */}
          <div className="flex-1 flex flex-col min-h-0">
            <span className="text-sm font-bold uppercase tracking-widest mb-2 flex-shrink-0" style={{ color: colors.textMuted }}>LYRICS:</span>
            <div className="flex-1 relative min-h-[160px]">
              <textarea
                value={lyricsValue}
                onChange={e => updateField('lyrics', e.target.value)}
                className="absolute inset-0 w-full rounded-lg p-3 text-sm focus:outline-none transition-all resize-none"
                style={{
                  backgroundColor: colors.backgroundCard,
                  border: `1px solid ${lyricsChanged ? colors.primary : colors.borderLight}`,
                  color: colors.textPrimary,
                }}
              />
            </div>
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverFileChange} />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 flex-shrink-0" style={{ borderTop: `1px solid ${colors.borderLight}` }}>
          <button onClick={onClose}
            className="px-5 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ color: colors.textSecondary }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
            {i18n.t('common.cancel')}
          </button>
          <button onClick={handleSave} disabled={!hasChanges || saving}
            className="px-5 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              backgroundColor: hasChanges ? colors.primary : colors.backgroundCard,
              color: hasChanges ? '#fff' : colors.textMuted,
              opacity: saving ? 0.6 : 1,
              cursor: hasChanges ? 'pointer' : 'default',
            }}>
            {saving ? '...' : i18n.t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MetadataEditorPopup;
