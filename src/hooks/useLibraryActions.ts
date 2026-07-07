import { useCallback } from 'react';
import { Track } from '../types';
import { getDesktopAPIAsync } from '../services/desktopAdapter';
import { indexedDBStorage } from '../services/indexedDBStorage';
import { metadataCacheService } from '../services/metadataCacheService';
import { coverArtService } from '../services/coverArtService';
import { logger } from '../services/logger';

interface UseLibraryActionsOptions {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentTrackIndex: number;
  setCurrentTrackIndex: (index: number | ((prev: number) => number)) => void;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  createTrackedBlobUrl: (blob: Blob | File) => string;
  revokeBlobUrl: (blobUrl: string) => void;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
}

export function useLibraryActions({
  tracks,
  setTracks,
  currentTrackIndex,
  setCurrentTrackIndex,
  isPlaying,
  setIsPlaying,
  createTrackedBlobUrl,
  revokeBlobUrl,
  audioRef,
}: UseLibraryActionsOptions) {
  const handleRemoveTrack = useCallback(async (trackId: string, deleteFile = false) => {
    const trackToRemove = tracks.find(t => t.id === trackId);

    // 删除本地物理音频文件（仅当显式要求且存在路径时；cloud/WebDAV 由 UI 层保证不触发）
    if (deleteFile && trackToRemove?.filePath) {
      const desktopAPI = await getDesktopAPIAsync();
      if (desktopAPI?.deleteAudioFile) {
        try {
          const result = await desktopAPI.deleteAudioFile(trackToRemove.filePath);
          if (result.success && result.deleted) {
            logger.debug(`[LibraryActions] ✓ Deleted audio file: ${trackToRemove.filePath}`);
          } else if (!result.success) {
            logger.warn(`[LibraryActions] Failed to delete audio file: ${trackToRemove.filePath}`, result.error);
          }
        } catch (error) {
          logger.warn('[LibraryActions] deleteAudioFile error:', error);
        }
      }
    }

    setTracks(prev => {
      const newTracks = prev.filter(t => t.id !== trackId);
      const removedIndex = prev.findIndex(t => t.id === trackId);
      const trackToRemove = prev[removedIndex];

      let newIndex = currentTrackIndex;

      if (newTracks.length === 0) {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = '';
        }
        setIsPlaying(false);
        setCurrentTrackIndex(-1);

        if (trackToRemove) {
          if (trackToRemove.audioUrl && trackToRemove.audioUrl.startsWith('blob:')) {
            revokeBlobUrl(trackToRemove.audioUrl);
          }
          if (trackToRemove.coverUrl && trackToRemove.coverUrl.startsWith('blob:')) {
            revokeBlobUrl(trackToRemove.coverUrl);
          }
        }

        return newTracks;
      }

      if (removedIndex >= 0) {
        if (removedIndex < currentTrackIndex) {
          newIndex = Math.max(0, currentTrackIndex - 1);
        } else if (removedIndex === currentTrackIndex) {
          newIndex = Math.min(currentTrackIndex, newTracks.length - 1);
        }
      }

      setCurrentTrackIndex(newIndex);

      if (trackToRemove) {
        if (trackToRemove.audioUrl && trackToRemove.audioUrl.startsWith('blob:')) {
          revokeBlobUrl(trackToRemove.audioUrl);
        }
        if (trackToRemove.coverUrl && trackToRemove.coverUrl.startsWith('blob:')) {
          revokeBlobUrl(trackToRemove.coverUrl);
        }
      }

      // Note: We no longer delete physical files since we only store paths
      // The file belongs to the user, not the app

      const cleanupCover = async () => {
        try {
          await coverArtService.deleteCover(trackId);
          await indexedDBStorage.deleteMetadata(trackId);
          metadataCacheService.clear();
          logger.debug(`✅ Resources cleaned up for track: ${trackToRemove?.title || trackId}`);
        } catch (error) {
          logger.warn('Failed to cleanup resources for track:', error);
        }
      };

      cleanupCover();

      return newTracks;
    });
  }, [tracks, currentTrackIndex, isPlaying, audioRef, revokeBlobUrl, setCurrentTrackIndex, setIsPlaying, setTracks]);

  const handleRemoveMultipleTracks = useCallback(async (trackIds: string[], deleteFile = false) => {
    logger.debug(`[LibraryActions] Batch removing ${trackIds.length} tracks...`);

    const tracksToRemove = tracks.filter(t => trackIds.includes(t.id));

    const desktopAPI = await getDesktopAPIAsync();

    // 删除本地物理音频文件（仅当显式要求时）
    if (deleteFile && desktopAPI?.deleteAudioFile) {
      for (const track of tracksToRemove) {
        if (!track.filePath) continue;
        try {
          const result = await desktopAPI.deleteAudioFile(track.filePath);
          if (result.success && result.deleted) {
            logger.debug(`[LibraryActions] ✓ Deleted audio file: ${track.filePath}`);
          } else if (!result.success) {
            logger.warn(`[LibraryActions] Failed to delete audio file: ${track.filePath}`, result.error);
          }
        } catch (error) {
          logger.warn('[LibraryActions] deleteAudioFile error:', error);
        }
      }
    }

    for (const track of tracksToRemove) {
      if (track.audioUrl && track.audioUrl.startsWith('blob:')) {
        revokeBlobUrl(track.audioUrl);
      }
      if (track.coverUrl && track.coverUrl.startsWith('blob:')) {
        revokeBlobUrl(track.coverUrl);
      }
    }

    // 删除封面缩略图（由 app 管理）
    if (desktopAPI?.deleteCoverThumbnail) {
      for (const track of tracksToRemove) {
        try {
          await desktopAPI.deleteCoverThumbnail(track.id);
        } catch (error) {
          logger.warn(`Failed to delete cover thumbnail for ${track.title}:`, error);
        }
      }
    }

    for (const trackId of trackIds) {
      try {
        await indexedDBStorage.deleteMetadata(trackId);
      } catch (error) {
        logger.warn(`Failed to delete metadata for ${trackId}:`, error);
      }
    }

    // 清除内存中的元数据缓存，避免脏数据残留
    metadataCacheService.clear();

    setTracks(prev => {
      const newTracks = prev.filter(t => !trackIds.includes(t.id));

      setCurrentTrackIndex(prevIndex => {
        if (newTracks.length === 0) {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
          }
          setIsPlaying(false);
          return -1;
        }

        const removedBeforeCurrent = trackIds.filter(id => {
          const removedIndex = prev.findIndex(t => t.id === id);
          return removedIndex >= 0 && removedIndex < prevIndex;
        }).length;

        let newIndex = prevIndex - removedBeforeCurrent;

        if (newIndex >= newTracks.length) {
          newIndex = Math.max(0, newTracks.length - 1);
        }
        if (newIndex < 0) {
          newIndex = 0;
        }

        logger.debug(`[LibraryActions] Current track index: ${prevIndex} → ${newIndex} (removed ${removedBeforeCurrent} tracks before current)`);
        return newIndex;
      });

      return newTracks;
    });

    logger.debug(`[LibraryActions] ✓ Batch removal complete: ${trackIds.length} tracks removed`);
  }, [tracks, revokeBlobUrl, audioRef, setCurrentTrackIndex, setIsPlaying, setTracks]);

  const handleReloadFiles = useCallback(async () => {
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI) return;

    try {
      const result = await desktopAPI.selectFiles();
      if (result.canceled || result.filePaths.length === 0) {
        return;
      }

      const filePaths = result.filePaths;
      const updatedTracks = [...tracks];
      let reloadedCount = 0;

      for (const filePath of filePaths) {
        const fileName = filePath.split(/[/\\]/).pop() || '';

        const trackIndex = updatedTracks.findIndex(t => {
          return t.fileName === fileName;
        });

        if (trackIndex !== -1 && !updatedTracks[trackIndex]!.available) {
          try {
            // Parse metadata directly from the selected file path
            const parseResult = await desktopAPI.parseAudioMetadata(filePath);
            if (parseResult.success && parseResult.metadata) {
              const metadata = parseResult.metadata as {
                title?: string;
                artist?: string;
                album?: string;
                duration?: number;
                lyrics?: string;
                syncedLyrics?: { time: number; text: string }[];
                coverData?: string;
                coverMime?: string;
                fileSize?: number;
              };

              let coverUrl = '';
              let coverSavedToDisk = false;
              if (metadata.coverData && metadata.coverMime) {
                if (desktopAPI.saveCoverThumbnail) {
                  try {
                    const coverResult = await desktopAPI.saveCoverThumbnail({
                      id: updatedTracks[trackIndex]!.id,
                      data: metadata.coverData,
                      mime: metadata.coverMime
                    });
                    if (coverResult?.success && coverResult.coverUrl) {
                      coverUrl = coverResult.coverUrl;
                      coverSavedToDisk = true;
                    }
                  } catch (error) {
                    logger.warn('[LibraryActions] Failed to save cover thumbnail to disk:', error);
                  }
                }

                  if (!coverSavedToDisk) {
                    const byteCharacters = atob(metadata.coverData);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                      byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: metadata.coverMime });
                    coverUrl = createTrackedBlobUrl(blob);
                  }
                }

              metadataCacheService.set(updatedTracks[trackIndex]!.id, {
                title: metadata.title ?? '',
                artist: metadata.artist ?? '',
                album: metadata.album ?? '',
                duration: metadata.duration ?? 0,
                lyrics: metadata.lyrics ?? '',
                syncedLyrics: metadata.syncedLyrics,
                fileName: fileName,
                fileSize: metadata.fileSize || 0,
                lastModified: Date.now(),
              });

              updatedTracks[trackIndex] = {
                ...updatedTracks[trackIndex]!,
                title: metadata.title ?? '',
                artist: metadata.artist ?? '',
                album: metadata.album ?? '',
                duration: metadata.duration ?? 0,
                lyrics: metadata.lyrics ?? '',
                syncedLyrics: metadata.syncedLyrics,
                coverUrl: coverUrl,
                filePath: filePath,
                fileName: fileName,
                fileSize: metadata.fileSize || updatedTracks[trackIndex]!.fileSize,
                lastModified: Date.now(),
                available: true
              };
              reloadedCount++;
            }
          } catch (error) {
            logger.error('Failed to reload file:', filePath, error);
          }
        }
      }

      setTracks(updatedTracks);
      logger.debug(`Reloaded ${reloadedCount} files`);

      if (reloadedCount > 0) {
        await metadataCacheService.save();
      }
    } catch (error) {
      logger.error('Failed to reload files:', error);
    }
  }, [tracks, createTrackedBlobUrl, setTracks]);

  return {
    handleRemoveTrack,
    handleRemoveMultipleTracks,
    handleReloadFiles
  };
}
