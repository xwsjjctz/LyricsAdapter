
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Track, ViewMode } from './types';
import { parseAudioFile, libraryStorage } from './services/metadataService';
import { getDesktopAPIAsync, isDesktop } from './services/desktopAdapter';
import { metadataCacheService } from './services/metadataCacheService';
import { logger } from './services/logger';
import { buildLibraryData } from './services/librarySerializer';

// Components
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import LibraryView from './components/LibraryView';
import Controls from './components/Controls';
import FocusMode from './components/FocusMode';
import ErrorBoundary from './components/ErrorBoundary';

// Electron API type (for backwards compatibility)
declare global {
  interface Window {
    electron?: {
      platform: string;
      readFile: (filePath: string) => Promise<{ success: boolean; data: ArrayBuffer; error?: string }>;
      checkFileExists: (filePath: string) => Promise<boolean>;
      selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      loadLibrary: () => Promise<{ success: boolean; library: any; error?: string }>;
      saveLibrary: (library: any) => Promise<{ success: boolean; error?: string }>;
      validateFilePath: (filePath: string) => Promise<boolean>;
      validateAllPaths: (songs: any[]) => Promise<{ success: boolean; results: any[]; error?: string }>;
      saveAudioFile: (sourcePath: string, fileName: string) => Promise<{ success: boolean; filePath?: string; method?: string; error?: string }>;
      saveAudioFileFromBuffer: (fileName: string, fileData: ArrayBuffer) => Promise<{ success: boolean; filePath?: string; method?: string; error?: string }>;
      deleteAudioFile: (filePath: string) => Promise<{ success: boolean; deleted?: boolean; error?: string }>;
      cleanupOrphanAudio: (keepPaths: string[]) => Promise<{ success: boolean; removed?: number; error?: string }>;
      // Window control APIs
      minimizeWindow?: () => void;
      maximizeWindow?: () => void;
      closeWindow?: () => void;
      isMaximized?: () => boolean;
    };
  }
}

// Check if running in Electron (for backwards compatibility)
const isElectron = () => {
  return window.electron !== undefined;
};


