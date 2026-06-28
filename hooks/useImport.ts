import { useCallback, useEffect, useRef, useState } from 'react';
import { Track } from '../types';
import { parseAudioFile, parseLRCLyrics, libraryStorage } from '../services/metadataService';
import { webdavClient, webdavCoverId } from '../services/webdavClient';

interface ParsedAudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  lyrics?: string;
  syncedLyrics?: { time: number; text: string }[];
  coverData?: string;
  coverMime?: string;
  fileSize?: number;
}
import { getDesktopAPIAsync, isDesktop, type DesktopAPI } from '../services/desktopAdapter';
import { metadataCacheService } from '../services/metadataCacheService';
import { buildLibraryIndexDataForSlots } from '../services/librarySerializer';
import { indexedDBStorage } from '../services/indexedDBStorage';
import { logger } from '../services/logger';
import { notify } from '../services/notificationService';
import { i18n } from '../services/i18n';
import { getDesktopImportKey, getTrackImportKeys, getUniqueWebDAVFileName, getWebFileImportKey } from '../services/importIdentity';

interface UseImportOptions {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentTrackIndex: number;
  isPlaying: boolean;
  currentTrack: Track | null;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  createTrackedBlobUrl: (blob: Blob | File) => string;
  persistedTimeRef: React.MutableRefObject<number>;
  getPersistenceData?: () => { localSlot: any; cloudSlot: any; activeSlotId: 'local' | 'cloud' };
  cloudTracks?: Track[];
  /** 云列表导入：上传到 WebDAV 后合并进 cloud slot。未提供则禁用云导入。 */
  mergeCloudTracks?: (added: Track[], removedIds: string[], updated: Track[]) => void;
}

