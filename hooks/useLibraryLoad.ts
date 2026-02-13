import { useEffect } from 'react';
import { Track } from '../types';
import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { libraryStorage } from '../services/metadataService';
import { metadataCacheService } from '../services/metadataCacheService';
import { buildLibraryIndexData } from '../services/librarySerializer';
import { indexedDBStorage } from '../services/indexedDBStorage';
import { logger } from '../services/logger';

interface UseLibraryLoadOptions {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentTrackIndex: number;
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  currentTime: number;
  setCurrentTrackIndex: React.Dispatch<React.SetStateAction<number>>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setVolume: React.Dispatch<React.SetStateAction<number>>;
  setPlaybackMode: React.Dispatch<React.SetStateAction<'order' | 'shuffle' | 'repeat-one'>>;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  restoredTimeRef: React.MutableRefObject<number>;
  restoredTrackIdRef: React.MutableRefObject<string | null>;
  shouldAutoPlayRef: React.MutableRefObject<boolean>;
  persistedTimeRef: React.MutableRefObject<number>;
}

export function useLibraryLoad({
  tracks,
  setTracks,
  currentTrackIndex,
  currentTrack,
  isPlaying,
  volume,
  playbackMode,
  currentTime,
  setCurrentTrackIndex,
  setIsPlaying,
  setVolume,
  setPlaybackMode,
  audioRef,
  restoredTimeRef,
  restoredTrackIdRef,
  shouldAutoPlayRef,
  persistedTimeRef
}: UseLibraryLoadOptions) {
  // Helper function to load library data and restore state
  const loadAndRestoreLibrary = async (libraryData: { songs: any[]; settings: any }, isBrowserMode: boolean) => {
    logger.debug('[LibraryLoad] Library data loaded:', libraryData);
    logger.debug('[LibraryLoad] ✅ Library data loaded:');
    logger.debug(`   - Songs count: ${libraryData.songs?.length || 0}`);
    logger.debug(`   - Settings:`, libraryData.settings);

    if (libraryData.settings?.volume !== undefined) {
      logger.debug('Restoring volume:', libraryData.settings.volume);
      setVolume(libraryData.settings.volume);
    }

    if (libraryData.settings?.playbackMode) {
      logger.debug('Restoring playback mode:', libraryData.settings.playbackMode);
      setPlaybackMode(libraryData.settings.playbackMode);
    }

    if (libraryData.songs && libraryData.songs.length > 0) {
      logger.debug(`[LibraryLoad] 📝 Found ${libraryData.songs.length} songs in library index, fast-loading...`);
      logger.debug('[LibraryLoad] First 3 songs:', libraryData.songs.slice(0, 3).map(s => ({ id: s.id, title: s.title, fileName: s.fileName })));
    } else {
      logger.warn('[LibraryLoad] ⚠️ No songs found in library data!');
    }

    const loadedTracks: Track[] = (libraryData.songs || []).map(song => {
      const fileName = song.fileName || '';
      const fallbackTitle = song.title || fileName.replace(/\.[^/.]+$/, '');
      return {
        id: song.id,
        title: fallbackTitle,
        artist: song.artist || 'Unknown Artist',
        album: song.album || 'Unknown Album',
        duration: song.duration || 0,
        lyrics: song.lyrics || '',
        syncedLyrics: song.syncedLyrics,
        coverUrl: song.coverUrl || `https://picsum.photos/seed/${encodeURIComponent(fileName || song.id)}/1000/1000`,
        audioUrl: '',
        file: undefined,
        fileName: song.fileName,
        filePath: song.filePath,
        fileSize: song.fileSize,
        lastModified: song.lastModified,
        addedAt: song.addedAt,
        playCount: song.playCount,
        lastPlayed: song.lastPlayed || undefined,
        available: song.available ?? true
      } as Track;
    });

    setTracks(loadedTracks);
    logger.debug(`[LibraryLoad] ✓ Fast-loaded ${loadedTracks.length} tracks`);

    logger.debug('[LibraryLoad] Checking for playback state to restore...');
    logger.debug('[LibraryLoad] libraryData.settings:', libraryData.settings);
    logger.debug('[LibraryLoad] currentTrackIndex:', libraryData.settings?.currentTrackIndex);
    logger.debug('[LibraryLoad] currentTime:', libraryData.settings?.currentTime);
    logger.debug('[LibraryLoad] isPlaying:', libraryData.settings?.isPlaying);

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
      logger.debug('[LibraryLoad] ✓ Restoring playback state:');
      logger.debug('  - Track index:', restoredIndex);
      logger.debug('  - Current time:', libraryData.settings.currentTime);
      logger.debug('  - Is playing:', libraryData.settings.isPlaying);

      if (libraryData.settings.currentTime !== undefined) {
        const restoredTime = libraryData.settings.currentTime;
        restoredTimeRef.current = restoredTime;
        restoredTrackIdRef.current = loadedTracks[restoredIndex].id;
        logger.debug('[LibraryLoad] ✓ Saved restored time to ref:', restoredTime);
      }

      setCurrentTrackIndex(restoredIndex);

      setIsPlaying(false);
      shouldAutoPlayRef.current = false;
    } else {
      logger.debug('[LibraryLoad] No playback state to restore or invalid track index');
    }

    const scheduleIdle = (task: () => void) => {
      if (typeof (window as any).requestIdleCallback === 'function') {
        return (window as any).requestIdleCallback(task, { timeout: 2000 });
      }
      return window.setTimeout(task, 800);
    };

    scheduleIdle(() => {
      metadataCacheService.initialize().catch(err => {
        logger.warn('[LibraryLoad] Metadata cache init failed:', err);
      });
    });

    // Only validate paths in Desktop mode
    if (!isBrowserMode && loadedTracks.length > 0) {
      scheduleIdle(() => {
        libraryStorage.validateAllPaths(loadedTracks).then(results => {
          const map = new Map(results.map(r => [r.id, r.exists]));
          setTracks(prev => {
            let changed = false;
            const next = prev.map(track => {
              const exists = map.get(track.id);
              if (exists === undefined || track.available === exists) return track;
              changed = true;
              return { ...track, available: exists };
            });
            return changed ? next : prev;
          });
        }).catch(err => {
          logger.warn('[LibraryLoad] Background path validation failed:', err);
        });
      });
    }
  };

  useEffect(() => {
    const loadLibraryFromDisk = async () => {
      logger.debug('[LibraryLoad] Loading library...');
      const desktopAPI = await getDesktopAPIAsync();

      if (desktopAPI) {
        // Electron mode: load from disk
        logger.debug('[LibraryLoad] Running in Desktop mode, loading from disk...');
        try {
          const libraryData = await libraryStorage.loadLibrary();
          await loadAndRestoreLibrary(libraryData, false);
        } catch (error) {
          logger.error('Failed to load library from disk:', error);
        }
      } else {
        // Browser mode: load from IndexedDB
        logger.debug('[LibraryLoad] Running in Browser mode, loading from IndexedDB...');
        try {
          const libraryData = await indexedDBStorage.loadLibrary();
          if (libraryData) {
            await loadAndRestoreLibrary(libraryData, true);
          } else {
            logger.debug('[LibraryLoad] No library found in IndexedDB');
          }
        } catch (error) {
          logger.error('Failed to load library from IndexedDB:', error);
        }
      }
    };

    loadLibraryFromDisk();
  }, [
    restoredTimeRef,
    restoredTrackIdRef,
    setCurrentTrackIndex,
    setIsPlaying,
    setPlaybackMode,
    setTracks,
    setVolume,
    shouldAutoPlayRef
  ]);

  useEffect(() => {
    const libraryData = buildLibraryIndexData(tracks, {
      volume: volume,
      currentTrackIndex: currentTrackIndex,
      currentTrackId: currentTrack?.id,
      currentTime: persistedTimeRef.current || currentTime,
      isPlaying: isPlaying,
      playbackMode: playbackMode
    });

    logger.debug(`📦 Prepared library data: ${libraryData.songs.length} songs`);
    logger.debug('📦 Settings:', libraryData.settings);

    if (isDesktop()) {
      logger.debug('🔄 Running in Desktop mode, saving to disk...');
      libraryStorage.saveLibraryDebounced(libraryData);
    } else {
      // Browser mode: save to IndexedDB
      logger.debug('🔄 Running in Browser mode, saving to IndexedDB...');
      indexedDBStorage.saveLibrary(libraryData).catch(err => {
        logger.warn('[LibraryLoad] Failed to save library to IndexedDB:', err);
      });
    }
  }, [tracks, volume, currentTrackIndex, isPlaying, currentTrack?.id, playbackMode, currentTime, persistedTimeRef]);

  useEffect(() => {
    if (!isDesktop()) return;

    persistedTimeRef.current = 0;

    const interval = setInterval(() => {
      if (!audioRef.current || !currentTrack) return;
      const nowTime = audioRef.current.currentTime || 0;

      if (Math.abs(nowTime - persistedTimeRef.current) >= 5) {
        persistedTimeRef.current = nowTime;
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [currentTrack?.id, persistedTimeRef, audioRef]);

  useEffect(() => {
    const handleBeforeUnload = async () => {
      const libraryData = buildLibraryIndexData(tracks, {
        volume: volume,
        currentTrackIndex: currentTrackIndex,
        currentTrackId: currentTrack?.id,
        currentTime: persistedTimeRef.current || currentTime,
        isPlaying: isPlaying,
        playbackMode: playbackMode
      });

      if (isDesktop()) {
        logger.debug('💾 Saving library to disk before quit...');
        await libraryStorage.saveLibrary(libraryData);
      } else {
        logger.debug('💾 Saving library to IndexedDB before quit...');
        await indexedDBStorage.saveLibrary(libraryData);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [tracks, volume, currentTrackIndex, isPlaying, currentTrack?.id, playbackMode, currentTime, persistedTimeRef]);
}
