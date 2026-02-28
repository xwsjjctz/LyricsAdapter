import { useCallback, useEffect, useRef } from 'react';
import { Track } from '../types';
import { parseAudioFile, libraryStorage } from '../services/metadataService';
import { getDesktopAPIAsync, isDesktop, type DesktopAPI } from '../services/desktopAdapter';
import { metadataCacheService } from '../services/metadataCacheService';
import { buildLibraryIndexData } from '../services/librarySerializer';
import { indexedDBStorage } from '../services/indexedDBStorage';
import { logger } from '../services/logger';

interface UseImportOptions {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentTrackIndex: number;
  isPlaying: boolean;
  currentTrack: Track | null;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  currentTime: number;
  createTrackedBlobUrl: (blob: Blob | File) => string;
  persistedTimeRef: React.MutableRefObject<number>;
}

export function useImport({
  tracks,
  setTracks,
  currentTrackIndex,
  isPlaying,
  currentTrack,
  volume,
  playbackMode,
  currentTime,
  createTrackedBlobUrl,
  persistedTimeRef
}: UseImportOptions) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tracksCountRef = useRef<number>(0);

  useEffect(() => {
    tracksCountRef.current = tracks.length;
    logger.debug(`[Import] tracksCountRef synced to: ${tracks.length}`);
  }, [tracks.length]);

  const createTracksMap = useCallback(() => {
    return new Map(
      tracks.map(track => {
        const key = track.fileName
          ? track.fileName
          : `${track.file?.name}-${track.file?.size}`;
        return [key, track];
      })
    );
  }, [tracks]);

  // Process file paths directly (new path-based import - no file copying)
  const processDesktopFilePathBatch = useCallback(async (
    filePaths: { path: string; name: string }[],
    desktopAPI: DesktopAPI,
    tracksMap: Map<string, Track>
  ): Promise<Track[]> => {
    const results = await Promise.all(
      filePaths.map(async ({ path: filePath, name: fileName }) => {
        const existingTrack = tracksMap.get(fileName);
        if (existingTrack) {
          logger.debug(`[Import] 🔄 File "${fileName}" already exists (ID: ${existingTrack.id}), will reuse ID`);
        } else {
          logger.debug(`[Import] 🆕 File "${fileName}" is new, creating new track`);
        }

        let metadata;
        try {
          const parseResult = await desktopAPI.parseAudioMetadata(filePath);
          if (parseResult.success && parseResult.metadata) {
            metadata = parseResult.metadata;
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

              try {
                await metadataCacheService.saveCover(trackId, blob);
              } catch (error) {
                logger.warn('[Import] Failed to save cover to IndexedDB:', error);
              }
            } catch (error) {
              logger.error('[Import] Failed to create cover blob:', error);
            }
          }
        }

        if (metadata) {
          metadataCacheService.set(trackId, {
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

  // Process files from buffer (for drag-and-drop in Electron)
  const processDesktopFileBatchFromBuffer = useCallback(async (
    files: File[],
    desktopAPI: any,
    tracksMap: Map<string, Track>
  ): Promise<Track[]> => {
    const results = await Promise.all(
      files.map(async (file) => {
        const fileName = file.name;

        const existingTrack = tracksMap.get(fileName);
        if (existingTrack) {
          logger.debug(`[Import] 🔄 File "${fileName}" already exists (ID: ${existingTrack.id}), will reuse ID`);
        } else {
          logger.debug(`[Import] 🆕 File "${fileName}" is new, creating new track`);
        }

        let savedFilePath = '';
        try {
          // Read file as ArrayBuffer
          const arrayBuffer = await file.arrayBuffer();
          const saveResult = await desktopAPI.saveAudioFileFromBuffer(fileName, arrayBuffer);
          if (saveResult?.success && saveResult?.filePath) {
            savedFilePath = saveResult.filePath;
            logger.debug(`[Import] ✅ File saved from buffer: ${fileName} → ${savedFilePath} (${saveResult.method})`);
          } else {
            logger.warn(`[Import] ⚠️ saveAudioFileFromBuffer failed for "${fileName}":`, saveResult);
          }
        } catch (error) {
          logger.error(`[Import] ❌ Failed to save file "${fileName}":`, error);
          return null;
        }

        if (!savedFilePath) {
          logger.error(`[Import] ❌ saveAudioFileFromBuffer returned empty path for "${fileName}"`);
          return null;
        }

        let metadata;
        try {
          const parseResult = await desktopAPI.parseAudioMetadata(savedFilePath);
          if (parseResult.success && parseResult.metadata) {
            metadata = parseResult.metadata;
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

              try {
                await metadataCacheService.saveCover(trackId, blob);
              } catch (error) {
                logger.warn('[Import] Failed to save cover to IndexedDB:', error);
              }
            } catch (error) {
              logger.error('[Import] Failed to create cover blob:', error);
            }
          }
        }

        if (metadata) {
          metadataCacheService.set(trackId, {
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
          filePath: savedFilePath,
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
    logger.debug(`[Import] Buffer Batch complete: ${results.length} total, ${filtered.length} successful, ${results.length - filtered.length} failed`);
    return filtered;
  }, [createTrackedBlobUrl]);

  const processWebFileBatch = useCallback(async (
    files: File[],
    tracksMap: Map<string, Track>
  ): Promise<Track[]> => {
    const results = await Promise.all(
      files.map(async (file) => {
        const key = `${file.name}-${file.size}`;
        const existingTrack = tracksMap.get(key);

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

      // Filter out already imported files
      const newFilePaths = filePaths.filter(filePath => {
        const fileName = filePath.split(/[/\\]/).pop() || '';
        if (tracksMap.has(fileName)) {
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

      if (totalFailed > 0) {
        logger.error(`[Import] ⚠️ ${totalFailed} file(s) failed to import! Check console above for details.`);
      } else {
        logger.debug(`[Import] ✓ All files imported successfully`);
      }

      logger.debug('[Import] Manually triggering library save after import...');
      logger.debug(`[Import] Saving ${tracks.length} tracks to disk...`);
      const libraryData = buildLibraryIndexData(finalTracks, {
        volume: volume,
        currentTrackIndex: currentTrackIndex,
        currentTrackId: currentTrack?.id,
        currentTime: persistedTimeRef.current || currentTime,
        isPlaying: isPlaying,
        playbackMode: playbackMode
      });
      await libraryStorage.saveLibrary(libraryData);
      logger.debug('[Import] ✓ Manual library save completed');
    } catch (error) {
      logger.error('[Import] Failed to import files:', error);
    }
  }, [
    createTracksMap,
    currentTime,
    currentTrack,
    currentTrackIndex,
    isPlaying,
    playbackMode,
    processDesktopFileBatch,
    tracks,
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

    // Filter out already imported files
    const newFilePaths = filePaths.filter(({ name }) => {
      if (tracksMap.has(name)) {
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
    const libraryData = buildLibraryIndexData(finalTracks, {
      volume: volume,
      currentTrackIndex: currentTrackIndex,
      currentTrackId: currentTrack?.id,
      currentTime: persistedTimeRef.current || currentTime,
      isPlaying: isPlaying,
      playbackMode: playbackMode
    });
    await libraryStorage.saveLibrary(libraryData);
    logger.debug('[Import] ✓ Drop import with persistence completed');

    logger.debug(`[Import] ===== Import Summary =====`);
    logger.debug(`[Import] Total processed: ${totalProcessed}`);
    logger.debug(`[Import] Successfully imported: ${totalProcessed - totalFailed}`);
    logger.debug(`[Import] Failed: ${totalFailed}`);
  }, [
    createTracksMap,
    processDesktopFilePathBatch,
    setTracks,
    tracks,
    currentTrackIndex,
    currentTrack,
    currentTime,
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

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      logger.debug(`[Import] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)} (${batch.length} files)`);

      const batchTracks = await processWebFileBatch(batch, tracksMap);
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
    const libraryData = buildLibraryIndexData(finalTracks, {
      volume: volume,
      currentTrackIndex: currentTrackIndex,
      currentTrackId: currentTrack?.id,
      currentTime: persistedTimeRef.current || currentTime,
      isPlaying: isPlaying,
      playbackMode: playbackMode
    });
    
    if (isDesktop()) {
      await libraryStorage.saveLibrary(libraryData);
      logger.debug('[Import] ✓ Library saved to disk');
    } else {
      await indexedDBStorage.saveLibrary(libraryData);
      logger.debug('[Import] ✓ Library saved to IndexedDB');
    }

    logger.debug('[Import] ✓ All files imported successfully');
  }, [
    createTracksMap,
    processWebFileBatch,
    setTracks,
    tracks,
    currentTrackIndex,
    currentTrack,
    currentTime,
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

    // Filter out already imported files
    const newFiles = files.filter(file => {
      if (tracksMap.has(file.name)) {
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

    for (let i = 0; i < newFiles.length; i += BATCH_SIZE) {
      const batch = newFiles.slice(i, i + BATCH_SIZE);
      logger.debug(`[Import] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(newFiles.length / BATCH_SIZE)} (${batch.length} files)`);

      const batchTracks = await processWebFileBatch(batch, tracksMap);
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
      const libraryData = buildLibraryIndexData(finalTracks, {
        volume: volume,
        currentTrackIndex: currentTrackIndex,
        currentTrackId: currentTrack?.id,
        currentTime: persistedTimeRef.current || currentTime,
        isPlaying: isPlaying,
        playbackMode: playbackMode
      });
      await indexedDBStorage.saveLibrary(libraryData);
      logger.debug('[Import] ✓ Library saved to IndexedDB');
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [createTracksMap, processWebFileBatch, setTracks, tracks, currentTrackIndex, currentTrack, currentTime, isPlaying, playbackMode, volume, persistedTimeRef]);

  return {
    fileInputRef,
    handleDesktopImport,
    handleDropFiles,
    handleDropFilePaths,
    handleFileInputChange
  };
}
