import { useCallback } from 'react';
import { Track } from '../types';
import { getDesktopAPIAsync } from '../services/desktopAdapter';
import { metadataCacheService } from '../services/metadataCacheService';
import { coverArtService } from '../services/coverArtService';
import { logger } from '../services/logger';

interface UseLibraryActionsOptions {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentTrackIndex: number;
  setCurrentTrackIndex: React.Dispatch<React.SetStateAction<number>>;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  createTrackedBlobUrl: (blob: Blob | File) => string;
  revokeBlobUrl: (blobUrl: string) => void;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  shouldAutoPlayRef: React.MutableRefObject<boolean>;
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
  shouldAutoPlayRef
}: UseLibraryActionsOptions) {
  // Note: cleanupOrphanAudio is no longer needed since we only store paths
  // Files are not copied to app directory anymore
  const cleanupOrphanAudio = useCallback(async (_remainingTracks: Track[]) => {
    // No-op: we don't manage physical files anymore
    logger.debug('[LibraryActions] cleanupOrphanAudio: skipped (path-only mode)');
  }, []);

  const handleRemoveTrack = useCallback(async (trackId: string) => {
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

      if (removedIndex === currentTrackIndex) {
        if (newTracks.length > 0) {
          if (isPlaying) {
            shouldAutoPlayRef.current = true;
          }
        }
      }

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
          const desktopAPI = await getDesktopAPIAsync();
          if (desktopAPI && desktopAPI.deleteCoverThumbnail) {
            await desktopAPI.deleteCoverThumbnail(trackId);
            logger.debug(`✅ Cover deleted from disk for track: ${trackToRemove?.title || trackId}`);
          }
          await metadataCacheService.deleteCover(trackId);
          await coverArtService.deleteCover(trackId);
          logger.debug(`✅ Cover deleted from IndexedDB for track: ${trackToRemove?.title || trackId}`);
        } catch (error) {
          logger.warn('Failed to delete cover from IndexedDB:', error);
        }
      };

      cleanupCover();
      cleanupOrphanAudio(newTracks);

      return newTracks;
    });
  }, [currentTrackIndex, isPlaying, audioRef, revokeBlobUrl, setCurrentTrackIndex, setIsPlaying, setTracks, shouldAutoPlayRef, cleanupOrphanAudio]);

  const handleRemoveMultipleTracks = useCallback(async (trackIds: string[]) => {
    logger.debug(`[LibraryActions] Batch removing ${trackIds.length} tracks...`);

    const tracksToRemove = tracks.filter(t => trackIds.includes(t.id));

    for (const track of tracksToRemove) {
      if (track.audioUrl && track.audioUrl.startsWith('blob:')) {
        revokeBlobUrl(track.audioUrl);
      }
      if (track.coverUrl && track.coverUrl.startsWith('blob:')) {
        revokeBlobUrl(track.coverUrl);
      }
    }

    // Note: We no longer delete physical files since we only store paths
    // Only delete cover thumbnails (which are managed by the app)
    const desktopAPI = await getDesktopAPIAsync();
    if (desktopAPI) {
      for (const track of tracksToRemove) {
        if (desktopAPI.deleteCoverThumbnail) {
          try {
            await desktopAPI.deleteCoverThumbnail(track.id);
          } catch (error) {
            logger.warn(`Failed to delete cover thumbnail for ${track.title}:`, error);
          }
        }
      }
    }

    for (const trackId of trackIds) {
      try {
        await metadataCacheService.deleteCover(trackId);
        await coverArtService.deleteCover(trackId);
      } catch (error) {
        logger.warn(`Failed to delete cover for ${trackId} from IndexedDB:`, error);
      }
    }

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

      cleanupOrphanAudio(newTracks);
      return newTracks;
    });

    logger.debug(`[LibraryActions] ✓ Batch removal complete: ${trackIds.length} tracks removed`);
  }, [tracks, revokeBlobUrl, cleanupOrphanAudio, audioRef, setCurrentTrackIndex, setIsPlaying, setTracks]);

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

        if (trackIndex !== -1 && !updatedTracks[trackIndex].available) {
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
                      id: updatedTracks[trackIndex].id,
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

                  try {
                    await metadataCacheService.saveCover(updatedTracks[trackIndex].id, blob);
                  } catch (error) {
                    logger.warn('[LibraryActions] Failed to save cover to IndexedDB:', error);
                  }
                }
              }

              metadataCacheService.set(updatedTracks[trackIndex].id, {
                title: metadata.title,
                artist: metadata.artist,
                album: metadata.album,
                duration: metadata.duration,
                lyrics: metadata.lyrics,
                syncedLyrics: metadata.syncedLyrics,
                coverData: coverSavedToDisk ? undefined : metadata.coverData,
                coverMime: coverSavedToDisk ? undefined : metadata.coverMime,
                fileName: fileName,
                fileSize: metadata.fileSize || 0,
                lastModified: Date.now(),
              });

              updatedTracks[trackIndex] = {
                ...updatedTracks[trackIndex],
                title: metadata.title,
                artist: metadata.artist,
                album: metadata.album,
                duration: metadata.duration,
                lyrics: metadata.lyrics,
                syncedLyrics: metadata.syncedLyrics,
                coverUrl: coverUrl,
                filePath: filePath,  // Store the original path directly
                fileName: fileName,
                fileSize: metadata.fileSize || updatedTracks[trackIndex].fileSize,
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
