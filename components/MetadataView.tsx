import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle, useMemo } from 'react';
import { Track } from '../types';
import { logger } from '../services/logger';
import { i18n } from '../services/i18n';
import { notify } from '../services/notificationService';
import { getDesktopAPIAsync } from '../services/desktopAdapter';
import { parseAudioFile, parseLRCLyrics } from '../services/metadataService';
import { coverArtService } from '../services/coverArtService';
import TrackCover from './TrackCover';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';

interface MetadataViewProps {
  libraryTracks: Track[];
  onImportFromLibrary: (trackIds: string[]) => void;
  onUpdateTrack?: (track: Track) => void;
}

export interface MetadataViewHandle {
  readonly hasUnsavedChanges: boolean;
  saveAll: () => Promise<void>;
  stashAll: () => void;
  cancelAll: () => void;
}

const MetadataView = forwardRef<MetadataViewHandle, MetadataViewProps>(({
  libraryTracks,
  onImportFromLibrary: _onImportFromLibrary,
  onUpdateTrack
}, ref) => {
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [originalTrack, setOriginalTrack] = useState<Track | null>(null);
  const [saving, setSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingCoverDataUrl, setPendingCoverDataUrl] = useState<string | null>(null);
  const [stashedMetadata, setStashedMetadata] = useState<Record<string, Partial<Track>>>({});
  const [pendingTrackSwitch, setPendingTrackSwitch] = useState<Track | null>(null);
  const [, setLanguageVersion] = useState(0);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  const colors = currentTheme.colors;
  const autoSelectedRef = useRef(false);
  const originalTrackRef = useRef<Track | null>(null);

  useEffect(() => {
    const unsubscribe = i18n.subscribe(() => {
      setLanguageVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (selectedTrack) {
      setOriginalTrack(selectedTrack);
      originalTrackRef.current = selectedTrack;
    }
  }, [selectedTrack?.id]);

  const syncedLyricsToLRC = useCallback((syncedLyrics?: { time: number; text: string }[]): string => {
    if (!syncedLyrics || syncedLyrics.length === 0) return '';
    return syncedLyrics
      .map(line => {
        const minutes = Math.floor(line.time / 60);
        const seconds = Math.floor(line.time % 60);
        const centiseconds = Math.floor((line.time % 1) * 100);
        return `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}]${line.text}`;
      })
      .join('\n');
  }, []);

  useEffect(() => {
    if (libraryTracks.length > 0 && !selectedTrack && !autoSelectedRef.current) {
      autoSelectedRef.current = true;
      const timer = setTimeout(() => {
        setSelectedTrack(libraryTracks[0] ?? null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [libraryTracks.length, selectedTrack]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedTrack || !originalTrack) return false;

    const selectedLyrics = selectedTrack.syncedLyrics?.length
      ? syncedLyricsToLRC(selectedTrack.syncedLyrics)
      : (selectedTrack.lyrics ?? '');
    const originalLyrics = originalTrack.syncedLyrics?.length
      ? syncedLyricsToLRC(originalTrack.syncedLyrics)
      : (originalTrack.lyrics ?? '');

    return (selectedTrack.title ?? '') !== (originalTrack.title ?? '')
      || (selectedTrack.artist ?? '') !== (originalTrack.artist ?? '')
      || (selectedTrack.album ?? '') !== (originalTrack.album ?? '')
      || selectedLyrics !== originalLyrics
      || pendingCoverDataUrl !== null;
  }, [selectedTrack, originalTrack, pendingCoverDataUrl, syncedLyricsToLRC]);

  const refreshMetadata = useCallback(async () => {
    if (!selectedTrack?.filePath) return;

    setIsRefreshing(true);
    try {
      const desktopAPI = await getDesktopAPIAsync();
      if (desktopAPI?.refreshTrackMetadata) {
        const result = await desktopAPI.refreshTrackMetadata(selectedTrack.filePath);

        if (result.success && result.data) {
          const file = new File([result.data.buffer], result.data.fileName, { type: result.data.mimeType });
          const metadata = await parseAudioFile(file);

          let finalSyncedLyrics = metadata.syncedLyrics;
          if (!finalSyncedLyrics && metadata.lyrics) {
            const parsed = parseLRCLyrics(metadata.lyrics);
            finalSyncedLyrics = parsed.syncedLyrics;
          }

          let coverUrl = selectedTrack.coverUrl;
          if (metadata.coverUrl && !metadata.coverUrl.startsWith('blob:') && !metadata.coverUrl.startsWith('https://picsum.photos')) {
            coverUrl = metadata.coverUrl;
          } else if (metadata.coverUrl && metadata.coverUrl.startsWith('blob:')) {
            const cachedCoverUrl = await coverArtService.extractAndCacheCover(selectedTrack.id, selectedTrack.filePath);
            if (cachedCoverUrl) {
              coverUrl = cachedCoverUrl;
            }
          }

          const updatedTrack: Track = {
            ...selectedTrack,
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            lyrics: metadata.lyrics,
            syncedLyrics: finalSyncedLyrics,
            coverUrl,
          };

          setSelectedTrack(updatedTrack);
          setOriginalTrack(updatedTrack);

          if (onUpdateTrack) {
            onUpdateTrack(updatedTrack);
          }

          logger.info('[MetadataView] Metadata refreshed for track', selectedTrack.id);
        } else {
          logger.error('[MetadataView] Failed to refresh metadata:', result.error);
        }
      }
    } catch (error) {
      logger.error('[MetadataView] Error refreshing metadata:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedTrack, onUpdateTrack]);

  const saveAll = useCallback(async () => {
    if (!selectedTrack?.filePath) return;
    setSaving(true);
    try {
      if (!hasUnsavedChanges) {
        await refreshMetadata();
        return;
      }

      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI?.writeAudioMetadata) return;

      const lyricsToSave = selectedTrack.syncedLyrics && selectedTrack.syncedLyrics.length > 0
        ? syncedLyricsToLRC(selectedTrack.syncedLyrics)
        : selectedTrack.lyrics;

      const metadata = {
        title: selectedTrack.title,
        artist: selectedTrack.artist,
        album: selectedTrack.album,
        ...(lyricsToSave != null && { lyrics: lyricsToSave }),
        coverUrl: pendingCoverDataUrl || selectedTrack.coverUrl,
      };

      const result = await desktopAPI.writeAudioMetadata(selectedTrack.filePath, metadata);

      if (result.success) {
        logger.info(`[MetadataView] Saved all metadata for track ${selectedTrack.id}`);
        await coverArtService.deleteCover(selectedTrack.id);
        
        let newCoverUrl = selectedTrack.coverUrl;
        if (pendingCoverDataUrl) {
          const cachedCoverUrl = await coverArtService.extractAndCacheCover(selectedTrack.id, selectedTrack.filePath);
          if (cachedCoverUrl) {
            newCoverUrl = cachedCoverUrl;
          }
        }
        
        const updatedTrack = { ...selectedTrack, coverUrl: newCoverUrl };
        setSelectedTrack(updatedTrack);
        setOriginalTrack(updatedTrack);
        if (onUpdateTrack) {
          onUpdateTrack(updatedTrack);
        }
        
        setPendingCoverDataUrl(null);
        notify(
          i18n.t('notifications.saveSuccess'),
          i18n.t('notifications.metadataSaved')
        );
      } else {
        logger.error('[MetadataView] Failed to save metadata:', result.error);
        notify(
          i18n.t('notifications.saveFailed'),
          i18n.t('notifications.fieldSaveFailed').replace('{field}', 'metadata')
        );
      }
    } catch (error) {
      logger.error('[MetadataView] Error saving metadata:', error);
      notify(
        i18n.t('notifications.saveFailed'),
        i18n.t('notifications.fieldSaveFailed').replace('{field}', 'metadata')
      );
    } finally {
      setSaving(false);
    }
  }, [selectedTrack, originalTrack, pendingCoverDataUrl, hasUnsavedChanges, refreshMetadata, syncedLyricsToLRC]);

  const stashAll = useCallback(() => {
    if (!selectedTrack || !originalTrack) return;
    const changes: Partial<Track> = {};
    if (selectedTrack.title !== originalTrack.title) changes.title = selectedTrack.title;
    if (selectedTrack.artist !== originalTrack.artist) changes.artist = selectedTrack.artist;
    if (selectedTrack.album !== originalTrack.album) changes.album = selectedTrack.album;
    if (selectedTrack.lyrics !== originalTrack.lyrics) {
      changes.lyrics = selectedTrack.lyrics;
      if (selectedTrack.syncedLyrics) changes.syncedLyrics = selectedTrack.syncedLyrics;
    }
    if (pendingCoverDataUrl) changes.coverUrl = pendingCoverDataUrl;

    setStashedMetadata(prev => ({ ...prev, [selectedTrack.id!]: changes }));
    if (originalTrack) setSelectedTrack(originalTrack);
    setPendingCoverDataUrl(null);
  }, [selectedTrack, originalTrack, pendingCoverDataUrl]);

  useImperativeHandle(ref, () => ({
    get hasUnsavedChanges() { return hasUnsavedChanges; },
    saveAll,
    stashAll,
    cancelAll: () => {
      if (originalTrack) {
        setSelectedTrack(originalTrack);
        setPendingCoverDataUrl(null);
      }
    }
  }), [hasUnsavedChanges, saveAll, stashAll, originalTrack]);

  const selectTrack = useCallback((track: Track) => {
    const stashed = stashedMetadata[track.id!];
    if (stashed) {
      setSelectedTrack({ ...track, ...stashed });
    } else {
      setSelectedTrack(track);
    }
  }, [stashedMetadata]);

  const handleTrackSelect = useCallback((track: Track) => {
    if (hasUnsavedChanges) {
      setPendingTrackSwitch(track);
      return;
    }
    selectTrack(track);
  }, [hasUnsavedChanges, selectTrack]);

  const handleCoverImport = useCallback(async () => {
    if (!selectedTrack?.filePath) {
      logger.warn('[MetadataView] No track selected or no file path');
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        setPendingCoverDataUrl(dataUrl);
      } catch (error) {
        logger.error('[MetadataView] Error reading cover file:', error);
      }
    };
    input.click();
  }, [selectedTrack]);

  const renderDialog = useCallback((onSave: () => void, onStash: () => void, onCancel: () => void) => {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}>
        <div className="rounded-2xl p-6 w-96 shadow-2xl" style={{ backgroundColor: colors.backgroundDark, border: `1px solid ${colors.borderLight}` }}>
          <h3 className="text-lg font-semibold mb-2" style={{ color: colors.textPrimary }}>
            {i18n.t('metadataView.unsavedTitle')}
          </h3>
          <p className="mb-6 text-sm" style={{ color: colors.textSecondary }}>
            {i18n.t('metadataView.unsavedMessage')}
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{ color: colors.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {i18n.t('common.cancel')}
            </button>
            <button
              onClick={onStash}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{ backgroundColor: colors.backgroundCardHover, color: colors.textPrimary }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.borderLight; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; }}
            >
              {i18n.t('metadataView.stash')}
            </button>
            <button
              onClick={onSave}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{ backgroundColor: colors.primary, color: '#fff' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.primaryHover; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.primary; }}
            >
              {i18n.t('metadataView.saveChanges')}
            </button>
          </div>
        </div>
      </div>
    );
  }, [colors]);

  const renderMetadataField = useCallback((label: string, _value: string | undefined, field: 'title' | 'artist' | 'album' | 'lyrics', isLyrics: boolean = false) => {
    let currentValue = selectedTrack?.[field] || '';
    let originalValue = originalTrack?.[field] || '';
    if (isLyrics) {
      if (selectedTrack?.syncedLyrics?.length) {
        currentValue = syncedLyricsToLRC(selectedTrack.syncedLyrics);
      }
      if (originalTrack?.syncedLyrics?.length) {
        originalValue = syncedLyricsToLRC(originalTrack.syncedLyrics);
      }
    }

    const hasChanged = currentValue !== originalValue;

    if (isLyrics) {
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-2 flex-shrink-0">
            <span className="text-sm font-bold uppercase tracking-widest" style={{ color: colors.textMuted }}>{label}:</span>
          </div>
          <div className="flex-1 relative min-h-0">
            <textarea
              value={currentValue}
              onChange={(e) => {
                if (selectedTrack) {
                  const updated = { ...selectedTrack, [field]: e.target.value };
                  if (isLyrics) {
                    updated.syncedLyrics = undefined;
                  }
                  setSelectedTrack(updated as Track);
                }
              }}
              className="absolute inset-0 w-full rounded-lg p-3 pr-10 text-sm focus:outline-none focus:ring-0 transition-all resize-none no-scrollbar"
              style={{
                backgroundColor: colors.backgroundCard,
                border: `1px solid ${hasChanged ? colors.primary : colors.borderLight}`,
                color: colors.textPrimary,
              }}
              onFocus={(e) => {
                e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                e.currentTarget.style.boxShadow = `0 0 20px ${colors.glowColor}`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.backgroundColor = colors.backgroundCard;
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
            {hasChanged && (
              <button
                onClick={() => {
                  if (selectedTrack && originalTrackRef.current) {
                    const orig = originalTrackRef.current;
                    const restored = { ...selectedTrack, lyrics: orig.lyrics, syncedLyrics: orig.syncedLyrics };
                    setSelectedTrack(restored as Track);
                  }
                }}
                className="absolute top-2 right-2 w-6 h-6 rounded transition-all flex items-center justify-center"
                style={{ backgroundColor: colors.backgroundCard, color: colors.textMuted }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.textPrimary; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textMuted; }}
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-4">
        <span className="text-sm font-bold uppercase tracking-widest w-16 flex-shrink-0" style={{ color: colors.textMuted }}>{label}:</span>
        <div className="relative flex-1">
          <input
            type="text"
            value={currentValue}
            onChange={(e) => {
              if (selectedTrack) {
                const updated = { ...selectedTrack, [field]: e.target.value };
                setSelectedTrack(updated as Track);
              }
            }}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-0 transition-all"
            style={{
              backgroundColor: colors.backgroundCard,
              border: `1px solid ${hasChanged ? colors.primary : colors.borderLight}`,
              color: colors.textPrimary,
            }}
            onFocus={(e) => {
              e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
              e.currentTarget.style.boxShadow = `0 0 15px ${colors.glowColor}`;
            }}
            onBlur={(e) => {
              e.currentTarget.style.backgroundColor = colors.backgroundCard;
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          {hasChanged && (
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1">
              <button
                onClick={() => {
                  if (selectedTrack) {
                    const updated = { ...selectedTrack, [field]: originalValue || '' };
                    setSelectedTrack(updated as Track);
                  }
                }}
                className="w-6 h-6 rounded transition-all flex items-center justify-center"
                style={{ backgroundColor: colors.backgroundCard, color: colors.textMuted }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.textPrimary; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textMuted; }}
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }, [selectedTrack, originalTrack, currentTheme, syncedLyricsToLRC]);

  return (
    <div className="w-full flex flex-col h-full">
      {pendingTrackSwitch && renderDialog(
        async () => {
          await saveAll();
          selectTrack(pendingTrackSwitch);
          setPendingTrackSwitch(null);
        },
        () => {
          stashAll();
          selectTrack(pendingTrackSwitch);
          setPendingTrackSwitch(null);
        },
        () => {
          setPendingTrackSwitch(null);
        }
      )}

      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold mb-2" style={{ color: 'var(--theme-text-primary, #fff)' }}>{i18n.t('metadataView.title')}</h1>
          <p style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>
            {i18n.t('metadataView.description')}
          </p>
        </div>
        <button
          onClick={saveAll}
          disabled={saving || isRefreshing || !selectedTrack}
          className="w-10 h-10 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: hasUnsavedChanges ? colors.primary : colors.backgroundCard,
            color: hasUnsavedChanges ? '#fff' : colors.textMuted,
          }}
          onMouseEnter={e => {
            if (!hasUnsavedChanges) {
              e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
              e.currentTarget.style.color = colors.textPrimary;
            }
          }}
          onMouseLeave={e => {
            if (!hasUnsavedChanges) {
              e.currentTarget.style.backgroundColor = colors.backgroundCard;
              e.currentTarget.style.color = colors.textMuted;
            }
          }}
        >
          <span className={`material-symbols-outlined text-xl ${saving || isRefreshing ? 'animate-spin' : ''}`}>
            {saving || isRefreshing ? 'sync' : (hasUnsavedChanges ? 'check' : 'refresh')}
          </span>
        </button>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        <div className="w-64 flex-shrink-0 overflow-y-auto no-scrollbar">
          <div className="flex flex-col gap-1">
            {libraryTracks.map((track) => (
              <button
                key={track.id}
                onClick={() => handleTrackSelect(track)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all"
                style={selectedTrack?.id === track.id
                  ? { backgroundColor: colors.backgroundCard, color: colors.textPrimary }
                  : { backgroundColor: 'transparent', color: colors.textMuted }
                }
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                  e.currentTarget.style.color = colors.textPrimary;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = selectedTrack?.id === track.id ? colors.backgroundCard : 'transparent';
                  e.currentTarget.style.color = selectedTrack?.id === track.id ? colors.textPrimary : colors.textMuted;
                }}
              >
                <TrackCover
                  trackId={track.id}
                  {...(track.filePath != null && { filePath: track.filePath })}
                  {...(track.coverUrl != null && { fallbackUrl: track.coverUrl })}
                  className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                />
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-sm truncate">{track.title}</p>
                  <p className="text-xs opacity-50 truncate">{track.artist}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {selectedTrack ? (
          <div className="flex-1 overflow-hidden">
            <div className="w-full h-full flex flex-col gap-4">
              <div className="flex gap-5 flex-shrink-0">
                <div className="relative group flex-shrink-0">
                  <TrackCover
                    trackId={selectedTrack.id}
                    {...(selectedTrack.filePath != null && { filePath: selectedTrack.filePath })}
                    {...((pendingCoverDataUrl || selectedTrack.coverUrl) != null && { fallbackUrl: pendingCoverDataUrl || selectedTrack.coverUrl })}
                    className="w-32 h-32 rounded-2xl object-cover shadow-2xl"
                  />
                  {pendingCoverDataUrl && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingCoverDataUrl(null);
                      }}
                      className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center transition-all"
                      style={{ backgroundColor: colors.backgroundCard, color: colors.textMuted }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.textPrimary; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textMuted; }}
                      title={i18n.t('common.cancel')}
                    >
                      <span className="material-symbols-outlined text-[10px]">close</span>
                    </button>
                  )}
                  <button
                    onClick={handleCoverImport}
                    className="absolute bottom-2 right-2 px-2 py-1 rounded-lg bg-black/60 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm" style={{ color: colors.textPrimary }}>add_photo_alternate</span>
                    <span className="text-xs" style={{ color: colors.textPrimary }}>{i18n.t('metadataView.importCover')}</span>
                  </button>
                </div>
                <div className="flex-1 flex flex-col gap-2 min-w-0 pt-0 pb-2">
                  {renderMetadataField('TITLE', selectedTrack.title, 'title')}
                  {renderMetadataField('ARTIST', selectedTrack.artist, 'artist')}
                  {renderMetadataField('ALBUM', selectedTrack.album, 'album')}
                </div>
              </div>
              {renderMetadataField('LYRICS', selectedTrack.lyrics, 'lyrics', true)}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center opacity-40">
              <span className="material-symbols-outlined text-6xl mb-4 block">description</span>
              <p className="text-xl font-medium">{i18n.t('metadataView.selectTrack')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

MetadataView.displayName = 'MetadataView';

export default MetadataView;
