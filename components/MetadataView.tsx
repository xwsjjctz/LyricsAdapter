import React, { useState, useCallback, useEffect, memo, useRef } from 'react';
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

const MetadataView: React.FC<MetadataViewProps> = memo(({
  libraryTracks,
  onImportFromLibrary,
  onUpdateTrack
}) => {
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [originalTrack, setOriginalTrack] = useState<Track | null>(null);
  const [savingFields, setSavingFields] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [, setLanguageVersion] = useState(0);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  const colors = currentTheme.colors;
  const autoSelectedRef = useRef(false);

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
    }
  }, [selectedTrack?.id]);

  // Convert synced lyrics to LRC format for saving
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

  // Auto-select first track when library is loaded and no track is selected
  useEffect(() => {
    if (libraryTracks.length > 0 && !selectedTrack && !autoSelectedRef.current) {
      autoSelectedRef.current = true;
      // Small delay to ensure component is fully mounted
      const timer = setTimeout(() => {
        setSelectedTrack(libraryTracks[0]);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [libraryTracks.length, selectedTrack]);

  // Refresh metadata for selected track
  const refreshMetadata = useCallback(async () => {
    if (!selectedTrack?.filePath) return;

    setIsRefreshing(true);
    try {
      const desktopAPI = await getDesktopAPIAsync();
      if (desktopAPI?.refreshTrackMetadata) {
        const result = await desktopAPI.refreshTrackMetadata(selectedTrack.filePath);
        
        if (result.success && result.data) {
          // Parse the metadata using parseAudioFile
          const file = new File([result.data.buffer], result.data.fileName, { type: result.data.mimeType });
          const metadata = await parseAudioFile(file);
          
          // Ensure syncedLyrics is populated from lyrics if it contains LRC timestamps
          let finalSyncedLyrics = metadata.syncedLyrics;
          if (!finalSyncedLyrics && metadata.lyrics) {
            const parsed = parseLRCLyrics(metadata.lyrics);
            finalSyncedLyrics = parsed.syncedLyrics;
          }
          
          // Preserve the original cover URL if it was a cover:// protocol URL
          // The parsed metadata.coverUrl may be a blob URL which can't be fetched by the main process
          const coverUrl = selectedTrack.coverUrl?.startsWith('cover://')
            ? selectedTrack.coverUrl
            : (metadata.coverUrl && !metadata.coverUrl.startsWith('blob:') ? metadata.coverUrl : selectedTrack.coverUrl);

          // Create updated track with cover URL
          const updatedTrack: Track = {
            ...selectedTrack,
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            lyrics: metadata.lyrics,
            syncedLyrics: finalSyncedLyrics,
            coverUrl,
          };
          
          // Update state
          setSelectedTrack(updatedTrack);
          setOriginalTrack(updatedTrack);
          
          // Notify parent component
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

  const handleCoverImport = useCallback(async (trackId: string) => {
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
        setIsRefreshing(true);
        logger.info('[MetadataView] Importing cover for track:', trackId);

        // Read file as data URL
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        logger.debug('[MetadataView] Cover file read, size:', dataUrl.length);

        // Write metadata with cover
        const desktopAPI = await getDesktopAPIAsync();
        if (desktopAPI?.writeAudioMetadata && selectedTrack.filePath) {
          // Convert syncedLyrics to LRC format for saving
          const lyricsToSave = selectedTrack.syncedLyrics && selectedTrack.syncedLyrics.length > 0
            ? syncedLyricsToLRC(selectedTrack.syncedLyrics)
            : selectedTrack.lyrics;
          
          const metadata = {
            title: selectedTrack.title,
            artist: selectedTrack.artist,
            album: selectedTrack.album,
            lyrics: lyricsToSave,
            coverUrl: dataUrl, // Pass data URL directly
          };

          logger.info('[MetadataView] Writing cover to file...');
          const result = await desktopAPI.writeAudioMetadata(selectedTrack.filePath, metadata);

          if (result.success) {
            logger.info('[MetadataView] ✓ Cover written successfully');
            // Clear cover cache after cover update
            await coverArtService.deleteCover(selectedTrack.id);
            // Refresh metadata to show new cover
            await refreshMetadata();
          } else {
            logger.error('[MetadataView] Failed to write cover:', result.error);
            notify(
              i18n.t('notifications.saveFailed'),
              i18n.t('notifications.coverSaveFailed')
            );
          }
        }
      } catch (error) {
        logger.error('[MetadataView] Error importing cover:', error);
        notify(
          i18n.t('notifications.saveFailed'),
          i18n.t('notifications.coverSaveFailed')
        );
      } finally {
        setIsRefreshing(false);
      }
    };
    input.click();
  }, [selectedTrack, refreshMetadata, syncedLyricsToLRC]);

  const renderMetadataField = useCallback((label: string, value: string | undefined, field: 'title' | 'artist' | 'album' | 'lyrics', isLyrics: boolean = false) => {
    // For lyrics field, prefer synced lyrics in LRC format if available
    let currentValue = selectedTrack?.[field] || '';
    if (isLyrics && selectedTrack?.syncedLyrics && selectedTrack.syncedLyrics.length > 0) {
      currentValue = syncedLyricsToLRC(selectedTrack.syncedLyrics);
    }
    
    const originalValue = originalTrack?.[field] || '';
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
                  setSelectedTrack(updated as Track);
                }
              }}
              className="absolute inset-0 w-full rounded-lg p-3 pr-20 text-sm focus:outline-none focus:ring-0 transition-all resize-none no-scrollbar"
              style={{
                backgroundColor: colors.backgroundCard,
                border: `1px solid ${colors.borderLight}`,
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
              <div className="absolute right-2 top-2 flex gap-1">
                <button
                  onClick={() => {
                    if (selectedTrack) {
                      const updated = { ...selectedTrack, [field]: originalValue || '' };
                      setSelectedTrack(updated as Track);
                    }
                  }}
                  className="w-7 h-7 rounded-md transition-all flex items-center justify-center"
                  style={{ backgroundColor: colors.backgroundCard, color: colors.textMuted }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.textPrimary; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textMuted; }}
                  title={i18n.t('common.cancel')}
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
                <button
                  onClick={async () => {
                    if (!selectedTrack?.filePath) return;
                    
                    setSavingFields(prev => new Set(prev).add(field));
                    
                    try {
                      const desktopAPI = await getDesktopAPIAsync();
                      if (desktopAPI?.writeAudioMetadata && selectedTrack.filePath) {
                        // Convert syncedLyrics to LRC format for saving
                        const lyricsToSave = selectedTrack.syncedLyrics && selectedTrack.syncedLyrics.length > 0
                          ? syncedLyricsToLRC(selectedTrack.syncedLyrics)
                          : selectedTrack.lyrics;
                        
                        // Pass all metadata fields to avoid clearing other fields
                        const metadata = {
                          title: selectedTrack.title,
                          artist: selectedTrack.artist,
                          album: selectedTrack.album,
                          lyrics: lyricsToSave,
                          coverUrl: selectedTrack.coverUrl,
                        };
                        
                        const result = await desktopAPI.writeAudioMetadata(selectedTrack.filePath, metadata);
                        
                        if (result.success) {
                          logger.info(`[MetadataView] Saved ${field} for track ${selectedTrack.id}`);
                          // Refresh metadata after saving
                          await refreshMetadata();
                        } else {
                          logger.error(`[MetadataView] Failed to save ${field}:`, result.error);
                          notify(
                            i18n.t('notifications.saveFailed'),
                            i18n.t('notifications.fieldSaveFailed').replace('{field}', field)
                          );
                        }
                      }
                    } catch (error) {
                      logger.error(`[MetadataView] Error saving ${field}:`, error);
                      notify(
                        i18n.t('notifications.saveFailed'),
                        i18n.t('notifications.fieldSaveFailed').replace('{field}', field)
                      );
                    } finally {
                      setSavingFields(prev => {
                        const next = new Set(prev);
                        next.delete(field);
                        return next;
                      });
                    }
                  }}
                  disabled={savingFields.has(field)}
                  className={`w-7 h-7 rounded-md transition-all flex items-center justify-center ${savingFields.has(field) ? 'opacity-50 cursor-not-allowed' : ''}`}
                  style={{ backgroundColor: colors.primary, color: colors.textPrimary }}
                  title={i18n.t('common.save')}
                >
                  <span className="material-symbols-outlined text-base">{savingFields.has(field) ? 'hourglass_empty' : 'check'}</span>
                </button>
              </div>
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
              border: `1px solid ${colors.borderLight}`,
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
                title={i18n.t('common.cancel')}
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
              <button
                  onClick={async () => {
                    if (!selectedTrack?.filePath) return;
                    
                    setSavingFields(prev => new Set(prev).add(field));
                    
                    try {
                      const desktopAPI = await getDesktopAPIAsync();
                      if (desktopAPI?.writeAudioMetadata && selectedTrack.filePath) {
                        // Convert syncedLyrics to LRC format for saving
                        const lyricsToSave = selectedTrack.syncedLyrics && selectedTrack.syncedLyrics.length > 0
                          ? syncedLyricsToLRC(selectedTrack.syncedLyrics)
                          : selectedTrack.lyrics;
                        
                        // Pass all metadata fields to avoid clearing other fields
                        const metadata = {
                          title: selectedTrack.title,
                          artist: selectedTrack.artist,
                          album: selectedTrack.album,
                          lyrics: lyricsToSave,
                          coverUrl: selectedTrack.coverUrl,
                        };
                        
                        const result = await desktopAPI.writeAudioMetadata(selectedTrack.filePath, metadata);
                        
                        if (result.success) {
                          logger.info(`[MetadataView] Saved ${field} for track ${selectedTrack.id}`);
                          // Clear cover cache after metadata update
                          await coverArtService.deleteCover(selectedTrack.id);
                          // Refresh metadata after saving
                          await refreshMetadata();
                        } else {
                          logger.error(`[MetadataView] Failed to save ${field}:`, result.error);
                          notify(
                            i18n.t('notifications.saveFailed'),
                            i18n.t('notifications.fieldSaveFailed').replace('{field}', field)
                          );
                        }
                      }
                    } catch (error) {
                      logger.error(`[MetadataView] Error saving ${field}:`, error);
                      notify(
                        i18n.t('notifications.saveFailed'),
                        i18n.t('notifications.fieldSaveFailed').replace('{field}', field)
                      );
                    } finally {
                      setSavingFields(prev => {
                        const next = new Set(prev);
                        next.delete(field);
                        return next;
                      });
                    }
                  }}
                disabled={savingFields.has(field)}
                className={`w-6 h-6 rounded transition-all flex items-center justify-center ${savingFields.has(field) ? 'opacity-50 cursor-not-allowed' : ''}`}
                style={{ backgroundColor: colors.primary, color: colors.textPrimary }}
                title={i18n.t('common.save')}
              >
                <span className="material-symbols-outlined text-sm">{savingFields.has(field) ? 'hourglass_empty' : 'check'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }, [selectedTrack, originalTrack, currentTheme]);

  return (
    <div className="w-full flex flex-col h-full">
      {/* 固定的标题部分 */}
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold mb-2" style={{ color: 'var(--theme-text-primary, #fff)' }}>{i18n.t('metadataView.title')}</h1>
          <p style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>
            {i18n.t('metadataView.description')}
          </p>
        </div>
        <button
          onClick={refreshMetadata}
          disabled={isRefreshing || !selectedTrack}
          className="w-10 h-10 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: colors.backgroundCard, color: colors.textMuted }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.primary; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textMuted; }}
          title={isRefreshing ? '刷新中...' : '刷新元数据'}
        >
          <span className={`material-symbols-outlined text-xl ${isRefreshing ? 'animate-spin' : ''}`}>{isRefreshing ? 'sync' : 'refresh'}</span>
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        {/* 左侧音频列表 */}
        <div className="w-64 flex-shrink-0 overflow-y-auto no-scrollbar">
          <div className="flex flex-col gap-1">
            {libraryTracks.map((track) => (
              <button
                key={track.id}
                onClick={() => setSelectedTrack(track)}
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
                  filePath={track.filePath}
                  fallbackUrl={track.coverUrl}
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

        {/* 右侧元数据显示 */}
        {selectedTrack ? (
          <div className="flex-1 overflow-hidden">
            <div className="w-full h-full flex flex-col gap-4">
              <div className="flex gap-5 flex-shrink-0">
                <div className="relative group flex-shrink-0">
                  <TrackCover
                    trackId={selectedTrack.id}
                    filePath={selectedTrack.filePath}
                    fallbackUrl={selectedTrack.coverUrl}
                    className="w-32 h-32 rounded-2xl object-cover shadow-2xl"
                  />
                  <button
                    onClick={() => handleCoverImport(selectedTrack.id)}
                    className="absolute top-0 left-0 w-32 h-32 bg-black/50 flex items-center justify-center rounded-2xl opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  >
                    <div className="text-center">
                      <span className="material-symbols-outlined text-3xl mb-1 block" style={{ color: colors.textPrimary }}>add_photo_alternate</span>
                      <div className="text-xs" style={{ color: colors.textPrimary }}>{i18n.t('metadataView.importCover')}</div>
                    </div>
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