const App: React.FC = () => {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.5); // Lower default volume
  const [playbackMode, setPlaybackMode] = useState<'order' | 'shuffle' | 'repeat-one'>('order');
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.PLAYER);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [forceUpdateCounter, setForceUpdateCounter] = useState(0); // Force re-render after restore

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shouldAutoPlayRef = useRef<boolean>(false); // Track if we should auto-play after track loads
  const waitingForCanPlayRef = useRef<boolean>(false); // Track if we're waiting for canplay event
  const restoredTimeRef = useRef<number>(0); // Track the restored playback time
  const restoredTrackIdRef = useRef<string | null>(null); // Track which song the restored time applies to
  const tracksCountRef = useRef<number>(0); // Track actual tracks count for immediate access after deletion
  const prevAudioUrlRef = useRef<string | null>(null); // Track previous audio URL for cleanup
  const audioUrlReadyRef = useRef<boolean>(false); // Track if audio URL is ready for playback
  const persistedTimeRef = useRef<number>(0); // Throttled time for persistence
  const forcePlayRef = useRef<boolean>(false); // Strong user intent to play after track change
  const lastNonZeroVolumeRef = useRef<number>(0.5);
  const cleanupOrphanAudio = useCallback(async (remainingTracks: Track[]) => {
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI || desktopAPI.platform !== 'electron') return;
    const keepPaths = remainingTracks
      .map(t => (t as any).filePath)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    try {
      await desktopAPI.cleanupOrphanAudio(keepPaths);
    } catch (e) {
      logger.warn('[App] cleanupOrphanAudio failed:', e);
    }
  }, []);

  const getRandomIndex = useCallback((exclude: number, length: number) => {
    if (length <= 1) return exclude;
    let next = exclude;
    while (next === exclude) {
      next = Math.floor(Math.random() * length);
    }
    return next;
  }, []);

  // Convert linear volume (0-1) to exponential volume for better human perception
  // This makes low volumes quieter and high volumes maintain their loudness
  const linearToExponentialVolume = useCallback((linearVolume: number): number => {
    // Use square curve: linear^2 gives smoother low-end
    // This means:
    // - 50% UI → 25% actual volume
    // - 70% UI → 49% actual volume
    // - 100% UI → 100% actual volume
    return linearVolume * linearVolume;
  }, []);

  // Callback ref to ensure volume is set when audio element is created
  const setAudioRef = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    if (node) {
      const actualVolume = linearToExponentialVolume(volume);
      logger.debug('Audio element created, setting volume to:', volume, '(actual:', actualVolume.toFixed(3), ')');
      node.volume = actualVolume;
    }
  }, [volume, linearToExponentialVolume]);

  // Initialize Desktop API on mount
  useEffect(() => {
    const initDesktopAPI = async () => {
      logger.debug('[App] Initializing Desktop API...');
      try {
        const api = await getDesktopAPIAsync();
        if (api) {
          logger.debug('[App] ✓ Desktop API initialized, platform:', api.platform);
        } else {
          logger.debug('[App] No Desktop API available (running in browser)');
        }
      } catch (error) {
        logger.error('[App] Failed to initialize Desktop API:', error);
      }
    };

    initDesktopAPI();

    // Cleanup: revoke all blob URLs on unmount
    return () => {
      logger.debug('[App] Cleaning up', activeBlobUrlsRef.current.size, 'blob URLs...');
      activeBlobUrlsRef.current.forEach(blobUrl => {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch (e) {
          // Ignore errors during cleanup
        }
      });
      activeBlobUrlsRef.current.clear();
      logger.debug('[App] ✓ All blob URLs revoked');

      // Also revoke IndexedDB cached blob URLs
      metadataCacheService.revokeAllBlobUrls();
    };
  }, []);

  const currentTrack = currentTrackIndex >= 0 ? tracks[currentTrackIndex] : null;

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !currentTrack) return;
    if (isPlaying) {
      shouldAutoPlayRef.current = false;
      forcePlayRef.current = false;
      audioRef.current.pause();
    } else {
      shouldAutoPlayRef.current = true;
      forcePlayRef.current = true;
      audioRef.current.play().catch(e => logger.error("Playback failed", e));
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, currentTrack]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current && currentTrack) {
      // Always update duration from audio element if metadata missed it or to be precise
      setTracks(prev => {
        const newTracks = [...prev];
        if (newTracks[currentTrackIndex] && audioRef.current) {
          newTracks[currentTrackIndex] = {
            ...newTracks[currentTrackIndex],
            duration: audioRef.current.duration
          };
        }
        return newTracks;
      });

      // Restore playback time once metadata is ready
      if (restoredTimeRef.current > 0) {
        // Only restore if this is the same track we saved
        if (restoredTrackIdRef.current && restoredTrackIdRef.current !== currentTrack.id) {
          return;
        }

        const duration = audioRef.current.duration || 0;
        const restoreTime = Math.max(0, Math.min(restoredTimeRef.current, Math.max(0, duration - 0.5)));
        logger.debug('[App] Restoring playback time:', restoreTime);

        audioRef.current.currentTime = restoreTime;
        setCurrentTime(restoreTime);
        restoredTimeRef.current = 0;
        restoredTrackIdRef.current = null;
      }
    }
  };

  const handleTrackEnded = useCallback(() => {
    if (tracks.length === 0) return;

    if (playbackMode === 'repeat-one') {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        shouldAutoPlayRef.current = true;
        forcePlayRef.current = true;
        audioRef.current.play().catch(() => {
          setIsPlaying(false);
        });
        setIsPlaying(true);
      }
      return;
    }

    if (playbackMode === 'shuffle') {
      const nextIndex = getRandomIndex(currentTrackIndex, tracks.length);
      shouldAutoPlayRef.current = true;
      forcePlayRef.current = true;
      setCurrentTrackIndex(nextIndex);
      return;
    }

    if (currentTrackIndex < tracks.length - 1) {
      // Mark that we should auto-play the next track
      shouldAutoPlayRef.current = true;
      forcePlayRef.current = true;
      setCurrentTrackIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
    }
  }, [currentTrackIndex, tracks.length, playbackMode, getRandomIndex]);

  // Track current blob URLs for cleanup
  const activeBlobUrlsRef = useRef<Set<string>>(new Set());
  const prevTrackBlobUrlRef = useRef<{ id: string | null; url: string | null }>({ id: null, url: null });

  // Helper function to create and track blob URL
  const createTrackedBlobUrl = (blob: Blob | File): string => {
    const blobUrl = URL.createObjectURL(blob);
    activeBlobUrlsRef.current.add(blobUrl);
    logger.debug('[App] Created blob URL:', blobUrl, 'Total active:', activeBlobUrlsRef.current.size);
    return blobUrl;
  };

  // Helper function to revoke blob URL
  const revokeBlobUrl = (blobUrl: string) => {
    if (blobUrl && blobUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(blobUrl);
        activeBlobUrlsRef.current.delete(blobUrl);
        logger.debug('[App] Revoked blob URL:', blobUrl, 'Remaining:', activeBlobUrlsRef.current.size);
      } catch (e) {
        logger.warn('[App] Failed to revoke blob URL:', blobUrl, e);
      }
    }
  };

  // Clean up blob URLs that are no longer in tracks (optional, for memory management)
  const cleanupUnusedBlobUrls = useCallback(() => {
    const currentUrls = new Set(
      tracks
        .filter(t => t.audioUrl && t.audioUrl.startsWith('blob:'))
        .map(t => t.audioUrl)
    );

    const toRevoke: string[] = [];
    activeBlobUrlsRef.current.forEach(url => {
      if (!currentUrls.has(url)) {
        toRevoke.push(url);
      }
    });

    logger.debug(`[App] Cleaning up ${toRevoke.length} unused blob URLs...`);
    toRevoke.forEach(url => revokeBlobUrl(url));
  }, [tracks]);

  // Helper function to load audio file for a track (lazy loading)
  const loadAudioFileForTrack = useCallback(async (track: Track): Promise<Track> => {
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI || !(track as any).filePath || track.audioUrl) {
      return track; // Already loaded or no desktop API
    }

    try {
      logger.debug('[App] Loading audio file for:', track.title, `(${desktopAPI.platform})`);

      // Electron: use readFile with blob URL
      logger.debug('[App] Using blob URL protocol');
      const readResult = await desktopAPI.readFile((track as any).filePath);

      if (readResult.success && readResult.data.byteLength > 0) {
        const fileData = new Uint8Array(readResult.data);
        const file = new File([fileData], (track as any).fileName, { type: 'audio/flac' });
        const audioUrl = createTrackedBlobUrl(file);

        logger.debug('[App] ✓ Audio loaded, size:', (fileData.length / 1024 / 1024).toFixed(2), 'MB');

        return {
          ...track,
          audioUrl: audioUrl,
          // Don't store File object - blob URL is enough
        };
      } else {
        logger.error('[App] Failed to load audio file:', readResult.error);
        return track;
      }
    } catch (error) {
      logger.error('[App] Failed to load audio file:', error);
      return track;
    }
  }, []);

  // ========== Performance Optimization Helpers ==========

  // Create a Map for O(1) duplicate checking
  const createTracksMap = useCallback(() => {
    return new Map(
      tracks.map(track => {
        // For Desktop: use fileName, for Web: use file.name
        const key = (track as any).fileName
          ? `${(track as any).fileName}`
          : `${track.file?.name}-${track.file?.size}`;
        return [key, track];
      })
    );
  }, [tracks]);

  // Process a batch of files in parallel
  const processDesktopFileBatch = useCallback(async (
    filePaths: string[],
    desktopAPI: any,
    tracksMap: Map<string, Track>
  ): Promise<Track[]> => {
    const results = await Promise.all(
      filePaths.map(async (filePath) => {
        const fileName = filePath.split(/[/\\]/).pop() || '';

        // O(1) duplicate check
        const existingTrack = tracksMap.get(fileName);
        if (existingTrack) {
          logger.debug(`[App] 🔄 File "${fileName}" already exists (ID: ${existingTrack.id}), will reuse ID`);
        } else {
          logger.debug(`[App] 🆕 File "${fileName}" is new, creating new track`);
        }

        // Create symlink
        let savedFilePath = '';
        try {
          const saveResult = await desktopAPI.saveAudioFile(filePath, fileName);
          if (saveResult?.success && saveResult?.filePath) {
            savedFilePath = saveResult.filePath;
            logger.debug(`[App] ✅ File saved: ${fileName} → ${savedFilePath} (${saveResult.method})`);
          } else {
            logger.warn(`[App] ⚠️ saveAudioFile failed for "${fileName}":`, saveResult);
          }
        } catch (error) {
          logger.error(`[App] ❌ Failed to save file "${fileName}":`, error);
          return null;
        }

        if (!savedFilePath) {
          logger.error(`[App] ❌ saveAudioFile returned empty path for "${fileName}"`);
          return null;
        }

        // Parse with Rust
        let metadata;
        try {
          const parseResult = await desktopAPI.parseAudioMetadata(savedFilePath);
          if (parseResult.success && parseResult.metadata) {
            metadata = parseResult.metadata;
            logger.debug(`[App] ✅ Parsed metadata for "${fileName}": ${metadata?.title} - ${metadata?.artist}`);
          }
        } catch (error) {
          logger.error('[App] Failed to parse metadata:', error);
          // Use default metadata
        }

        const trackId = existingTrack?.id || Math.random().toString(36).substr(2, 9);

        // Cache metadata (now including coverData - IndexedDB has no quota limits!)
        if (metadata) {
          metadataCacheService.set(trackId, {
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            duration: metadata.duration,
            lyrics: metadata.lyrics,
            syncedLyrics: metadata.syncedLyrics,
            coverData: metadata.coverData,  // ✅ Now cached in IndexedDB!
            coverMime: metadata.coverMime,
            fileName: fileName,
            fileSize: 1,
            lastModified: Date.now(),
          });
        }

        // Create cover URL
        let coverUrl = `https://picsum.photos/seed/${encodeURIComponent(fileName)}/1000/1000`;
        if (metadata?.coverData && metadata?.coverMime) {
          try {
            const byteCharacters = atob(metadata.coverData);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: metadata.coverMime });
            coverUrl = createTrackedBlobUrl(blob);

            // Save cover to IndexedDB for faster startup
            try {
              await metadataCacheService.saveCover(trackId, blob);
            } catch (error) {
              logger.warn('[App] Failed to save cover to IndexedDB:', error);
            }
          } catch (error) {
            logger.error('[App] Failed to create cover blob:', error);
          }
        }

        const track = {
          id: trackId,
          title: metadata?.title || fileName.replace(/\.[^/.]+$/, ""),
          artist: metadata?.artist || 'Unknown Artist',
          album: metadata?.album || 'Unknown Album',
          duration: metadata?.duration || 0,
          lyrics: metadata?.lyrics || '',
          syncedLyrics: metadata?.syncedLyrics,
          coverUrl: coverUrl,
          audioUrl: '', // Will be loaded on play
          fileName: fileName,
          filePath: savedFilePath,
          addedAt: new Date().toISOString(),
          available: true
        } as Track;

        logger.debug(`[App] ✓ Track created: ${track.title} (ID: ${track.id})`);
        return track;
      })
    );

    // Filter out null results (failed files)
    const filtered = results.filter((track): track is Track => track !== null);
    logger.debug(`[App] Batch complete: ${results.length} total, ${filtered.length} successful, ${results.length - filtered.length} failed`);
    return filtered;
  }, [createTrackedBlobUrl]);

  // Process a batch of Web files in parallel
  const processWebFileBatch = useCallback(async (
    files: File[],
    tracksMap: Map<string, Track>
  ): Promise<Track[]> => {
    const results = await Promise.all(
      files.map(async (file) => {
        // O(1) duplicate check
        const key = `${file.name}-${file.size}`;
        const existingTrack = tracksMap.get(key);

        // Parse metadata
        let metadata;
        try {
          metadata = await parseAudioFile(file);
        } catch (error) {
          logger.error('[App] Failed to parse file:', file.name, error);
          // Use default metadata
          metadata = {
            title: file.name.replace(/\.[^/.]+$/, ""),
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

  // ========== End Performance Optimization Helpers ==========
  const handleDesktopImport = async () => {
    logger.debug('[App] Desktop import triggered');
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI) {
      logger.error('[App] Desktop API not available');
      return;
    }

    try {
      const result = await desktopAPI.selectFiles();
      if (result.canceled || result.filePaths.length === 0) {
        return;
      }

      const filePaths = result.filePaths;
      logger.debug(`[App] Processing ${filePaths.length} file(s)...`);
      logger.debug(`[App] Current tracks count before import (state): ${tracks.length}`);
      logger.debug(`[App] Current tracks count before import (ref): ${tracksCountRef.current}`);

      // Create Map for O(1) duplicate checking
      const tracksMap = createTracksMap();
      logger.debug(`[App] Created tracksMap with ${tracksMap.size} entries`);

      // Process files in batches with parallel processing
      const BATCH_SIZE = 10;
      const UI_UPDATE_BATCH = 20;
      const allNewTracks: Track[] = [];
      const importedTracksAll: Track[] = [];
      const baseTracks = tracks;
      let totalProcessed = 0;
      let totalFailed = 0;

      logger.debug(`[App] ===== Starting Import Process =====`);
      logger.debug(`[App] Total files to import: ${filePaths.length}`);

      for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        const batch = filePaths.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(filePaths.length / BATCH_SIZE);

        logger.debug(`[App] 📦 Batch ${batchNumber}/${totalBatches}: ${batch.length} files`);
        logger.debug(`[App] Files in this batch:`, batch.map(f => f.split(/[/\\]/).pop()));

        // Process this batch in parallel
        const batchTracks = await processDesktopFileBatch(batch, desktopAPI, tracksMap);

        // Filter out null (failed) tracks and count
        const successfulTracks = batchTracks.filter((track): track is Track => track !== null);
        const failedCount = batch.length - successfulTracks.length;

        totalProcessed += batch.length;
        totalFailed += failedCount;

        logger.debug(`[App] ✅ Batch ${batchNumber} result: ${successfulTracks.length} succeeded, ${failedCount} failed`);

        allNewTracks.push(...successfulTracks);
        importedTracksAll.push(...successfulTracks);

        // Update UI every UI_UPDATE_BATCH tracks
        if (allNewTracks.length >= UI_UPDATE_BATCH) {
          logger.debug(`[App] 🎨 UI update threshold reached (${allNewTracks.length} tracks)`);
          logger.debug(`[App] Current tracks count before update (state): ${tracks.length}`);
          logger.debug(`[App] Current tracks count before update (ref): ${tracksCountRef.current}`);

          // Capture the current batch size
          const batchSize = allNewTracks.length;

          setTracks(prev => {
            const newTracks = [...prev, ...allNewTracks];
            logger.debug(`[App] ✏️ Updating tracks: ${prev.length} → ${newTracks.length} (added ${allNewTracks.length})`);
            return newTracks;
          });

          // Update ref immediately
          tracksCountRef.current = tracksCountRef.current + batchSize;
          logger.debug(`[App] tracksCountRef updated to: ${tracksCountRef.current}`);
          logger.debug(`[App] ✓ UI updated, scheduling batch buffer clear`);

          // CRITICAL: Clear array AFTER setTracks callback executes (use setTimeout)
          setTimeout(() => {
            allNewTracks.length = 0;
            logger.debug(`[App] ✓ Batch buffer cleared`);
          }, 0);
        }
      }

      // Add remaining tracks
      if (allNewTracks.length > 0) {
        logger.debug(`[App] Final UI update with ${allNewTracks.length} track(s)...`);
        const finalBatchSize = allNewTracks.length;
        setTracks(prev => {
          const newTracks = [...prev, ...allNewTracks];
          logger.debug(`[App] ✏️ Final update: ${prev.length} → ${newTracks.length} (added ${allNewTracks.length})`);
          return newTracks;
        });
        tracksCountRef.current = tracksCountRef.current + finalBatchSize;
        logger.debug(`[App] tracksCountRef updated to: ${tracksCountRef.current}`);
      }

      // Ensure final in-memory list is complete (avoid partial save)
      const finalTracks = [...baseTracks, ...importedTracksAll];
      setTracks(finalTracks);
      tracksCountRef.current = finalTracks.length;

      // Wait a bit for state to update, then save
      await new Promise(resolve => setTimeout(resolve, 100));

      // Save cache once at the end
      logger.debug('[App] Saving metadata cache...');
      await metadataCacheService.save();

      // Summary report
      logger.debug(`[App] ===== Import Summary =====`);
      logger.debug(`[App] Total processed: ${totalProcessed}`);
      logger.debug(`[App] Successfully imported: ${totalProcessed - totalFailed}`);
      logger.debug(`[App] Failed: ${totalFailed}`);

      if (totalFailed > 0) {
        logger.error(`[App] ⚠️ ${totalFailed} file(s) failed to import! Check console above for details.`);
      } else {
        logger.debug(`[App] ✓ All files imported successfully`);
      }

      // Manually trigger library save after import to ensure all tracks are saved
      logger.debug('[App] Manually triggering library save after import...');
      logger.debug(`[App] Saving ${tracks.length} tracks to disk...`);
      await libraryStorage.saveLibrary({
        songs: finalTracks.map(track => ({
          ...track,
          audioUrl: track.audioUrl || ''
        })),
        settings: {
          volume: volume,
          currentTrackIndex: currentTrackIndex,
          currentTrackId: currentTrack?.id,
          currentTime: persistedTimeRef.current || currentTime,
          isPlaying: isPlaying,
          playbackMode: playbackMode
        }
      });
      logger.debug('[App] ✓ Manual library save completed');
    } catch (error) {
      logger.error('[App] Failed to import files:', error);
    }
  };

  // Handle dropped files (for drag & drop import in Web environment)
  const handleDropFiles = async (files: File[]) => {
    logger.debug('[App] Drop import triggered');
    logger.debug(`[App] Processing ${files.length} file(s)...`);

    // Create Map for O(1) duplicate checking
    const tracksMap = createTracksMap();

    // Process files in batches with parallel processing
    const BATCH_SIZE = 10;
    const UI_UPDATE_BATCH = 20;
    const allNewTracks: Track[] = [];

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      logger.debug(`[App] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)} (${batch.length} files)`);

      // Process this batch in parallel
      const batchTracks = await processWebFileBatch(batch, tracksMap);
      allNewTracks.push(...batchTracks);

      // Update UI every UI_UPDATE_BATCH tracks
      if (allNewTracks.length >= UI_UPDATE_BATCH) {
        logger.debug(`[App] Updating UI with ${allNewTracks.length} new track(s)...`);
        setTracks(prev => [...prev, ...allNewTracks]);
        allNewTracks.length = 0;
      }
    }

    // Add remaining tracks
    if (allNewTracks.length > 0) {
      logger.debug(`[App] Final UI update with ${allNewTracks.length} track(s)...`);
      setTracks(prev => [...prev, ...allNewTracks]);
    }

    logger.debug('[App] ✓ All files imported successfully');
  };

  // File input change handler (for Electron and Web)
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    logger.debug('[App] File input changed - platform:', (window as any).electron ? 'Electron' : 'Web');
    logger.debug(`[App] Processing ${files.length} file(s)...`);

    // Create Map for O(1) duplicate checking
    const tracksMap = createTracksMap();

    // Process files in batches with parallel processing
    const BATCH_SIZE = 10;
    const UI_UPDATE_BATCH = 20;
    const allNewTracks: Track[] = [];

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      logger.debug(`[App] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)} (${batch.length} files)`);

      // Process this batch in parallel
      const batchTracks = await processWebFileBatch(batch, tracksMap);
      allNewTracks.push(...batchTracks);

      // Update UI every UI_UPDATE_BATCH tracks
      if (allNewTracks.length >= UI_UPDATE_BATCH) {
        logger.debug(`[App] Updating UI with ${allNewTracks.length} new track(s)...`);
        setTracks(prev => [...prev, ...allNewTracks]);
        allNewTracks.length = 0;
      }
    }

    // Add remaining tracks
    if (allNewTracks.length > 0) {
      logger.debug(`[App] Final UI update with ${allNewTracks.length} track(s)...`);
      setTracks(prev => [...prev, ...allNewTracks]);
    }

    logger.debug('[App] ✓ All files imported successfully');

    // Reset input value
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const skipForward = useCallback(() => {
    if (tracks.length === 0) return;
    // Always auto-play when changing tracks
    shouldAutoPlayRef.current = true;
    forcePlayRef.current = true;

    if (playbackMode === 'shuffle') {
      const nextIndex = getRandomIndex(currentTrackIndex, tracks.length);
      setCurrentTrackIndex(nextIndex);
      return;
    }

    if (currentTrackIndex < tracks.length - 1) {
      setCurrentTrackIndex(prev => prev + 1);
    }
  }, [currentTrackIndex, tracks.length, playbackMode, getRandomIndex]);

  const skipBackward = useCallback(() => {
    if (tracks.length === 0) return;
    // Always auto-play when changing tracks
    shouldAutoPlayRef.current = true;
    forcePlayRef.current = true;

    if (playbackMode === 'shuffle') {
      const nextIndex = getRandomIndex(currentTrackIndex, tracks.length);
      setCurrentTrackIndex(nextIndex);
      return;
    }

    if (currentTrackIndex > 0) {
      setCurrentTrackIndex(prev => prev - 1);
    } else if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  }, [currentTrackIndex, tracks.length, playbackMode, getRandomIndex]);

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (vol: number) => {
    if (vol > 0) {
      lastNonZeroVolumeRef.current = vol;
    }
    setVolume(vol);
  };

  const handleToggleMute = () => {
    if (volume > 0) {
      lastNonZeroVolumeRef.current = volume;
      setVolume(0);
    } else {
      const restore = lastNonZeroVolumeRef.current || 0.5;
      setVolume(restore);
    }
  };

  const handleTogglePlaybackMode = () => {
    setPlaybackMode(prev => {
      if (prev === 'order') return 'shuffle';
      if (prev === 'shuffle') return 'repeat-one';
      return 'order';
    });
  };

  // Handle canplay event - when audio is ready to play
  const handleCanPlay = useCallback(() => {
    logger.debug('[App] Audio is ready to play');

    // Restore playback time after canplay if needed
    if (restoredTimeRef.current > 0 && audioRef.current) {
      if (restoredTrackIdRef.current && currentTrack && restoredTrackIdRef.current !== currentTrack.id) {
        return;
      }

      const duration = audioRef.current.duration || 0;
      const restoreTime = Math.max(0, Math.min(restoredTimeRef.current, Math.max(0, duration - 0.5)));
      logger.debug('[App] Restoring playback time in canplay:', restoreTime);

      // Simple and direct time restore
      audioRef.current.currentTime = restoreTime;
      setCurrentTime(restoreTime);

      // Clear the restore time
      restoredTimeRef.current = 0;
      restoredTrackIdRef.current = null;
      logger.debug('[App] ✓ Playback time restored');
    }

    // If we were waiting for this event to play (or still have play intent), play now
    if ((waitingForCanPlayRef.current || shouldAutoPlayRef.current || forcePlayRef.current) && audioRef.current) {
      waitingForCanPlayRef.current = false;
      logger.debug('[App] Attempting playback after canplay');
      audioRef.current.play().then(() => {
        logger.debug('[App] ✓ Playback started after canplay');
        setIsPlaying(true);
        shouldAutoPlayRef.current = false;
        forcePlayRef.current = false;
      }).catch((e) => {
        logger.debug('[App] Playback failed after canplay:', e);
        setIsPlaying(false);
        shouldAutoPlayRef.current = true;
        forcePlayRef.current = true;
      });
    }
  }, [currentTrack]);

  useEffect(() => {
    if (!audioRef.current || !currentTrack) return;

    logger.debug('[App] Track changed:', currentTrack.title, 'index:', currentTrackIndex);

    // Reset audio URL ready flag when track changes
    audioUrlReadyRef.current = false;

    // Load audio file if not loaded yet (lazy loading)
    if (!currentTrack.audioUrl && (currentTrack as any).filePath) {
      logger.debug('[App] Lazy loading audio for:', currentTrack.title);

      // Set flag for auto-play after load completes
      if (isPlaying) {
        shouldAutoPlayRef.current = true;
      }

      loadAudioFileForTrack(currentTrack).then(updatedTrack => {
        setTracks(prev => {
          const newTracks = [...prev];
          const idx = newTracks.findIndex(t => t.id === updatedTrack.id);
          if (idx !== -1) {
            newTracks[idx] = updatedTrack;
          }
          return newTracks;
        });
      });
      return; // Don't continue to playback logic
    }

    // Check if audio URL is valid and ready
    if (!currentTrack.audioUrl) {
      logger.debug('[App] No audio URL available, pausing playback');
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
      return;
    }

    // Reset waiting flag when track changes
    if (waitingForCanPlayRef.current) {
      waitingForCanPlayRef.current = false;
    }

    // Check if we need to restore playback time
    if (restoredTimeRef.current > 0) {
      logger.debug('[App] Need to restore playback time:', restoredTimeRef.current);
    }

    // Mark audio URL as ready
    audioUrlReadyRef.current = true;

    // Only attempt playback if audioUrl is loaded and ready
    if (currentTrack.audioUrl) {
      if (isPlaying || shouldAutoPlayRef.current || forcePlayRef.current) {
        audioRef.current.play().then(() => {
          logger.debug('[App] ✓ Playback started successfully');
          shouldAutoPlayRef.current = false;
          forcePlayRef.current = false;
          setIsPlaying(true);
        }).catch((e) => {
          logger.debug('[App] Playback failed, waiting for canplay:', e);
          // If play fails, wait for canplay event
          waitingForCanPlayRef.current = true;
          // Keep auto-play intent so canplay can retry
          shouldAutoPlayRef.current = true;
          forcePlayRef.current = true;
          // Don't set isPlaying to false yet - wait for canplay event
        });
      } else {
        audioRef.current.pause();
      }
    }
  }, [currentTrackIndex, isPlaying, currentTrack, loadAudioFileForTrack]);

  // Auto-play when audio URL is loaded (for lazy-loaded tracks)
  useEffect(() => {
    if (!audioRef.current || !currentTrack || !currentTrack.audioUrl) return;

    // Only attempt auto-play if the flag is set
    if ((shouldAutoPlayRef.current || forcePlayRef.current) && audioUrlReadyRef.current) {
      logger.debug('[App] Auto-playing after audio URL loaded:', currentTrack.title);
      audioRef.current.play().then(() => {
        logger.debug('[App] ✓ Auto-play started successfully');
        setIsPlaying(true);
        shouldAutoPlayRef.current = false;
        forcePlayRef.current = false;
      }).catch((e) => {
        logger.debug('[App] Auto-play failed:', e);
        waitingForCanPlayRef.current = true;
        shouldAutoPlayRef.current = true;
        forcePlayRef.current = true;
      });
    }
  }, [currentTrack?.audioUrl, currentTrack]);

  // Clean up previous Blob URL when track changes to prevent memory leak
  useEffect(() => {
    if (!currentTrack) return;

    const currentAudioUrl = currentTrack.audioUrl;
    const previousAudioUrl = prevAudioUrlRef.current;

    // If we have a previous Blob URL that's different from current, revoke it
    if (previousAudioUrl && previousAudioUrl.startsWith('blob:') && previousAudioUrl !== currentAudioUrl) {
      logger.debug('[App] Cleaning up previous blob URL:', previousAudioUrl);
      revokeBlobUrl(previousAudioUrl);
    }

    // Update the ref to current audio URL
    prevAudioUrlRef.current = currentAudioUrl;
  }, [currentTrack?.audioUrl]);

  // Preload adjacent tracks for instant playback
  useEffect(() => {
    const preloadAdjacent = async () => {
      if (currentTrackIndex < 0 || !isDesktop()) return;

      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI) return;

      const MAX_PRELOAD_SIZE = 50 * 1024 * 1024; // 50MB limit for preloading

      // Preload next track
      if (currentTrackIndex < tracks.length - 1) {
        const nextTrack = tracks[currentTrackIndex + 1];
        const fileSize = (nextTrack as any).fileSize || 0;

        // Skip preloading if fileSize is unknown or large
        if (!fileSize || fileSize <= 0) {
          logger.debug('[App] Skipping preload (unknown size):', nextTrack.title);
        } else if (!nextTrack.audioUrl && (nextTrack as any).filePath && fileSize <= MAX_PRELOAD_SIZE) {
          logger.debug('[App] Preloading next track:', nextTrack.title, `(${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
          loadAudioFileForTrack(nextTrack).then(updatedTrack => {
            setTracks(prev => {
              const newTracks = [...prev];
              newTracks[currentTrackIndex + 1] = updatedTrack;
              return newTracks;
            });
          });
        } else if (fileSize > MAX_PRELOAD_SIZE) {
          logger.debug('[App] Skipping large file for preload:', nextTrack.title, `(${(fileSize / 1024 / 1024).toFixed(2)} MB > 50 MB)`);
        }
      }

      // Preload previous track
      if (currentTrackIndex > 0) {
        const prevTrack = tracks[currentTrackIndex - 1];
        const fileSize = (prevTrack as any).fileSize || 0;

        // Skip preloading if fileSize is unknown or large
        if (!fileSize || fileSize <= 0) {
          logger.debug('[App] Skipping preload (unknown size):', prevTrack.title);
        } else if (!prevTrack.audioUrl && (prevTrack as any).filePath && fileSize <= MAX_PRELOAD_SIZE) {
          logger.debug('[App] Preloading previous track:', prevTrack.title, `(${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
          loadAudioFileForTrack(prevTrack).then(updatedTrack => {
            setTracks(prev => {
              const newTracks = [...prev];
              newTracks[currentTrackIndex - 1] = updatedTrack;
              return newTracks;
            });
          });
        } else if (fileSize > MAX_PRELOAD_SIZE) {
          logger.debug('[App] Skipping large file for preload:', prevTrack.title, `(${(fileSize / 1024 / 1024).toFixed(2)} MB > 50 MB)`);
        }
      }
    };

    // Small delay to not interfere with current track loading
    const timer = setTimeout(preloadAdjacent, 500);
    return () => clearTimeout(timer);
  }, [currentTrackIndex, tracks, isDesktop, loadAudioFileForTrack]);

  useEffect(() => {
    if (audioRef.current) {
      const actualVolume = linearToExponentialVolume(volume);
      logger.debug('Volume changed to:', volume, '(actual:', actualVolume.toFixed(3), ')');
      audioRef.current.volume = actualVolume;
    }
  }, [volume, linearToExponentialVolume]);

  // Load library from disk on mount (Desktop only)
  useEffect(() => {
    const loadLibraryFromDisk = async () => {
      logger.debug('[App] Loading library from disk...');
      // Initialize metadata cache first
      await metadataCacheService.initialize();

      // Wait for Desktop API to be initialized
      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI) {
        logger.debug('[App] Not running in Desktop mode, skipping library load');
        return;
      }

      try {
        const libraryData = await libraryStorage.loadLibrary();
        logger.debug('[App] Library loaded from disk:', libraryData);
        logger.debug('[App] ✅ Library data loaded:');
        logger.debug(`   - Songs count: ${libraryData.songs?.length || 0}`);
        logger.debug(`   - Settings:`, libraryData.settings);

        // Restore volume from settings
        if (libraryData.settings?.volume !== undefined) {
          logger.debug('Restoring volume:', libraryData.settings.volume);
          setVolume(libraryData.settings.volume);
        }

        // Restore playback mode from settings
        if (libraryData.settings?.playbackMode) {
          logger.debug('Restoring playback mode:', libraryData.settings.playbackMode);
          setPlaybackMode(libraryData.settings.playbackMode);
        }

        if (libraryData.songs && libraryData.songs.length > 0) {
          logger.debug(`[App] 📝 Found ${libraryData.songs.length} songs in library, loading...`);
          logger.debug('[App] First 3 songs:', libraryData.songs.slice(0, 3).map(s => ({ id: s.id, title: s.title, fileName: s.fileName })));
        } else {
          logger.warn('[App] ⚠️ No songs found in library data!');
        }

        if (libraryData.songs && libraryData.songs.length > 0) {
          // Validate file paths first
          const validationResults = await libraryStorage.validateAllPaths(libraryData.songs);
          const missingFiles = validationResults.filter(r => !r.exists);

          if (missingFiles.length > 0) {
            logger.warn(`Found ${missingFiles.length} missing files`);
          }

          // Progressive loading with immediate UI updates
          const BATCH_SIZE = 20; // Load 20 songs at a time before UI update
          let loadedTracks: Track[] = [];

          for (let i = 0; i < libraryData.songs.length; i++) {
            const song = libraryData.songs[i];
            const validationResult = validationResults.find(r => r.id === song.id);
            const exists = validationResult?.exists ?? false;

            let restoredTrack: Track;

            if (!exists) {
              // File doesn't exist, mark as unavailable
              restoredTrack = {
                ...song,
                audioUrl: '',
                coverUrl: '',
                available: false
              };
            } else {
              // File exists, try to get metadata from cache first
              const cached = metadataCacheService.get(song.id);
              const isValid = cached && metadataCacheService.isValid(
                song.id,
                song.fileName,
                song.fileSize,
                song.lastModified
              );

              if (isValid && cached) {
                // Use cached metadata (fast path!)
                logger.debug(`[App] ✓ Using cached metadata for: ${song.title}`);
                const cachedMetadata = metadataCacheService.cachedToTrack(cached, song.filePath, song.id);

                // Try to load cover from IndexedDB first (NEW - much faster!)
                let coverUrl = `https://picsum.photos/seed/${encodeURIComponent(song.fileName)}/1000/1000`;
                let coverBlob: Blob | null = null;
                let parsedMetadata: any = null; // ✅ Move to outer scope

                if (cached.coverData && cached.coverMime) {
                  // We have cover data in cache, try to load from IndexedDB
                  try {
                    const indexedDBCoverUrl = await metadataCacheService.loadCover(song.id);
                    if (indexedDBCoverUrl) {
                      coverUrl = indexedDBCoverUrl;
                      logger.debug(`[App] ✓ Loaded cover from IndexedDB for: ${song.title}`);
                    } else {
                      // Not in IndexedDB yet, create blob from cached data
                      const byteCharacters = atob(cached.coverData);
                      const byteNumbers = new Array(byteCharacters.length);
                      for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                      }
                      const byteArray = new Uint8Array(byteNumbers);
                      const blob = new Blob([byteArray], { type: cached.coverMime });
                      coverUrl = createTrackedBlobUrl(blob);
                      coverBlob = blob;

                      // Save to IndexedDB for next time
                      try {
                        await metadataCacheService.saveCover(song.id, blob);
                      } catch (error) {
                        logger.warn('[App] Failed to save cover to IndexedDB:', error);
                      }
                    }
                  } catch (error) {
                    logger.warn('[App] Failed to load cover from cache, will re-parse:', error);
                  }
                }

                // If we still don't have a cover, try re-parsing the file
                if (!coverBlob && !cached.coverData) {
                  logger.debug(`[App] Cover not cached, re-parsing file: ${song.title}`);
                  try {
                    const parseResult = await desktopAPI.parseAudioMetadata(song.filePath);
                    if (parseResult.success && parseResult.metadata) {
                      parsedMetadata = parseResult.metadata;
                    }
                  } catch (e) {
                    logger.error('[App] Failed to parse cover art:', e);
                  }

                  if (parsedMetadata?.coverData && parsedMetadata?.coverMime) {
                    // Use cover from re-parsed file
                    const byteCharacters = atob(parsedMetadata.coverData);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                      byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: parsedMetadata.coverMime });
                    coverUrl = createTrackedBlobUrl(blob);
                    logger.debug(`[App] ✓ Extracted cover art from file: ${song.title}`);

                    // Save cover to IndexedDB
                    try {
                      await metadataCacheService.saveCover(song.id, blob);
                    } catch (error) {
                      logger.warn('[App] Failed to save cover to IndexedDB:', error);
                    }
                  }
                }

                restoredTrack = {
                  ...song,
                  title: cachedMetadata.title || parsedMetadata?.title || song.title,
                  artist: cachedMetadata.artist || parsedMetadata?.artist || song.artist,
                  album: cachedMetadata.album || parsedMetadata?.album || song.album,
                  duration: cachedMetadata.duration || parsedMetadata?.duration || song.duration,
                  lyrics: cachedMetadata.lyrics || parsedMetadata?.lyrics || song.lyrics,
                  syncedLyrics: cachedMetadata.syncedLyrics || parsedMetadata?.syncedLyrics,
                  file: undefined, // Don't load file yet
                  audioUrl: '', // Will be loaded on play
                  coverUrl: coverUrl,
                  available: true
                };
              } else {
                // No cache or invalid: use stored metadata immediately for fast startup
                // Defer heavy parsing to later (e.g., on-demand) to avoid blocking load
                restoredTrack = {
                  ...song,
                  audioUrl: '', // Will be loaded on play
                  coverUrl: song.coverUrl || `https://picsum.photos/seed/${encodeURIComponent(song.fileName)}/1000/1000`,
                  available: true
                };
              }
            }

            // Add to tracks array
            loadedTracks.push(restoredTrack);

            // Update UI every BATCH_SIZE songs or at the end
            if (loadedTracks.length % BATCH_SIZE === 0 || i === libraryData.songs.length - 1) {
              setTracks([...loadedTracks]);
              logger.debug(`[App] ✓ Loaded ${loadedTracks.length}/${libraryData.songs.length} tracks`);
              // Small delay to let UI render
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }

          // Save cache if we updated it
          await metadataCacheService.save();
          logger.debug(`[App] ✓ Finished loading ${loadedTracks.length} tracks`);

          // Restore playback state from settings
          logger.debug('[App] Checking for playback state to restore...');
          logger.debug('[App] libraryData.settings:', libraryData.settings);
          logger.debug('[App] currentTrackIndex:', libraryData.settings?.currentTrackIndex);
          logger.debug('[App] currentTime:', libraryData.settings?.currentTime);
          logger.debug('[App] isPlaying:', libraryData.settings?.isPlaying);
          
          const restoredTrackId = libraryData.settings?.currentTrackId;
          let restoredIndex = -1;

          if (restoredTrackId) {
            restoredIndex = loadedTracks.findIndex(t => t.id === restoredTrackId);
          }

          if (restoredIndex < 0 &&
              libraryData.settings?.currentTrackIndex !== undefined &&
              libraryData.settings?.currentTrackIndex >= 0 &&
              libraryData.settings?.currentTrackIndex < loadedTracks.length) {
            restoredIndex = libraryData.settings.currentTrackIndex;
          }

          if (restoredIndex >= 0 && restoredIndex < loadedTracks.length) {
            logger.debug('[App] ✓ Restoring playback state:');
            logger.debug('  - Track index:', restoredIndex);
            logger.debug('  - Current time:', libraryData.settings.currentTime);
            logger.debug('  - Is playing:', libraryData.settings.isPlaying);

            // Save restored time to ref (will be restored when audio is ready)
            if (libraryData.settings.currentTime !== undefined) {
              const restoredTime = libraryData.settings.currentTime;
              restoredTimeRef.current = restoredTime;
              restoredTrackIdRef.current = loadedTracks[restoredIndex].id;
              logger.debug('[App] ✓ Saved restored time to ref:', restoredTime);
              // Don't setCurrentTime here - will be set when audio is ready
            }

            // Restore track index
            setCurrentTrackIndex(restoredIndex);

            // Always set to paused, do not auto-play
            setIsPlaying(false);
            shouldAutoPlayRef.current = false;
          } else {
            logger.debug('[App] No playback state to restore or invalid track index');
          }

          // Preload first 3 songs for instant playback
          const PRELOAD_COUNT = 3;
          const tracksToPreload = Math.min(PRELOAD_COUNT, loadedTracks.length);

          for (let i = 0; i < tracksToPreload; i++) {
            const track = loadedTracks[i];
            if ((track as any).filePath && !track.audioUrl) {
              logger.debug(`[App] Preloading song ${i + 1}/${PRELOAD_COUNT}:`, track.title);
              // Don't await - let them load in parallel
              loadAudioFileForTrack(track).then(updatedTrack => {
                setTracks(prev => {
                  const newTracks = [...prev];
                  const idx = newTracks.findIndex(t => t.id === updatedTrack.id);
                  if (idx !== -1) {
                    newTracks[idx] = updatedTrack;
                  }
                  return newTracks;
                });
              });
            }
          }
        }
      } catch (error) {
        logger.error('Failed to load library:', error);
      }
    };

    loadLibraryFromDisk();
  }, []);

  // Sync tracksCountRef with tracks.length (for immediate access after deletion)
  useEffect(() => {
    tracksCountRef.current = tracks.length;
    logger.debug(`[App] tracksCountRef synced to: ${tracks.length}`);
  }, [tracks.length]);

  // Auto-save library to disk when tracks change (Desktop only, debounced)
  useEffect(() => {
    if (isDesktop()) {
      logger.debug('🔄 Tracks or volume changed, triggering auto-save...');

      const libraryData = buildLibraryData(tracks, {
        volume: volume,
        currentTrackIndex: currentTrackIndex,
        currentTrackId: currentTrack?.id,
        currentTime: persistedTimeRef.current || currentTime,
        isPlaying: isPlaying,
        playbackMode: playbackMode
      });

      logger.debug(`📦 Prepared library data: ${libraryData.songs.length} songs`);
      logger.debug('📦 Settings:', libraryData.settings);
      logger.debug('  - volume:', libraryData.settings.volume);
      logger.debug('  - currentTrackIndex:', libraryData.settings.currentTrackIndex);
      logger.debug('  - currentTime:', libraryData.settings.currentTime);
      logger.debug('  - isPlaying:', libraryData.settings.isPlaying);

      // Debounced save
      libraryStorage.saveLibraryDebounced(libraryData);
    }
  }, [tracks, volume, currentTrackIndex, isPlaying, currentTrack?.id, playbackMode]);

  // Throttle persistence of currentTime to avoid excessive writes
  useEffect(() => {
    if (!isDesktop()) return;

    // Reset persisted time when track changes to avoid cross-track leakage
    persistedTimeRef.current = 0;

    const interval = setInterval(() => {
      if (!audioRef.current || !currentTrack) return;
      const nowTime = audioRef.current.currentTime || 0;

      // Only update if time moved meaningfully (>= 5s) to reduce writes
      if (Math.abs(nowTime - persistedTimeRef.current) >= 5) {
        persistedTimeRef.current = nowTime;
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [currentTrack?.id]);

  // Save library before app quits
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (isDesktop()) {
        const libraryData = buildLibraryData(tracks, {
          volume: volume,
          currentTrackIndex: currentTrackIndex,
          currentTrackId: currentTrack?.id,
          currentTime: persistedTimeRef.current || currentTime,
          isPlaying: isPlaying,
          playbackMode: playbackMode
        });

        // Immediate save (no debounce) on quit
        logger.debug('💾 Saving library before quit...');
        await libraryStorage.saveLibrary(libraryData);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [tracks, volume, currentTrackIndex, isPlaying, currentTrack?.id, playbackMode]);

  // Remove track function
  const handleRemoveTrack = useCallback(async (trackId: string) => {
    // Use functional update to avoid race conditions and update all states atomically
    setTracks(prev => {
      const newTracks = prev.filter(t => t.id !== trackId);
      const removedIndex = prev.findIndex(t => t.id === trackId);
      const trackToRemove = prev[removedIndex];

      // Calculate new track index BEFORE updating state
      let newIndex = currentTrackIndex;

      // If no tracks left, reset player
      if (newTracks.length === 0) {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = '';
        }
        setIsPlaying(false);
        setCurrentTrackIndex(-1);

        // Revoke blob URLs for the removed track
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

      // Calculate the new playing index
      if (removedIndex >= 0) {
        if (removedIndex < currentTrackIndex) {
          // Removed track was before current, shift index left
          newIndex = Math.max(0, currentTrackIndex - 1);
        } else if (removedIndex === currentTrackIndex) {
          // Removed current playing track
          newIndex = Math.min(currentTrackIndex, newTracks.length - 1);
        }
        // If removed track was after current, keep same index
      }

      // Update track index and handle playback
      setCurrentTrackIndex(newIndex);

      // If we removed the currently playing track, handle playback state
      if (removedIndex === currentTrackIndex) {
        if (newTracks.length > 0) {
          // Continue playing the new track at the same position if we were playing
          if (isPlaying) {
            shouldAutoPlayRef.current = true;
          }
        }
      }

      // Revoke blob URLs for the removed track
      if (trackToRemove) {
        if (trackToRemove.audioUrl && trackToRemove.audioUrl.startsWith('blob:')) {
          revokeBlobUrl(trackToRemove.audioUrl);
        }
        if (trackToRemove.coverUrl && trackToRemove.coverUrl.startsWith('blob:')) {
          revokeBlobUrl(trackToRemove.coverUrl);
        }
      }

      // Clean up in Desktop (Electron)
      const cleanupDesktopFile = async () => {
        const desktopAPI = await getDesktopAPIAsync();
        if (desktopAPI && trackToRemove && (trackToRemove as any).filePath) {
          try {
            const result = await desktopAPI.deleteAudioFile((trackToRemove as any).filePath);
            if (result.success) {
              logger.debug(`✅ Symlink deleted for track: ${trackToRemove.title}`);
            }
          } catch (error) {
            logger.error('Failed to delete symlink:', error);
          }
        }
      };

      // Delete cover from IndexedDB
      const cleanupCover = async () => {
        try {
          await metadataCacheService.deleteCover(trackId);
          logger.debug(`✅ Cover deleted from IndexedDB for track: ${trackToRemove?.title || trackId}`);
        } catch (error) {
          logger.warn('Failed to delete cover from IndexedDB:', error);
        }
      };

      // Fire and forget cleanup operations
      cleanupDesktopFile();
      cleanupCover();
      cleanupOrphanAudio(newTracks);

      return newTracks;
    });
  }, [currentTrackIndex, isPlaying]);

  // Remove multiple tracks at once (batch deletion)
  const handleRemoveMultipleTracks = useCallback(async (trackIds: string[]) => {
    logger.debug(`[App] Batch removing ${trackIds.length} tracks...`);

    // Collect all tracks to remove for cleanup
    const tracksToRemove = tracks.filter(t => trackIds.includes(t.id));

    // Revoke blob URLs for all tracks
    for (const track of tracksToRemove) {
      if (track.audioUrl && track.audioUrl.startsWith('blob:')) {
        revokeBlobUrl(track.audioUrl);
      }
      if (track.coverUrl && track.coverUrl.startsWith('blob:')) {
        revokeBlobUrl(track.coverUrl);
      }
    }

    // Delete audio files in Desktop mode
    const desktopAPI = await getDesktopAPIAsync();
    if (desktopAPI) {
      for (const track of tracksToRemove) {
        if ((track as any).filePath) {
          try {
            await desktopAPI.deleteAudioFile((track as any).filePath);
          } catch (error) {
            logger.error(`Failed to delete file for ${track.title}:`, error);
          }
        }
      }
    }

    // Delete covers from IndexedDB for all tracks
    for (const trackId of trackIds) {
      try {
        await metadataCacheService.deleteCover(trackId);
      } catch (error) {
        logger.warn(`Failed to delete cover for ${trackId} from IndexedDB:`, error);
      }
    }

    // Update state ONCE with all tracks removed
    setTracks(prev => {
      const newTracks = prev.filter(t => !trackIds.includes(t.id));

      // Update currentTrackIndex based on how many tracks before it were removed
      setCurrentTrackIndex(prevIndex => {
        // If no tracks left, reset player
        if (newTracks.length === 0) {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
          }
          setIsPlaying(false);
          return -1;
        }

        // Count how many tracks before the current position were removed
        const removedBeforeCurrent = trackIds.filter(id => {
          const removedIndex = prev.findIndex(t => t.id === id);
          return removedIndex >= 0 && removedIndex < prevIndex;
        }).length;

        // Calculate new index
        let newIndex = prevIndex - removedBeforeCurrent;

        // Clamp to valid range
        if (newIndex >= newTracks.length) {
          newIndex = Math.max(0, newTracks.length - 1);
        }
        if (newIndex < 0) {
          newIndex = 0;
        }

        logger.debug(`[App] Current track index: ${prevIndex} → ${newIndex} (removed ${removedBeforeCurrent} tracks before current)`);
        return newIndex;
      });

      // Cleanup orphaned audio files based on remaining tracks
      cleanupOrphanAudio(newTracks);
      return newTracks;
    });

    // Update ref immediately for use in subsequent operations
    tracksCountRef.current = tracks.length - trackIds.length;
    logger.debug(`[App] tracksCountRef updated to: ${tracksCountRef.current}`);

    logger.debug(`[App] ✓ Batch removal complete: ${trackIds.length} tracks removed`);
  }, [tracks]);

  // Reload files in Desktop (Electron)
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

      // Match files with existing tracks by filename
      for (const filePath of filePaths) {
        const fileName = filePath.split(/[/\\]/).pop() || '';

        // Find matching track by stored filename
        const trackIndex = updatedTracks.findIndex(t => {
          const storedFileName = (t as any).fileName;
          return storedFileName === fileName;
        });

        if (trackIndex !== -1 && !updatedTracks[trackIndex].available) {
          // File found, reload it using Rust
          try {
            // Create symlink to the original file
            const saveResult = await desktopAPI.saveAudioFile(filePath, fileName);
            if (saveResult.success && saveResult.filePath) {
              logger.debug(`File saved (${saveResult.method}):`, saveResult.filePath);

              // Parse metadata using Rust (FAST!)
              const parseResult = await desktopAPI.parseAudioMetadata(saveResult.filePath);
              if (parseResult.success && parseResult.metadata) {
                const metadata = parseResult.metadata;

                // Update cache with Rust metadata (now including coverData - IndexedDB has no quota limits!)
                metadataCacheService.set(updatedTracks[trackIndex].id, {
                  title: metadata.title,
                  artist: metadata.artist,
                  album: metadata.album,
                  duration: metadata.duration,
                  lyrics: metadata.lyrics,
                  syncedLyrics: metadata.syncedLyrics,
                  coverData: metadata.coverData,  // ✅ Now cached in IndexedDB!
                  coverMime: metadata.coverMime,
                  fileName: fileName,
                  fileSize: 1,
                  lastModified: Date.now(),
                });

                // Create cover URL from base64 if available
                let coverUrl = `https://picsum.photos/seed/${encodeURIComponent(fileName)}/1000/1000`;
                if (metadata.coverData && metadata.coverMime) {
                  const byteCharacters = atob(metadata.coverData);
                  const byteNumbers = new Array(byteCharacters.length);
                  for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                  }
                  const byteArray = new Uint8Array(byteNumbers);
                  const blob = new Blob([byteArray], { type: metadata.coverMime });
                  coverUrl = createTrackedBlobUrl(blob);

                  // Save cover to IndexedDB
                  try {
                    await metadataCacheService.saveCover(updatedTracks[trackIndex].id, blob);
                  } catch (error) {
                    logger.warn('[App] Failed to save cover to IndexedDB:', error);
                  }
                }

                // Update track with metadata
                updatedTracks[trackIndex] = {
                  ...updatedTracks[trackIndex],
                  title: metadata.title,
                  artist: metadata.artist,
                  album: metadata.album,
                  duration: metadata.duration,
                  lyrics: metadata.lyrics,
                  syncedLyrics: metadata.syncedLyrics,
                  coverUrl: coverUrl,
                  filePath: saveResult.filePath,
                  fileName: fileName,
                  available: true
                };
                reloadedCount++;
              }
            }
          } catch (error) {
            logger.error('Failed to reload file:', filePath, error);
          }
        }
      }

      setTracks(updatedTracks);
      logger.debug(`Reloaded ${reloadedCount} files`);

      // Save cache if we updated it
      if (reloadedCount > 0) {
        await metadataCacheService.save();
      }
    } catch (error) {
      logger.error('Failed to reload files:', error);
    }
  }, [tracks]);

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden bg-background-dark font-sans relative">
        <TitleBar />
        <div className="flex flex-1">
          <Sidebar
          onImportClick={() => {
            // Check if running in Desktop environment (Electron)
            if (isDesktop()) {
              // Desktop: Use native file dialog
              handleDesktopImport();
            } else {
              // Web: Use file input
              fileInputRef.current?.click();
            }
          }}
          onNavigate={(mode) => { setViewMode(mode); setIsFocusMode(false); }}
          onReloadFiles={handleReloadFiles}
          hasUnavailableTracks={tracks.some(t => t.available === false)}
          currentView={viewMode}
        />

        <main className="flex-1 flex flex-col relative overflow-hidden bg-gradient-to-br from-background-dark to-[#1a2533] pt-8">
          {currentTrack && (
            <audio
              ref={setAudioRef}
              src={currentTrack.audioUrl}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onLoadedData={handleLoadedMetadata}
              onEnded={handleTrackEnded}
              onCanPlay={handleCanPlay}
              onError={(e) => {
                        logger.error('[App] Audio error:', e);
                        const audio = e.target as HTMLAudioElement;
                        logger.error('[App] Audio error code:', audio.error?.code);
                        logger.error('[App] Audio error message:', audio.error?.message);
                        logger.error('[App] Current audio src:', audio.src);
              
                        // If audio fails to load, stop playback and reset state
                        setIsPlaying(false);
                        waitingForCanPlayRef.current = false;
                        shouldAutoPlayRef.current = false;
              
                        // Don't mark track as unavailable just because of a loading error
                        // The error might be due to Blob URL being revoked, not because the file is actually unavailable
                        // Just clear the audioUrl so it can be reloaded on next play
                        if (currentTrack && audio.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                          logger.warn('[App] Audio source not supported, clearing audioUrl for reload');
                          setTracks(prev => {
                            const newTracks = [...prev];
                            const idx = newTracks.findIndex(t => t.id === currentTrack.id);
                            if (idx !== -1) {
                              // Only clear audioUrl, keep available as true
                              newTracks[idx] = { ...newTracks[idx], audioUrl: '' };
                            }
                            return newTracks;
                          });
                        }
                      }}            />
          )}

          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept=".flac,.mp3,.m4a,.wav"
            className="hidden"
            onChange={handleFileInputChange}
          />

          <div className="flex-1 p-10 overflow-hidden pt-10">
            <LibraryView
              tracks={tracks}
              currentTrackIndex={currentTrackIndex}
              onTrackSelect={(idx) => {
                // Explicitly mark user intent to play on selection
                shouldAutoPlayRef.current = true;
                forcePlayRef.current = true;
                setCurrentTrackIndex(idx);
                setIsPlaying(true);
              }}
              onRemoveTrack={handleRemoveTrack}
              onRemoveMultipleTracks={handleRemoveMultipleTracks}
              onDropFiles={handleDropFiles}
              isFocusMode={isFocusMode}
            />
          </div>

          <Controls
            track={currentTrack}
            isPlaying={isPlaying}
            currentTime={currentTime}
            volume={volume}
            onTogglePlay={togglePlay}
            onSkipNext={skipForward}
            onSkipPrev={skipBackward}
            onSeek={handleSeek}
            onVolumeChange={handleVolumeChange}
            onToggleMute={handleToggleMute}
            playbackMode={playbackMode}
            onTogglePlaybackMode={handleTogglePlaybackMode}
            onToggleFocus={() => setIsFocusMode(!isFocusMode)}
            isFocusMode={isFocusMode}
            forceUpdateCounter={forceUpdateCounter}
            audioRef={audioRef}
          />
        </main>

        {/* Focus Mode Overlay */}
        <FocusMode
          track={currentTrack}
          isVisible={isFocusMode}
          currentTime={currentTime}
          onClose={() => setIsFocusMode(false)}
          isPlaying={isPlaying}
          onTogglePlay={togglePlay}
          onSkipNext={skipForward}
          onSkipPrev={skipBackward}
          onSeek={handleSeek}
          volume={volume}
          onVolumeChange={handleVolumeChange}
          onToggleMute={handleToggleMute}
          playbackMode={playbackMode}
          onTogglePlaybackMode={handleTogglePlaybackMode}
          onToggleFocus={() => setIsFocusMode(!isFocusMode)}
          audioRef={audioRef}
        />
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default App;
