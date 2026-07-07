import { useCallback } from 'react';
import { Track } from '../types';
import { getDesktopAPIAsync } from '../services/desktopAdapter';
import { metadataCacheService } from '../services/metadataCacheService';
import { logger } from '../services/logger';

/**
 * Library file-reload hook.
 *
 * Previously this hook also exposed `handleRemoveTrack` /
 * `handleRemoveMultipleTracks`, but those were superseded by the view-slot-aware
 * removal in `useLibraryController` (Phase 2) and removed as dead code. Only
 * `handleReloadFiles` (re-scan unavailable files selected by the user) remains.
 */

interface UseLibraryActionsOptions {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  createTrackedBlobUrl: (blob: Blob | File) => string;
}

export function useLibraryActions({
  tracks,
  setTracks,
  createTrackedBlobUrl,
}: UseLibraryActionsOptions) {
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
    handleReloadFiles
  };
}