/** 音频扩展名 → 上传 Content-Type。 */
function audioMimeFor(ext: string): string {
  switch (ext) {
    case '.mp3': return 'audio/mpeg';
    case '.flac': return 'audio/flac';
    case '.m4a': return 'audio/mp4';
    case '.wav': return 'audio/wav';
    case '.ogg': return 'audio/ogg';
    case '.aac': return 'audio/aac';
    default: return 'application/octet-stream';
  }
}
export function useImport({
  tracks,
  setTracks,
  currentTrackIndex,
  isPlaying,
  currentTrack,
  volume,
  playbackMode,
  createTrackedBlobUrl,
  persistedTimeRef,
  getPersistenceData,
  cloudTracks = [],
  mergeCloudTracks,
}: UseImportOptions) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tracksCountRef = useRef<number>(0);
  const [importProgress, setImportProgress] = useState<{ loaded: number; total: number } | null>(null);

  const buildImportSettings = useCallback(() => {
    if (getPersistenceData) {
      return getPersistenceData();
    }
    return {
      volume,
      currentTrackIndex,
      currentTrackId: currentTrack?.id,
      currentTime: persistedTimeRef.current,
      isPlaying,
      playbackMode,
    };
  }, [getPersistenceData, volume, currentTrackIndex, currentTrack, isPlaying, playbackMode]);

  useEffect(() => {
    tracksCountRef.current = tracks.length;
    logger.debug(`[Import] tracksCountRef synced to: ${tracks.length}`);
  }, [tracks.length]);

  const createTracksMap = useCallback(() => {
    const map = new Map<string, Track>();
    for (const track of tracks) {
      for (const key of getTrackImportKeys(track)) {
        if (!map.has(key)) {
          map.set(key, track);
        }
      }
    }
    return map;
  }, [tracks]);

  // Process file paths directly (new path-based import - no file copying)
  const processDesktopFilePathBatch = useCallback(async (
    filePaths: { path: string; name: string }[],
    desktopAPI: DesktopAPI,
    tracksMap: Map<string, Track>
  ): Promise<Track[]> => {
    const results = await Promise.all(
      filePaths.map(async ({ path: filePath, name: fileName }) => {
        const existingTrack = tracksMap.get(getDesktopImportKey(filePath));
        if (existingTrack) {
          logger.debug(`[Import] 🔄 File "${fileName}" already exists (ID: ${existingTrack.id}), will reuse ID`);
        } else {
          logger.debug(`[Import] 🆕 File "${fileName}" is new, creating new track`);
        }

        let metadata: ParsedAudioMetadata | undefined;
        try {
          const parseResult = await desktopAPI.parseAudioMetadata(filePath);
          if (parseResult.success && parseResult.metadata) {
            metadata = parseResult.metadata as ParsedAudioMetadata;
            logger.debug(`[Import] ✅ Parsed metadata for "${fileName}": ${metadata?.title} - ${metadata?.artist}`);
          }
        } catch (error) {
          logger.error('[Import] Failed to parse metadata:', error);
        }

        const trackId = existingTrack?.id || Math.random().toString(36).substr(2, 9);

        let coverUrl = `https://picsum.photos/seed/${encodeURIComponent(fileName)}/1000/1000`;
        let coverSavedToDisk = false;
        if (metadata?.coverData && metadata?.coverMime) {
          if (desktopAPI.saveCoverThumbnail) {
            try {
              const coverResult = await desktopAPI.saveCoverThumbnail({
                id: trackId,
                data: metadata.coverData,
                mime: metadata.coverMime
              });
              if (coverResult?.success && coverResult.coverUrl) {
                coverUrl = coverResult.coverUrl;
                coverSavedToDisk = true;
              }
            } catch (error) {
              logger.warn('[Import] Failed to save cover thumbnail to disk:', error);
            }
          }

          if (!coverSavedToDisk) {
            try {
              const byteCharacters = atob(metadata.coverData);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: metadata.coverMime });
              coverUrl = createTrackedBlobUrl(blob);


            } catch (error) {
              logger.error('[Import] Failed to create cover blob:', error);
            }
          }
        }

        if (metadata) {
          metadataCacheService.set(trackId, {
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
        }

        const track = {
          id: trackId,
          title: metadata?.title || fileName.replace(/\.[^/.]+$/, ''),
          artist: metadata?.artist || 'Unknown Artist',
          album: metadata?.album || 'Unknown Album',
          duration: metadata?.duration || 0,
          lyrics: metadata?.lyrics || '',
          syncedLyrics: metadata?.syncedLyrics,
          coverUrl: coverUrl,
          audioUrl: '',
          fileName: fileName,
          filePath: filePath,
          fileSize: metadata?.fileSize || 0,
          lastModified: Date.now(),
          addedAt: new Date().toISOString(),
          available: true
        } as Track;

        logger.debug(`[Import] ✓ Track created: ${track.title} (ID: ${track.id})`);
        return track;
      })
    );

    const filtered = results.filter((track): track is Track => track !== null);
    logger.debug(`[Import] Batch complete: ${results.length} total, ${filtered.length} successful, ${results.length - filtered.length} failed`);
    return filtered;
  }, [createTrackedBlobUrl]);

  // Legacy: Process files from paths via dialog (kept for compatibility, now uses direct paths too)
  const processDesktopFileBatch = useCallback(async (
    filePaths: string[],
    desktopAPI: any,
    tracksMap: Map<string, Track>
  ): Promise<Track[]> => {
    // Convert to the new format and use the path-based processor
    const pathObjects = filePaths.map(path => ({
      path,
      name: path.split(/[/\\]/).pop() || ''
    }));
    return processDesktopFilePathBatch(pathObjects, desktopAPI, tracksMap);
  }, [processDesktopFilePathBatch]);

  const processWebFileBatch = useCallback(async (
    files: File[],
    tracksMap: Map<string, Track>
  ): Promise<Track[]> => {
    const results = await Promise.all(
      files.map(async (file) => {
        const existingTrack = tracksMap.get(getWebFileImportKey(file));

        let metadata;
        try {
          metadata = await parseAudioFile(file);
        } catch (error) {
          logger.error('[Import] Failed to parse file:', file.name, error);
          metadata = {
            title: file.name.replace(/\.[^/.]+$/, ''),
            artist: 'Unknown Artist',
            album: 'Unknown Album',
            duration: 0,
            coverUrl: `https://picsum.photos/seed/${encodeURIComponent(file.name)}/1000/1000`,
            lyrics: '',
            syncedLyrics: undefined,
            audioUrl: '',
            file: file
          };
        }

        return {
          id: existingTrack?.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
          ...metadata,
          file: file,
          fileName: file.name,
          available: true
        } as Track;
      })
    );

    return results;
  }, []);

  const handleDesktopImport = useCallback(async () => {
    logger.debug('[Import] Desktop import triggered');
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI) {
      logger.error('[Import] Desktop API not available');
      return;
    }

    try {
      const result = await desktopAPI.selectFiles();
      if (result.canceled || result.filePaths.length === 0) {
        return;
      }

      const filePaths = result.filePaths;
      logger.debug(`[Import] Processing ${filePaths.length} file(s)...`);
      logger.debug(`[Import] Current tracks count before import (state): ${tracks.length}`);
      logger.debug(`[Import] Current tracks count before import (ref): ${tracksCountRef.current}`);

      const tracksMap = createTracksMap();
      logger.debug(`[Import] Created tracksMap with ${tracksMap.size} entries`);

      // Filter to supported audio formats only (MP3, FLAC)
      const audioExtensions = ['.mp3', '.flac'];
      const pathsFiltered = filePaths.filter(filePath => {
        const ext = '.' + filePath.split('.').pop()?.toLowerCase();
        if (!audioExtensions.includes(ext)) {
          logger.debug(`[Import] ⏭️ Skipping unsupported format: ${filePath}`);
          return false;
        }
        return true;
      });

      // Filter out already imported files
      const newFilePaths = pathsFiltered.filter(filePath => {
        const fileName = filePath.split(/[/\\]/).pop() || '';
        if (tracksMap.has(getDesktopImportKey(filePath))) {
          logger.debug(`[Import] ⏭️ Skipping already imported file: ${fileName}`);
          return false;
        }
        return true;
      });

      if (newFilePaths.length === 0) {
        logger.debug('[Import] All files already imported, skipping');
        return;
      }

      if (newFilePaths.length < filePaths.length) {
        logger.debug(`[Import] 📝 Skipped ${filePaths.length - newFilePaths.length} duplicate files`);
      }

      const BATCH_SIZE = 10;
      const UI_UPDATE_BATCH = 20;
      const allNewTracks: Track[] = [];
      const importedTracksAll: Track[] = [];
      const baseTracks = tracks;
      let totalProcessed = 0;
      let totalFailed = 0;

      logger.debug(`[Import] ===== Starting Import Process =====`);
      logger.debug(`[Import] Total files to import: ${newFilePaths.length}`);

      setImportProgress({ loaded: 0, total: newFilePaths.length });

      for (let i = 0; i < newFilePaths.length; i += BATCH_SIZE) {
        const batch = newFilePaths.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(newFilePaths.length / BATCH_SIZE);

        logger.debug(`[Import] 📦 Batch ${batchNumber}/${totalBatches}: ${batch.length} files`);
        logger.debug(`[Import] Files in this batch:`, batch.map(f => f.split(/[/\\]/).pop()));

        const batchTracks = await processDesktopFileBatch(batch, desktopAPI, tracksMap);

        const successfulTracks = batchTracks.filter((track): track is Track => track !== null);
        const failedCount = batch.length - successfulTracks.length;

        totalProcessed += batch.length;
        totalFailed += failedCount;
        setImportProgress({ loaded: totalProcessed, total: newFilePaths.length });

        logger.debug(`[Import] ✅ Batch ${batchNumber} result: ${successfulTracks.length} succeeded, ${failedCount} failed`);

        allNewTracks.push(...successfulTracks);
        importedTracksAll.push(...successfulTracks);

        if (allNewTracks.length >= UI_UPDATE_BATCH) {
          logger.debug(`[Import] 🎨 UI update threshold reached (${allNewTracks.length} tracks)`);
          logger.debug(`[Import] Current tracks count before update (state): ${tracks.length}`);
          logger.debug(`[Import] Current tracks count before update (ref): ${tracksCountRef.current}`);

          const batchSize = allNewTracks.length;

          setTracks(prev => {
            const newTracks = [...prev, ...allNewTracks];
            logger.debug(`[Import] ✏️ Updating tracks: ${prev.length} → ${newTracks.length} (added ${allNewTracks.length})`);
            return newTracks;
          });

          tracksCountRef.current = tracksCountRef.current + batchSize;
          logger.debug(`[Import] tracksCountRef updated to: ${tracksCountRef.current}`);
          logger.debug(`[Import] ✓ UI updated, scheduling batch buffer clear`);

          setTimeout(() => {
            allNewTracks.length = 0;
            logger.debug(`[Import] ✓ Batch buffer cleared`);
          }, 0);
        }
      }

      if (allNewTracks.length > 0) {
        logger.debug(`[Import] Final UI update with ${allNewTracks.length} track(s)...`);
        const finalBatchSize = allNewTracks.length;
        setTracks(prev => {
          const newTracks = [...prev, ...allNewTracks];
          logger.debug(`[Import] ✏️ Final update: ${prev.length} → ${newTracks.length} (added ${allNewTracks.length})`);
          return newTracks;
        });
        tracksCountRef.current = tracksCountRef.current + finalBatchSize;
        logger.debug(`[Import] tracksCountRef updated to: ${tracksCountRef.current}`);
      }

      const finalTracks = [...baseTracks, ...importedTracksAll];
      setTracks(finalTracks);
      tracksCountRef.current = finalTracks.length;

      await new Promise(resolve => setTimeout(resolve, 100));

      logger.debug('[Import] Saving metadata cache...');
      await metadataCacheService.save();

      logger.debug(`[Import] ===== Import Summary =====`);
      logger.debug(`[Import] Total processed: ${totalProcessed}`);
      logger.debug(`[Import] Successfully imported: ${totalProcessed - totalFailed}`);
      logger.debug(`[Import] Failed: ${totalFailed}`);

    logger.debug(`[Import] ===== Import Summary =====`);
    logger.debug(`[Import] Total processed: ${totalProcessed}`);
    logger.debug(`[Import] Successfully imported: ${totalProcessed - totalFailed}`);
    logger.debug(`[Import] Failed: ${totalFailed}`);

    if (totalFailed > 0) {
        logger.error(`[Import] ⚠️ ${totalFailed} file(s) failed to import! Check console above for details.`);
        notify(
          i18n.t('notifications.importComplete'),
          i18n.t('notifications.importPartialCount').replace('{success}', String(totalProcessed - totalFailed)).replace('{failed}', String(totalFailed))
        );
      } else {
        logger.debug(`[Import] ✓ All files imported successfully`);
        notify(
          i18n.t('notifications.importComplete'),
          i18n.t('notifications.importSuccessCount').replace('{count}', String(totalProcessed))
        );
      }

      logger.debug('[Import] Manually triggering library save after import...');
      logger.debug(`[Import] Saving ${tracks.length} tracks to disk...`);
      const libraryData = buildLibraryIndexDataForSlots(finalTracks, cloudTracks, buildImportSettings());
      await libraryStorage.saveLibrary(libraryData);
      logger.debug('[Import] ✓ Manual library save completed');
      setImportProgress(null);
    } catch (error) {
      logger.error('[Import] Failed to import files:', error);
      setImportProgress(null);
    }
  }, [
    createTracksMap,
    currentTrack,
    currentTrackIndex,
    isPlaying,
    playbackMode,
    processDesktopFileBatch,
    tracks,
    cloudTracks,
    volume,
    persistedTimeRef
  ]);

  // Handle dropped file paths (Electron mode with getPathForFile)
  const handleDropFilePaths = useCallback(async (filePaths: { path: string; name: string }[]) => {
    logger.debug('[Import] Drop file paths triggered');
    logger.debug(`[Import] Processing ${filePaths.length} file path(s)...`);

    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI) {
      logger.error('[Import] Desktop API not available');
      return;
    }

    const tracksMap = createTracksMap();

    // Filter to supported audio formats only (MP3, FLAC)
    const audioExtensions = ['.mp3', '.flac'];
    const pathsFiltered = filePaths.filter(({ name }) => {
      const ext = '.' + name.split('.').pop()?.toLowerCase();
      if (!audioExtensions.includes(ext)) {
        logger.debug(`[Import] ⏭️ Skipping unsupported format: ${name}`);
        return false;
      }
      return true;
    });

    // Filter out already imported files
    const newFilePaths = pathsFiltered.filter(({ path, name }) => {
      if (tracksMap.has(getDesktopImportKey(path))) {
        logger.debug(`[Import] ⏭️ Skipping already imported file: ${name}`);
        return false;
      }
      return true;
    });

    if (newFilePaths.length === 0) {
      logger.debug('[Import] All files already imported, skipping');
      return;
    }

    if (newFilePaths.length < filePaths.length) {
      logger.debug(`[Import] 📝 Skipped ${filePaths.length - newFilePaths.length} duplicate files`);
    }

    const BATCH_SIZE = 10;
    const UI_UPDATE_BATCH = 20;
    const allNewTracks: Track[] = [];
    const importedTracksAll: Track[] = [];
    const baseTracks = tracks;
    let totalProcessed = 0;
    let totalFailed = 0;

    logger.debug(`[Import] ===== Starting Path-based Import =====`);
    logger.debug(`[Import] Total files to import: ${newFilePaths.length}`);

    setImportProgress({ loaded: 0, total: newFilePaths.length });

    for (let i = 0; i < newFilePaths.length; i += BATCH_SIZE) {
      const batch = newFilePaths.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(newFilePaths.length / BATCH_SIZE);

      logger.debug(`[Import] 📦 Batch ${batchNumber}/${totalBatches}: ${batch.length} files`);

      const batchTracks = await processDesktopFilePathBatch(batch, desktopAPI, tracksMap);
      const successfulTracks = batchTracks.filter((track): track is Track => track !== null);
      const failedCount = batch.length - successfulTracks.length;

      totalProcessed += batch.length;
      totalFailed += failedCount;
      setImportProgress({ loaded: totalProcessed, total: newFilePaths.length });

      allNewTracks.push(...successfulTracks);
      importedTracksAll.push(...successfulTracks);

      if (allNewTracks.length >= UI_UPDATE_BATCH) {
        const batchSize = allNewTracks.length;
        setTracks(prev => [...prev, ...allNewTracks]);
        allNewTracks.length = 0;
        tracksCountRef.current = tracksCountRef.current + batchSize;
      }
    }

    if (allNewTracks.length > 0) {
      setTracks(prev => [...prev, ...allNewTracks]);
      tracksCountRef.current = tracksCountRef.current + allNewTracks.length;
    }

    // Deduplicate tracks by id (in case some files were already in the library)
    const trackMap = new Map<string, Track>();
    for (const track of baseTracks) {
      trackMap.set(track.id, track);
    }
    for (const track of importedTracksAll) {
      trackMap.set(track.id, track);
    }
    const finalTracks = Array.from(trackMap.values());
    setTracks(finalTracks);

    // Save metadata cache and library
    await metadataCacheService.save();

    logger.debug('[Import] Saving library after drop import...');
    const libraryData = buildLibraryIndexDataForSlots(finalTracks, cloudTracks, buildImportSettings());
    await libraryStorage.saveLibrary(libraryData);
    logger.debug('[Import] ✓ Drop import with persistence completed');

    logger.debug(`[Import] ===== Import Summary =====`);
    logger.debug(`[Import] Total processed: ${totalProcessed}`);
    logger.debug(`[Import] Successfully imported: ${totalProcessed - totalFailed}`);
    logger.debug(`[Import] Failed: ${totalFailed}`);

    if (totalFailed > 0) {
      notify(
        i18n.t('notifications.importComplete'),
        i18n.t('notifications.importPartialCount').replace('{success}', String(totalProcessed - totalFailed)).replace('{failed}', String(totalFailed))
      );
    } else if (totalProcessed > 0) {
      notify(
        i18n.t('notifications.importComplete'),
        i18n.t('notifications.importSuccessCount').replace('{count}', String(totalProcessed))
      );
    }
    setImportProgress(null);
  }, [
    createTracksMap,
    processDesktopFilePathBatch,
    setTracks,
    tracks,
    cloudTracks,
    currentTrackIndex,
    currentTrack,
    isPlaying,
    playbackMode,
    volume,
    persistedTimeRef
  ]);

  // Handle dropped File objects (Web mode or Electron fallback)
  const handleDropFiles = useCallback(async (files: File[]) => {
    logger.debug('[Import] Drop files triggered (File objects)');
    logger.debug(`[Import] Processing ${files.length} file(s)...`);
    logger.debug(`[Import] Platform: ${isDesktop() ? 'Electron' : 'Web'}`);

    // Web mode: use File object processing
    logger.warn('[Import] Web mode drop import - with persistence');
    const tracksMap = createTracksMap();

    const BATCH_SIZE = 10;
    const UI_UPDATE_BATCH = 20;
    const allNewTracks: Track[] = [];
    const importedTracksAll: Track[] = [];
    const baseTracks = tracks;
    let totalProcessed = 0;

    setImportProgress({ loaded: 0, total: files.length });

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      logger.debug(`[Import] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)} (${batch.length} files)`);

      const batchTracks = await processWebFileBatch(batch, tracksMap);
      totalProcessed += batch.length;
      setImportProgress({ loaded: totalProcessed, total: files.length });
      allNewTracks.push(...batchTracks);
      importedTracksAll.push(...batchTracks);

      if (allNewTracks.length >= UI_UPDATE_BATCH) {
        logger.debug(`[Import] Updating UI with ${allNewTracks.length} new track(s)...`);
        setTracks(prev => [...prev, ...allNewTracks]);
        allNewTracks.length = 0;
      }
    }

    if (allNewTracks.length > 0) {
      logger.debug(`[Import] Final UI update with ${allNewTracks.length} track(s)...`);
      setTracks(prev => [...prev, ...allNewTracks]);
    }

    // Deduplicate tracks by id (in case some files were already in the library)
    const trackMap = new Map<string, Track>();
    for (const track of baseTracks) {
      trackMap.set(track.id, track);
    }
    for (const track of importedTracksAll) {
      trackMap.set(track.id, track);
    }
    const finalTracks = Array.from(trackMap.values());
    setTracks(finalTracks);
    
    // Save library - use disk storage in Electron, IndexedDB in web
    const libraryData = buildLibraryIndexDataForSlots(finalTracks, cloudTracks, buildImportSettings());
    
    if (isDesktop()) {
      await libraryStorage.saveLibrary(libraryData);
      logger.debug('[Import] ✓ Library saved to disk');
    } else {
      await indexedDBStorage.saveLibrary(libraryData);
      logger.debug('[Import] ✓ Library saved to IndexedDB');
    }

    logger.debug('[Import] ✓ All files imported successfully');
    setImportProgress(null);
  }, [
    createTracksMap,
    processWebFileBatch,
    setTracks,
    tracks,
    cloudTracks,
    currentTrackIndex,
    currentTrack,
    isPlaying,
    playbackMode,
    volume,
    persistedTimeRef
  ]);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    logger.debug('[Import] File input changed - platform:', isDesktop() ? 'Electron' : 'Web');
    logger.debug(`[Import] Processing ${files.length} file(s)...`);

    const tracksMap = createTracksMap();

    // Filter to supported audio formats only (MP3, FLAC)
    const audioExtensions = ['.mp3', '.flac'];
    const filesFiltered = files.filter(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!audioExtensions.includes(ext)) {
        logger.debug(`[Import] ⏭️ Skipping unsupported format: ${file.name}`);
        return false;
      }
      return true;
    });

    // Filter out already imported files
    const newFiles = filesFiltered.filter(file => {
      if (tracksMap.has(getWebFileImportKey(file))) {
        logger.debug(`[Import] ⏭️ Skipping already imported file: ${file.name}`);
        return false;
      }
      return true;
    });

    if (newFiles.length === 0) {
      logger.debug('[Import] All files already imported, skipping');
      return;
    }

    if (newFiles.length < files.length) {
      logger.debug(`[Import] 📝 Skipped ${files.length - newFiles.length} duplicate files`);
    }

    const BATCH_SIZE = 10;
    const UI_UPDATE_BATCH = 20;
    const allNewTracks: Track[] = [];
    let totalProcessed = 0;

    setImportProgress({ loaded: 0, total: newFiles.length });

    for (let i = 0; i < newFiles.length; i += BATCH_SIZE) {
      const batch = newFiles.slice(i, i + BATCH_SIZE);
      logger.debug(`[Import] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(newFiles.length / BATCH_SIZE)} (${batch.length} files)`);

      const batchTracks = await processWebFileBatch(batch, tracksMap);
      totalProcessed += batch.length;
      setImportProgress({ loaded: totalProcessed, total: newFiles.length });
      allNewTracks.push(...batchTracks);

      if (allNewTracks.length >= UI_UPDATE_BATCH) {
        logger.debug(`[Import] Updating UI with ${allNewTracks.length} new track(s)...`);
        setTracks(prev => [...prev, ...allNewTracks]);
        allNewTracks.length = 0;
      }
    }

    if (allNewTracks.length > 0) {
      logger.debug(`[Import] Final UI update with ${allNewTracks.length} track(s)...`);
      setTracks(prev => [...prev, ...allNewTracks]);
    }

    logger.debug('[Import] ✓ All files imported successfully');

    // Save to IndexedDB in browser mode
    if (!isDesktop()) {
      const finalTracks = [...tracks, ...allNewTracks];
      const libraryData = buildLibraryIndexDataForSlots(finalTracks, cloudTracks, buildImportSettings());
      await indexedDBStorage.saveLibrary(libraryData);
      logger.debug('[Import] ✓ Library saved to IndexedDB');
    }

    setImportProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [createTracksMap, processWebFileBatch, setTracks, tracks, cloudTracks, currentTrackIndex, currentTrack, isPlaying, playbackMode, volume, persistedTimeRef]);

  const handleCloudDropFilePaths = useCallback(async (filePaths: { path: string; name: string }[]) => {
    logger.debug('[Import] Cloud path import (upload to WebDAV) triggered');
    if (!mergeCloudTracks) {
      logger.warn('[Import] mergeCloudTracks not provided, cannot import to cloud');
      return;
    }
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI) {
      logger.error('[Import] Desktop API not available');
      return;
    }

    if (filePaths.length === 0) return;

    try {
      setImportProgress({ loaded: 0, total: filePaths.length });

      const added: Track[] = [];
      let failed = 0;
      const remoteFiles = await webdavClient.listFiles('/');
      const existingCloudNames = new Set(
        remoteFiles
          .filter(file => !file.isDirectory)
          .map(file => file.name)
      );

      for (let i = 0; i < filePaths.length; i++) {
        const { path: filePath, name } = filePaths[i]!;
        const fileName = name || filePath.split(/[/\\]/).pop() || '';
        try {
          const remoteFileName = getUniqueWebDAVFileName(fileName, existingCloudNames);
          existingCloudNames.add(remoteFileName);

          // 1. 解析元数据（标题/艺人/时长/封面/歌词）
          let meta: ParsedAudioMetadata | undefined;
          try {
            const parseResult = await desktopAPI.parseAudioMetadata(filePath);
            if (parseResult.success && parseResult.metadata) {
              meta = parseResult.metadata as ParsedAudioMetadata;
            }
          } catch (err) {
            logger.warn(`[Import] Failed to parse metadata for ${fileName}:`, err);
          }

          // 2. 读取文件字节
          const readResult = await desktopAPI.readFile(filePath);
          if (!readResult?.success || !readResult.data) {
            throw new Error('Failed to read file');
          }

          // 3. 上传到 WebDAV 根目录
          const ext = remoteFileName.toLowerCase().substring(remoteFileName.lastIndexOf('.'));
          const webdavPath = `/${remoteFileName}`;
          const uploadRes = await webdavClient.uploadFile(webdavPath, readResult.data, audioMimeFor(ext));
          if (!uploadRes.success) {
            throw new Error(uploadRes.error || 'Upload failed');
          }

          // 4. 封面落盘（与云扫描复用同一 cover id，避免重复）
          let coverUrl: string | undefined;
          if (meta?.coverData && meta?.coverMime && desktopAPI.saveCoverThumbnail) {
            try {
              const coverResult = await desktopAPI.saveCoverThumbnail({
                id: webdavCoverId(webdavPath),
                data: meta.coverData,
                mime: meta.coverMime,
              });
              if (coverResult?.success && coverResult.coverUrl) coverUrl = coverResult.coverUrl;
            } catch (err) {
              logger.warn(`[Import] Failed to save cover for ${fileName}:`, err);
            }
          }

          // 5. 组装云 Track 并合并
          // 解析同步歌词：优先 SYLT（meta.syncedLyrics）；缺失则把 LRC 文本歌词
          // （USLT 里存了 [mm:ss.xx] 标记）解析成时间戳数组。保证上传后立即逐行显示，
          // 与刷新后扫描结果一致——否则 FocusMode 会把原始歌词当纯文本渲染（无时间戳）。
          let syncedLyrics = meta?.syncedLyrics;
          if (!syncedLyrics && meta?.lyrics) {
            const parsed = parseLRCLyrics(meta.lyrics);
            if (parsed.syncedLyrics) syncedLyrics = parsed.syncedLyrics;
          }
          added.push({
            id: `webdav-${webdavPath}`,
            title: meta?.title || fileName.replace(/\.[^/.]+$/, ''),
            artist: meta?.artist || 'Unknown Artist',
            album: meta?.album || 'Unknown Album',
            duration: meta?.duration || 0,
            audioUrl: '',
            source: 'webdav',
            webdavPath,
            fileName: remoteFileName,
            fileSize: meta?.fileSize || readResult.data.byteLength,
            // 上传时间作为排序键：刚上传=最新，排序后落在列表最底部（与刷新后扫描值一致）。
            lastModified: Date.now(),
            ...(meta?.lyrics != null && { lyrics: meta.lyrics }),
            ...(syncedLyrics != null && { syncedLyrics }),
            coverUrl: coverUrl || `https://picsum.photos/seed/${encodeURIComponent(remoteFileName)}/1000/1000`,
          } as Track);
          logger.debug(`[Import] ✓ Uploaded to WebDAV: ${remoteFileName}`);
        } catch (err) {
          failed++;
          logger.error(`[Import] Failed to import ${fileName} to WebDAV:`, err);
        }
        setImportProgress({ loaded: i + 1, total: filePaths.length });
      }

      if (added.length > 0) {
        mergeCloudTracks(added, [], []);
      }

      if (failed > 0) {
        notify(
          i18n.t('notifications.uploadFailed'),
          i18n.t('notifications.importPartialCount').replace('{success}', String(added.length)).replace('{failed}', String(failed))
        );
      } else if (added.length > 0) {
        notify(
          i18n.t('notifications.uploadComplete'),
          i18n.t('notifications.importSuccessCount').replace('{count}', String(added.length))
        );
      }
      setImportProgress(null);
    } catch (error) {
      logger.error('[Import] Cloud path import failed:', error);
      setImportProgress(null);
    }
  }, [mergeCloudTracks]);

  /**
   * 云列表导入：选择本地音频 → 上传到 WebDAV 根目录 → 合并进 cloud slot。
   * 仅桌面端可用。同名文件 PUT 覆盖、mergeCloudTracks 按 id 去重（与 QQ 上传一致）。
   */
  const handleCloudImport = useCallback(async () => {
    logger.debug('[Import] Cloud import (upload to WebDAV) triggered');
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI) {
      logger.error('[Import] Desktop API not available');
      return;
    }

    try {
      const result = await desktopAPI.selectFiles();
      if (result.canceled || result.filePaths.length === 0) return;

      await handleCloudDropFilePaths(result.filePaths.map(filePath => ({
        path: filePath,
        name: filePath.split(/[/\\]/).pop() || '',
      })));
    } catch (error) {
      logger.error('[Import] Cloud import failed:', error);
      setImportProgress(null);
    }
  }, [handleCloudDropFilePaths]);

  return {
    fileInputRef,
    handleDesktopImport,
    handleCloudImport,
    handleCloudDropFilePaths,
    handleDropFiles,
    handleDropFilePaths,
    handleFileInputChange,
    importProgress
  };
}
