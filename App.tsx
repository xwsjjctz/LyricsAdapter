
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Track, ViewMode } from './types';
import { parseAudioFile, libraryStorage } from './services/metadataService';
import { getDesktopAPI, getDesktopAPIAsync, isDesktop } from './services/desktopAdapter';
import { metadataCacheService } from './services/metadataCacheService';

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
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.PLAYER);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [forceUpdateCounter, setForceUpdateCounter] = useState(0); // Force re-render after restore

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shouldAutoPlayRef = useRef<boolean>(false); // Track if we should auto-play after track loads
  const waitingForCanPlayRef = useRef<boolean>(false); // Track if we're waiting for canplay event
  const restoredTimeRef = useRef<number>(0); // Track the restored playback time
  const isRestoringTimeRef = useRef<boolean>(false); // Track if we're currently restoring playback time
  const tracksCountRef = useRef<number>(0); // Track actual tracks count for immediate access after deletion

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
      console.log('Audio element created, setting volume to:', volume, '(actual:', actualVolume.toFixed(3), ')');
      node.volume = actualVolume;
    }
  }, [volume, linearToExponentialVolume]);

  // Initialize Desktop API on mount
  useEffect(() => {
    const initDesktopAPI = async () => {
      console.log('[App] Initializing Desktop API...');
      try {
        const api = await getDesktopAPIAsync();
        if (api) {
          console.log('[App] ✓ Desktop API initialized, platform:', api.platform);
        } else {
          console.log('[App] No Desktop API available (running in browser)');
        }
      } catch (error) {
        console.error('[App] Failed to initialize Desktop API:', error);
      }
    };

    initDesktopAPI();

    // Cleanup: revoke all blob URLs on unmount
    return () => {
      console.log('[App] Cleaning up', activeBlobUrlsRef.current.size, 'blob URLs...');
      activeBlobUrlsRef.current.forEach(blobUrl => {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch (e) {
          // Ignore errors during cleanup
        }
      });
      activeBlobUrlsRef.current.clear();
      console.log('[App] ✓ All blob URLs revoked');

      // Also revoke IndexedDB cached blob URLs
      metadataCacheService.revokeAllBlobUrls();
    };
  }, []);

  const currentTrack = currentTrackIndex >= 0 ? tracks[currentTrackIndex] : null;

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !currentTrack) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.error("Playback failed", e));
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, currentTrack]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      // Skip updating if we're in the middle of restoring playback time
      if (isRestoringTimeRef.current) {
        console.log('[App] TimeUpdate: Skipping update, currently restoring playback time');
        return;
      }
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

      // For Tauri, wait for canplay event to restore playback time
      // For Electron/other platforms, try to restore here
      const desktopAPI = getDesktopAPI();
      const isTauri = desktopAPI?.platform === 'tauri';

      if (!isTauri && restoredTimeRef.current > 0) {
        const restoreTime = restoredTimeRef.current;
        console.log('[App] Restoring playback time (non-Tauri):', restoreTime);

        audioRef.current.currentTime = restoreTime;
        setCurrentTime(restoreTime);
        restoredTimeRef.current = 0;
      } else if (isTauri && restoredTimeRef.current > 0) {
        console.log('[App] Tauri detected, will restore time in canplay event');
      }
    }
  };

  const handleTrackEnded = useCallback(() => {
    if (currentTrackIndex < tracks.length - 1) {
      // Mark that we should auto-play the next track
      shouldAutoPlayRef.current = true;
      setCurrentTrackIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
    }
  }, [currentTrackIndex, tracks.length]);

  // Track current blob URLs for cleanup
  const activeBlobUrlsRef = useRef<Set<string>>(new Set());
  const prevTrackBlobUrlRef = useRef<{ id: string | null; url: string | null }>({ id: null, url: null });

  // Helper function to create and track blob URL
  const createTrackedBlobUrl = (file: File): string => {
    const blobUrl = URL.createObjectURL(file);
    activeBlobUrlsRef.current.add(blobUrl);
    console.log('[App] Created blob URL:', blobUrl, 'Total active:', activeBlobUrlsRef.current.size);
    return blobUrl;
  };

  // Helper function to revoke blob URL
  const revokeBlobUrl = (blobUrl: string) => {
    if (blobUrl && blobUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(blobUrl);
        activeBlobUrlsRef.current.delete(blobUrl);
        console.log('[App] Revoked blob URL:', blobUrl, 'Remaining:', activeBlobUrlsRef.current.size);
      } catch (e) {
        console.warn('[App] Failed to revoke blob URL:', blobUrl, e);
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

    console.log(`[App] Cleaning up ${toRevoke.length} unused blob URLs...`);
    toRevoke.forEach(url => revokeBlobUrl(url));
  }, [tracks]);

  // Helper function to load audio file for a track (lazy loading)
  const loadAudioFileForTrack = useCallback(async (track: Track): Promise<Track> => {
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI || !(track as any).filePath || track.audioUrl) {
      return track; // Already loaded or no desktop API
    }

    try {
      console.log('[App] Loading audio file for:', track.title);

      // Check platform
      const platform = desktopAPI.platform;

      if (platform === 'tauri') {
        // Use asset protocol for Tauri (streaming)
        console.log('[App] Using Tauri asset protocol for streaming');
        const assetUrl = await desktopAPI.getAudioUrl((track as any).filePath);

        console.log('[App] ✓ Audio asset URL ready:', assetUrl);

        return {
          ...track,
          audioUrl: assetUrl,
        };
      } else {
        // For Electron, use readFile with blob URL (with lifecycle management)
        console.log('[App] Using readFile + Blob URL for Electron');
        const readResult = await desktopAPI.readFile((track as any).filePath);

        if (readResult.success && readResult.data.byteLength > 0) {
          const fileData = new Uint8Array(readResult.data);
          const file = new File([fileData], (track as any).fileName, { type: 'audio/flac' });
          const audioUrl = createTrackedBlobUrl(file);

          console.log('[App] ✓ Audio loaded, size:', (fileData.length / 1024 / 1024).toFixed(2), 'MB');

          return {
            ...track,
            audioUrl: audioUrl,
            // Don't store File object - blob URL is enough
          };
        } else {
          console.error('[App] Failed to load audio file:', readResult.error);
          return track;
        }
      }
    } catch (error) {
      console.error('[App] Failed to load audio file:', error);
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
          console.log(`[App] 🔄 File "${fileName}" already exists (ID: ${existingTrack.id}), will reuse ID`);
        } else {
          console.log(`[App] 🆕 File "${fileName}" is new, creating new track`);
        }

        // Create symlink
        let savedFilePath = '';
        try {
          const saveResult = await desktopAPI.saveAudioFile(filePath, fileName);
          if (saveResult?.success && saveResult?.filePath) {
            savedFilePath = saveResult.filePath;
            console.log(`[App] ✅ File saved: ${fileName} → ${savedFilePath} (${saveResult.method})`);
          } else {
            console.warn(`[App] ⚠️ saveAudioFile failed for "${fileName}":`, saveResult);
          }
        } catch (error) {
          console.error(`[App] ❌ Failed to save file "${fileName}":`, error);
          return null;
        }

        if (!savedFilePath) {
          console.error(`[App] ❌ saveAudioFile returned empty path for "${fileName}"`);
          return null;
        }

        // Parse with Rust
        let metadata;
        try {
          const parseResult = await desktopAPI.parseAudioMetadata(savedFilePath);
          if (parseResult.success && parseResult.metadata) {
            metadata = parseResult.metadata;
            console.log(`[App] ✅ Parsed metadata for "${fileName}": ${metadata?.title} - ${metadata?.artist}`);
          }
        } catch (error) {
          console.error('[App] Failed to parse metadata:', error);
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
              console.warn('[App] Failed to save cover to IndexedDB:', error);
            }
          } catch (error) {
            console.error('[App] Failed to create cover blob:', error);
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

        console.log(`[App] ✓ Track created: ${track.title} (ID: ${track.id})`);
        return track;
      })
    );

    // Filter out null results (failed files)
    const filtered = results.filter((track): track is Track => track !== null);
    console.log(`[App] Batch complete: ${results.length} total, ${filtered.length} successful, ${results.length - filtered.length} failed`);
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
          console.error('[App] Failed to parse file:', file.name, error);
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
    console.log('[App] Desktop import triggered');
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI) {
      console.error('[App] Desktop API not available');
      return;
    }

    try {
      const result = await desktopAPI.selectFiles();
      if (result.canceled || result.filePaths.length === 0) {
        return;
      }

      const filePaths = result.filePaths;
      console.log(`[App] Processing ${filePaths.length} file(s)...`);
      console.log(`[App] Current tracks count before import (state): ${tracks.length}`);
      console.log(`[App] Current tracks count before import (ref): ${tracksCountRef.current}`);

      // Create Map for O(1) duplicate checking
      const tracksMap = createTracksMap();
      console.log(`[App] Created tracksMap with ${tracksMap.size} entries`);

      // Process files in batches with parallel processing
      const BATCH_SIZE = 10;
      const UI_UPDATE_BATCH = 20;
      const allNewTracks: Track[] = [];
      let totalProcessed = 0;
      let totalFailed = 0;

      console.log(`[App] ===== Starting Import Process =====`);
      console.log(`[App] Total files to import: ${filePaths.length}`);

      for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        const batch = filePaths.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(filePaths.length / BATCH_SIZE);

        console.log(`[App] 📦 Batch ${batchNumber}/${totalBatches}: ${batch.length} files`);
        console.log(`[App] Files in this batch:`, batch.map(f => f.split(/[/\\]/).pop()));

        // Process this batch in parallel
        const batchTracks = await processDesktopFileBatch(batch, desktopAPI, tracksMap);

        // Filter out null (failed) tracks and count
        const successfulTracks = batchTracks.filter((track): track is Track => track !== null);
        const failedCount = batch.length - successfulTracks.length;

        totalProcessed += batch.length;
        totalFailed += failedCount;

        console.log(`[App] ✅ Batch ${batchNumber} result: ${successfulTracks.length} succeeded, ${failedCount} failed`);

        allNewTracks.push(...successfulTracks);

        // Update UI every UI_UPDATE_BATCH tracks
        if (allNewTracks.length >= UI_UPDATE_BATCH) {
          console.log(`[App] 🎨 UI update threshold reached (${allNewTracks.length} tracks)`);
          console.log(`[App] Current tracks count before update (state): ${tracks.length}`);
          console.log(`[App] Current tracks count before update (ref): ${tracksCountRef.current}`);

          // Capture the current batch size
          const batchSize = allNewTracks.length;

          setTracks(prev => {
            const newTracks = [...prev, ...allNewTracks];
            console.log(`[App] ✏️ Updating tracks: ${prev.length} → ${newTracks.length} (added ${allNewTracks.length})`);
            return newTracks;
          });

          // Update ref immediately
          tracksCountRef.current = tracksCountRef.current + batchSize;
          console.log(`[App] tracksCountRef updated to: ${tracksCountRef.current}`);
          console.log(`[App] ✓ UI updated, scheduling batch buffer clear`);

          // CRITICAL: Clear array AFTER setTracks callback executes (use setTimeout)
          setTimeout(() => {
            allNewTracks.length = 0;
            console.log(`[App] ✓ Batch buffer cleared`);
          }, 0);
        }
      }

      // Add remaining tracks
      if (allNewTracks.length > 0) {
        console.log(`[App] Final UI update with ${allNewTracks.length} track(s)...`);
        const finalBatchSize = allNewTracks.length;
        setTracks(prev => {
          const newTracks = [...prev, ...allNewTracks];
          console.log(`[App] ✏️ Final update: ${prev.length} → ${newTracks.length} (added ${allNewTracks.length})`);
          return newTracks;
        });
        tracksCountRef.current = tracksCountRef.current + finalBatchSize;
        console.log(`[App] tracksCountRef updated to: ${tracksCountRef.current}`);
      }

      // Wait a bit for state to update, then save
      await new Promise(resolve => setTimeout(resolve, 100));

      // Save cache once at the end
      console.log('[App] Saving metadata cache...');
      await metadataCacheService.save();

      // Summary report
      console.log(`[App] ===== Import Summary =====`);
      console.log(`[App] Total processed: ${totalProcessed}`);
      console.log(`[App] Successfully imported: ${totalProcessed - totalFailed}`);
      console.log(`[App] Failed: ${totalFailed}`);

      if (totalFailed > 0) {
        console.error(`[App] ⚠️ ${totalFailed} file(s) failed to import! Check console above for details.`);
      } else {
        console.log(`[App] ✓ All files imported successfully`);
      }

      // Manually trigger library save after import to ensure all tracks are saved
      console.log('[App] Manually triggering library save after import...');
      console.log(`[App] Saving ${tracks.length} tracks to disk...`);
      await libraryStorage.saveLibrary({
        songs: tracks,
        settings: {
          volume: volume,
          currentTrackIndex: currentTrackIndex,
          currentTime: currentTime,
          isPlaying: isPlaying
        }
      });
      console.log('[App] ✓ Manual library save completed');
    } catch (error) {
      console.error('[App] Failed to import files:', error);
    }
  };

  // Handle dropped files (for drag & drop import in Web environment)
  const handleDropFiles = async (files: File[]) => {
    console.log('[App] Drop import triggered');
    console.log(`[App] Processing ${files.length} file(s)...`);

    // Create Map for O(1) duplicate checking
    const tracksMap = createTracksMap();

    // Process files in batches with parallel processing
    const BATCH_SIZE = 10;
    const UI_UPDATE_BATCH = 20;
    const allNewTracks: Track[] = [];

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      console.log(`[App] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)} (${batch.length} files)`);

      // Process this batch in parallel
      const batchTracks = await processWebFileBatch(batch, tracksMap);
      allNewTracks.push(...batchTracks);

      // Update UI every UI_UPDATE_BATCH tracks
      if (allNewTracks.length >= UI_UPDATE_BATCH) {
        console.log(`[App] Updating UI with ${allNewTracks.length} new track(s)...`);
        setTracks(prev => [...prev, ...allNewTracks]);
        allNewTracks.length = 0;
      }
    }

    // Add remaining tracks
    if (allNewTracks.length > 0) {
      console.log(`[App] Final UI update with ${allNewTracks.length} track(s)...`);
      setTracks(prev => [...prev, ...allNewTracks]);
    }

    console.log('[App] ✓ All files imported successfully');
  };

  // File input change handler (for Electron and Web)
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    console.log('[App] File input changed - platform:', (window as any).electron ? 'Electron' : (window as any).__TAURI__ ? 'Tauri' : 'Web');
    console.log(`[App] Processing ${files.length} file(s)...`);

    // Create Map for O(1) duplicate checking
    const tracksMap = createTracksMap();

    // Process files in batches with parallel processing
    const BATCH_SIZE = 10;
    const UI_UPDATE_BATCH = 20;
    const allNewTracks: Track[] = [];

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      console.log(`[App] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)} (${batch.length} files)`);

      // Process this batch in parallel
      const batchTracks = await processWebFileBatch(batch, tracksMap);
      allNewTracks.push(...batchTracks);

      // Update UI every UI_UPDATE_BATCH tracks
      if (allNewTracks.length >= UI_UPDATE_BATCH) {
        console.log(`[App] Updating UI with ${allNewTracks.length} new track(s)...`);
        setTracks(prev => [...prev, ...allNewTracks]);
        allNewTracks.length = 0;
      }
    }

    // Add remaining tracks
    if (allNewTracks.length > 0) {
      console.log(`[App] Final UI update with ${allNewTracks.length} track(s)...`);
      setTracks(prev => [...prev, ...allNewTracks]);
    }

    console.log('[App] ✓ All files imported successfully');

    // Reset input value
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const skipForward = useCallback(() => {
    if (currentTrackIndex < tracks.length - 1) {
      // Always auto-play when changing tracks
      shouldAutoPlayRef.current = true;
      setCurrentTrackIndex(prev => prev + 1);
    }
  }, [currentTrackIndex, tracks.length]);

  const skipBackward = useCallback(() => {
    if (currentTrackIndex > 0) {
      // Always auto-play when changing tracks
      shouldAutoPlayRef.current = true;
      setCurrentTrackIndex(prev => prev - 1);
    } else if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  }, [currentTrackIndex]);

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  // Handle canplay event - when audio is ready to play
  const handleCanPlay = useCallback(() => {
    console.log('[App] Audio is ready to play');

    // Check if we need to restore playback time for Tauri
    const desktopAPI = getDesktopAPI();
    const isTauri = desktopAPI?.platform === 'tauri';

    if (isTauri && restoredTimeRef.current > 0 && audioRef.current) {
      const restoreTime = restoredTimeRef.current;
      console.log('[App] Tauri: Restoring playback time in canplay:', restoreTime);
      console.log('[App] Tauri: Current audio currentTime before restore:', audioRef.current.currentTime);

      // Set the restoring flag to prevent timeupdate from interfering
      isRestoringTimeRef.current = true;

      // Use a promise to ensure the time is set correctly
      const restorePlaybackTime = async () => {
        if (!audioRef.current) return;

        try {
          // Set the time
          audioRef.current.currentTime = restoreTime;

          // Wait a bit for the browser to process the change
          await new Promise(resolve => setTimeout(resolve, 10));

          // Verify it was set correctly
          const actualTime = audioRef.current.currentTime;
          console.log('[App] Tauri: Audio currentTime after first attempt:', actualTime);

          if (Math.abs(actualTime - restoreTime) > 0.1) {
            console.log('[App] Tauri: Time not set correctly, retrying...');
            audioRef.current.currentTime = restoreTime;
            await new Promise(resolve => setTimeout(resolve, 10));

            const retryTime = audioRef.current.currentTime;
            if (Math.abs(retryTime - restoreTime) > 0.1) {
              console.warn('[App] Tauri: Failed to restore playback time after retry');
              console.log('[App] Tauri: Expected:', restoreTime, 'Got:', retryTime);
            } else {
              console.log('[App] Tauri: ✓ Playback time restored after retry:', retryTime);
            }
          } else {
            console.log('[App] Tauri: ✓ Playback time restored successfully:', actualTime);
          }

          // Update state to match immediately
          console.log('[App] Tauri: Calling setCurrentTime with:', restoreTime);
          setCurrentTime(restoreTime);

          // Force a re-render to ensure UI updates
          console.log('[App] Tauri: Forcing re-render with counter increment');
          setForceUpdateCounter(prev => prev + 1);

          // Force a time update by reading currentTime again
          setTimeout(() => {
            if (audioRef.current) {
              const finalTime = audioRef.current.currentTime;
              console.log('[App] Tauri: Final verification - currentTime is:', finalTime);
              if (Math.abs(finalTime - restoreTime) > 0.1) {
                console.warn('[App] Tauri: Warning - currentTime changed after state update!');
              }
            }
          }, 50);
        } catch (error) {
          console.error('[App] Tauri: Error restoring playback time:', error);
        } finally {
          // Clear the refs
          restoredTimeRef.current = 0;
          // Clear the restoring flag after a short delay to ensure state update is processed
          setTimeout(() => {
            isRestoringTimeRef.current = false;
            console.log('[App] Tauri: ✓ Restoring flag cleared');
          }, 100);
        }
      };

      restorePlaybackTime();
    }

    // If we were waiting for this event to play, play now
    if (waitingForCanPlayRef.current && audioRef.current) {
      waitingForCanPlayRef.current = false;
      console.log('[App] Attempting playback after canplay');
      audioRef.current.play().then(() => {
        console.log('[App] ✓ Playback started after canplay');
        setIsPlaying(true);
      }).catch((e) => {
        console.log('[App] Playback failed after canplay:', e);
        setIsPlaying(false);
      });
    }
  }, []);

  useEffect(() => {
    if (audioRef.current && currentTrack) {
      // Load audio file if not loaded yet (lazy loading)
      if (!currentTrack.audioUrl && (currentTrack as any).filePath) {
        console.log('[App] Lazy loading audio for:', currentTrack.title);

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

      // Reset waiting flag when track changes
      if (waitingForCanPlayRef.current) {
        waitingForCanPlayRef.current = false;
      }

      // Check if we need to restore playback time
      if (restoredTimeRef.current > 0) {
        console.log('[App] Need to restore playback time:', restoredTimeRef.current);
      }

      // Only attempt playback if audioUrl is loaded
      if (currentTrack.audioUrl) {
        // For Tauri, we need to wait for canplay event before attempting playback
        // The restoration will happen in handleCanPlay
        const desktopAPI = getDesktopAPI();
        const isTauri = desktopAPI?.platform === 'tauri';

        if (isTauri && restoredTimeRef.current > 0) {
          console.log('[App] Tauri detected, will restore time in canplay event');
        }

        if (isPlaying || shouldAutoPlayRef.current) {
          // Clear the auto-play flag
          shouldAutoPlayRef.current = false;

          audioRef.current.play().then(() => {
            console.log('[App] ✓ Playback started successfully');
          }).catch((e) => {
            console.log('[App] Playback failed, waiting for canplay:', e);
            // If play fails, wait for canplay event (especially for Tauri asset protocol)
            waitingForCanPlayRef.current = true;
            // Don't set isPlaying to false yet - wait for canplay event
          });
        } else {
          audioRef.current.pause();
        }
      } else {
        // No audioUrl available, pause if playing
        if (isPlaying) {
          audioRef.current.pause();
          setIsPlaying(false);
        }
      }
    }
  }, [currentTrackIndex, isPlaying, currentTrack, loadAudioFileForTrack]);

  // Preload adjacent tracks for instant playback
  useEffect(() => {
    const preloadAdjacent = async () => {
      if (currentTrackIndex < 0 || !isDesktop()) return;

      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI) return;

      // Preload next track
      if (currentTrackIndex < tracks.length - 1) {
        const nextTrack = tracks[currentTrackIndex + 1];
        if (!nextTrack.audioUrl && (nextTrack as any).filePath) {
          console.log('[App] Preloading next track:', nextTrack.title);
          loadAudioFileForTrack(nextTrack).then(updatedTrack => {
            setTracks(prev => {
              const newTracks = [...prev];
              newTracks[currentTrackIndex + 1] = updatedTrack;
              return newTracks;
            });
          });
        }
      }

      // Preload previous track
      if (currentTrackIndex > 0) {
        const prevTrack = tracks[currentTrackIndex - 1];
        if (!prevTrack.audioUrl && (prevTrack as any).filePath) {
          console.log('[App] Preloading previous track:', prevTrack.title);
          loadAudioFileForTrack(prevTrack).then(updatedTrack => {
            setTracks(prev => {
              const newTracks = [...prev];
              newTracks[currentTrackIndex - 1] = updatedTrack;
              return newTracks;
            });
          });
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
      console.log('Volume changed to:', volume, '(actual:', actualVolume.toFixed(3), ')');
      audioRef.current.volume = actualVolume;
    }
  }, [volume, linearToExponentialVolume]);

  // Load library from disk on mount (Desktop only)
  useEffect(() => {
    const loadLibraryFromDisk = async () => {
      console.log('[App] Loading library from disk...');
      // Initialize metadata cache first
      await metadataCacheService.initialize();

      // Wait for Desktop API to be initialized
      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI) {
        console.log('[App] Not running in Desktop mode, skipping library load');
        return;
      }

      try {
        const libraryData = await libraryStorage.loadLibrary();
        console.log('[App] Library loaded from disk:', libraryData);

        // Restore volume from settings
        if (libraryData.settings?.volume !== undefined) {
          console.log('Restoring volume:', libraryData.settings.volume);
          setVolume(libraryData.settings.volume);
        }

        if (libraryData.songs && libraryData.songs.length > 0) {
          // Validate file paths first
          const validationResults = await libraryStorage.validateAllPaths(libraryData.songs);
          const missingFiles = validationResults.filter(r => !r.exists);

          if (missingFiles.length > 0) {
            console.warn(`Found ${missingFiles.length} missing files`);
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
                console.log(`[App] ✓ Using cached metadata for: ${song.title}`);
                const cachedMetadata = metadataCacheService.cachedToTrack(cached, song.filePath, song.id);

                // Try to load cover from IndexedDB first (NEW - much faster!)
                let coverUrl = `https://picsum.photos/seed/${encodeURIComponent(song.fileName)}/1000/1000`;
                let coverBlob: Blob | null = null;

                if (cached.coverData && cached.coverMime) {
                  // We have cover data in cache, try to load from IndexedDB
                  try {
                    const indexedDBCoverUrl = await metadataCacheService.loadCover(song.id);
                    if (indexedDBCoverUrl) {
                      coverUrl = indexedDBCoverUrl;
                      console.log(`[App] ✓ Loaded cover from IndexedDB for: ${song.title}`);
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
                        console.warn('[App] Failed to save cover to IndexedDB:', error);
                      }
                    }
                  } catch (error) {
                    console.warn('[App] Failed to load cover from cache, will re-parse:', error);
                  }
                }

                // If we still don't have a cover, try re-parsing the file
                if (!coverBlob && !cached.coverData) {
                  console.log(`[App] Cover not cached, re-parsing file: ${song.title}`);
                  let parsedMetadata = null;
                  try {
                    const parseResult = await desktopAPI.parseAudioMetadata(song.filePath);
                    if (parseResult.success && parseResult.metadata) {
                      parsedMetadata = parseResult.metadata;
                    }
                  } catch (e) {
                    console.error('[App] Failed to parse cover art:', e);
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
                    console.log(`[App] ✓ Extracted cover art from file: ${song.title}`);

                    // Save cover to IndexedDB
                    try {
                      await metadataCacheService.saveCover(song.id, blob);
                    } catch (error) {
                      console.warn('[App] Failed to save cover to IndexedDB:', error);
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
                // No cache or invalid, parse with Rust NOW (fast!)
                console.log(`[App] No cache for: ${song.title}, parsing with Rust...`);
                let parsedMetadata = null;

                try {
                  const parseResult = await desktopAPI.parseAudioMetadata(song.filePath);
                  if (parseResult.success && parseResult.metadata) {
                    parsedMetadata = parseResult.metadata;

                    // Cache the parsed metadata (NOT including coverData to avoid localStorage quota exceeded)
                    metadataCacheService.set(song.id, {
                      title: parsedMetadata.title,
                      artist: parsedMetadata.artist,
                      album: parsedMetadata.album,
                      duration: parsedMetadata.duration,
                      lyrics: parsedMetadata.lyrics,
                      syncedLyrics: parsedMetadata.syncedLyrics,
                      coverData: parsedMetadata.coverData,  // ✅ Now cached in IndexedDB!
                      coverMime: parsedMetadata.coverMime,
                      fileName: song.fileName,
                      fileSize: 1,
                      lastModified: Date.now(),
                    });
                  }
                } catch (e) {
                  console.error('[App] Failed to parse with Rust:', e);
                }

                if (parsedMetadata) {
                  // Use parsed metadata
                  let coverUrl = `https://picsum.photos/seed/${encodeURIComponent(song.fileName)}/1000/1000`;
                  if (parsedMetadata.coverData && parsedMetadata.coverMime) {
                    const byteCharacters = atob(parsedMetadata.coverData);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                      byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: parsedMetadata.coverMime });
                    coverUrl = createTrackedBlobUrl(blob); // Use tracked blob URL

                    // Save cover to IndexedDB
                    try {
                      await metadataCacheService.saveCover(song.id, blob);
                    } catch (error) {
                      console.warn('[App] Failed to save cover to IndexedDB:', error);
                    }
                  }

                  restoredTrack = {
                    ...song,
                    title: parsedMetadata.title,
                    artist: parsedMetadata.artist,
                    album: parsedMetadata.album,
                    duration: parsedMetadata.duration,
                    lyrics: parsedMetadata.lyrics,
                    syncedLyrics: parsedMetadata.syncedLyrics,
                    audioUrl: '', // Will be loaded on play
                    coverUrl: coverUrl,
                    available: true
                  };
                } else {
                  // Parse failed, use placeholder
                  restoredTrack = {
                    ...song,
                    audioUrl: '', // Will be loaded on play
                    coverUrl: `https://picsum.photos/seed/${encodeURIComponent(song.fileName)}/1000/1000`,
                    available: true
                  };
                }
              }
            }

            // Add to tracks array
            loadedTracks.push(restoredTrack);

            // Update UI every BATCH_SIZE songs or at the end
            if (loadedTracks.length % BATCH_SIZE === 0 || i === libraryData.songs.length - 1) {
              setTracks([...loadedTracks]);
              console.log(`[App] ✓ Loaded ${loadedTracks.length}/${libraryData.songs.length} tracks`);
              // Small delay to let UI render
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }

          // Save cache if we updated it
          await metadataCacheService.save();
          console.log(`[App] ✓ Finished loading ${loadedTracks.length} tracks`);

          // Restore playback state from settings
          console.log('[App] Checking for playback state to restore...');
          console.log('[App] libraryData.settings:', libraryData.settings);
          console.log('[App] currentTrackIndex:', libraryData.settings?.currentTrackIndex);
          console.log('[App] currentTime:', libraryData.settings?.currentTime);
          console.log('[App] isPlaying:', libraryData.settings?.isPlaying);
          
          if (libraryData.settings?.currentTrackIndex !== undefined &&
              libraryData.settings?.currentTrackIndex >= 0 &&
              libraryData.settings?.currentTrackIndex < loadedTracks.length) {
            console.log('[App] ✓ Restoring playback state:');
            console.log('  - Track index:', libraryData.settings.currentTrackIndex);
            console.log('  - Current time:', libraryData.settings.currentTime);
            console.log('  - Is playing:', libraryData.settings.isPlaying);

            // Save restored time to ref (will be restored when audio is ready)
            if (libraryData.settings.currentTime !== undefined) {
              const restoredTime = libraryData.settings.currentTime;
              restoredTimeRef.current = restoredTime;
              console.log('[App] ✓ Saved restored time to ref:', restoredTime);
              // Don't setCurrentTime here - will be set when audio is ready
            }

            // Restore track index
            setCurrentTrackIndex(libraryData.settings.currentTrackIndex);

            // Always set to paused, do not auto-play
            setIsPlaying(false);
            shouldAutoPlayRef.current = false;
          } else {
            console.log('[App] No playback state to restore or invalid track index');
          }

          // Preload first 3 songs for instant playback
          const PRELOAD_COUNT = 3;
          const tracksToPreload = Math.min(PRELOAD_COUNT, loadedTracks.length);

          for (let i = 0; i < tracksToPreload; i++) {
            const track = loadedTracks[i];
            if ((track as any).filePath && !track.audioUrl) {
              console.log(`[App] Preloading song ${i + 1}/${PRELOAD_COUNT}:`, track.title);
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
        console.error('Failed to load library:', error);
      }
    };

    loadLibraryFromDisk();
  }, []);

  // Sync tracksCountRef with tracks.length (for immediate access after deletion)
  useEffect(() => {
    tracksCountRef.current = tracks.length;
    console.log(`[App] tracksCountRef synced to: ${tracks.length}`);
  }, [tracks.length]);

  // Auto-save library to disk when tracks change (Desktop only, debounced)
  useEffect(() => {
    if (isDesktop()) {
      console.log('🔄 Tracks or volume changed, triggering auto-save...');

      // Prepare library data for saving
      const libraryData = {
        songs: tracks.map(track => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          lyrics: track.lyrics,
          syncedLyrics: track.syncedLyrics,
          filePath: (track as any).filePath || '',
          fileName: (track as any).fileName || '',
          fileSize: (track as any).fileSize || 0,
          lastModified: (track as any).lastModified || 0,
          addedAt: (track as any).addedAt || new Date().toISOString(),
          playCount: (track as any).playCount || 0,
          lastPlayed: (track as any).lastPlayed || null,
          available: track.available ?? true
        })),
        settings: {
          volume: volume,
          currentTrackIndex: currentTrackIndex,
          currentTime: currentTime,
          isPlaying: isPlaying
        }
      };

      console.log(`📦 Prepared library data: ${libraryData.songs.length} songs`);
      console.log('📦 Settings:', libraryData.settings);
      console.log('  - volume:', libraryData.settings.volume);
      console.log('  - currentTrackIndex:', libraryData.settings.currentTrackIndex);
      console.log('  - currentTime:', libraryData.settings.currentTime);
      console.log('  - isPlaying:', libraryData.settings.isPlaying);

      // Debounced save
      libraryStorage.saveLibraryDebounced(libraryData);
    }
  }, [tracks, volume]);

  // Save library before app quits
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (isDesktop()) {
        const libraryData = {
          songs: tracks.map(track => ({
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            lyrics: track.lyrics,
            syncedLyrics: track.syncedLyrics,
            filePath: (track as any).filePath || '',
            fileName: (track as any).fileName || '',
            fileSize: (track as any).fileSize || 0,
            lastModified: (track as any).lastModified || 0,
            addedAt: (track as any).addedAt || new Date().toISOString(),
            playCount: (track as any).playCount || 0,
            lastPlayed: (track as any).lastPlayed || null,
            available: track.available ?? true
          })),
          settings: {
            volume: volume,
            currentTrackIndex: currentTrackIndex,
            currentTime: currentTime,
            isPlaying: isPlaying
          }
        };

        // Immediate save (no debounce) on quit
        console.log('💾 Saving library before quit...');
        await libraryStorage.saveLibrary(libraryData);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [tracks, volume, currentTrackIndex, currentTime, isPlaying]);

  // Remove track function
  const handleRemoveTrack = useCallback(async (trackId: string) => {
    // Find the track to remove
    const trackToRemove = tracks.find(t => t.id === trackId);

    // Revoke blob URLs
    if (trackToRemove) {
      // Revoke audio blob URL
      if (trackToRemove.audioUrl && trackToRemove.audioUrl.startsWith('blob:')) {
        revokeBlobUrl(trackToRemove.audioUrl);
      }

      // Revoke cover blob URL
      if (trackToRemove.coverUrl && trackToRemove.coverUrl.startsWith('blob:')) {
        revokeBlobUrl(trackToRemove.coverUrl);
      }
    }

    // In Desktop (Electron/Tauri), delete the symlink file first
    const desktopAPI = await getDesktopAPIAsync();
    if (desktopAPI) {
      if (trackToRemove && (trackToRemove as any).filePath) {
        try {
          const result = await desktopAPI.deleteAudioFile((trackToRemove as any).filePath);
          if (result.success) {
            console.log(`✅ Symlink deleted for track: ${trackToRemove.title}`);
          }
        } catch (error) {
          console.error('Failed to delete symlink:', error);
          // Continue with track removal even if symlink deletion fails
        }
      }
    }

    // Delete cover from IndexedDB
    try {
      await metadataCacheService.deleteCover(trackId);
      console.log(`✅ Cover deleted from IndexedDB for track: ${trackToRemove?.title || trackId}`);
    } catch (error) {
      console.warn('Failed to delete cover from IndexedDB:', error);
    }

    // Use functional update to avoid race conditions
    setTracks(prev => {
      const newTracks = prev.filter(t => t.id !== trackId);

      // Find the index of the removed track in the previous array
      const removedIndex = prev.findIndex(t => t.id === trackId);

      // Update current track index IMMEDIATELY (not in setTimeout) to avoid out-of-bounds during batch deletion
      setCurrentTrackIndex(prevIndex => {
        // If no tracks left, reset player
        if (newTracks.length === 0) {
          // Stop playback if no tracks remain
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
          }
          setIsPlaying(false);
          return -1;
        }

        // If removed track wasn't found, keep current index
        if (removedIndex < 0) return prevIndex;

        // If the removed track was before or at current position, adjust index
        if (removedIndex <= prevIndex) {
          // Decrease index by 1, but don't go below 0
          const newIndex = Math.max(0, prevIndex - 1);
          // If index is now beyond array bounds, clamp it
          return newIndex >= newTracks.length ? Math.max(0, newTracks.length - 1) : newIndex;
        }

        return prevIndex;
      });

      return newTracks;
    });
  }, [tracks]);

  // Remove multiple tracks at once (batch deletion)
  const handleRemoveMultipleTracks = useCallback(async (trackIds: string[]) => {
    console.log(`[App] Batch removing ${trackIds.length} tracks...`);

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
            console.error(`Failed to delete file for ${track.title}:`, error);
          }
        }
      }
    }

    // Delete covers from IndexedDB for all tracks
    for (const trackId of trackIds) {
      try {
        await metadataCacheService.deleteCover(trackId);
      } catch (error) {
        console.warn(`Failed to delete cover for ${trackId} from IndexedDB:`, error);
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

        console.log(`[App] Current track index: ${prevIndex} → ${newIndex} (removed ${removedBeforeCurrent} tracks before current)`);
        return newIndex;
      });

      return newTracks;
    });

    // Update ref immediately for use in subsequent operations
    tracksCountRef.current = tracks.length - trackIds.length;
    console.log(`[App] tracksCountRef updated to: ${tracksCountRef.current}`);

    console.log(`[App] ✓ Batch removal complete: ${trackIds.length} tracks removed`);
  }, [tracks]);

  // Reload files in Desktop (Electron/Tauri)
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
              console.log(`File saved (${saveResult.method}):`, saveResult.filePath);

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
                    console.warn('[App] Failed to save cover to IndexedDB:', error);
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
            console.error('Failed to reload file:', filePath, error);
          }
        }
      }

      setTracks(updatedTracks);
      console.log(`Reloaded ${reloadedCount} files`);

      // Save cache if we updated it
      if (reloadedCount > 0) {
        await metadataCacheService.save();
      }
    } catch (error) {
      console.error('Failed to reload files:', error);
    }
  }, [tracks]);

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden bg-background-dark font-sans relative">
        <TitleBar />
        <div className="flex flex-1">
          <Sidebar
          onImportClick={() => {
            // Check if running in Desktop environment (Electron or Tauri)
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
            />
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
              onTrackSelect={(idx) => { setCurrentTrackIndex(idx); setIsPlaying(true); }}
              onRemoveTrack={handleRemoveTrack}
              onRemoveMultipleTracks={handleRemoveMultipleTracks}
              onDropFiles={handleDropFiles}
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
            onVolumeChange={setVolume}
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
          onVolumeChange={setVolume}
          audioRef={audioRef}
        />
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default App;
