import { useEffect } from 'react';
import { Track } from '../types';
import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { libraryStorage } from '../services/libraryStorage';
import { metadataCacheService } from '../services/metadataCacheService';
import { buildLibraryIndexData } from '../services/librarySerializer';
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
  const loadAndRestoreLibrary = async (libraryData: { songs: any[]; settings: any }) => {
    logger.debug('[LibraryLoad] Library data loaded:', libraryData);
    logger.debug('[LibraryLoad] Library data loaded, songs:', libraryData.songs?.length || 0);

    if (libraryData.settings?.volume !== undefined) {
      setVolume(libraryData.settings.volume);
    }

    if (libraryData.settings?.playbackMode) {
      setPlaybackMode(libraryData.settings.playbackMode);
    }

    if (libraryData.songs && libraryData.songs.length > 0) {
      logger.debug('[LibraryLoad] Found', libraryData.songs.length, 'songs in library index');
    } else {
      logger.warn('[LibraryLoad] No songs found in library data');
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
        coverUrl: song.coverUrl,
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
    logger.debug('[LibraryLoad] Loaded tracks:', loadedTracks.length);

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
      if (libraryData.settings.currentTime !== undefined) {
        const restoredTime = libraryData.settings.currentTime;
        restoredTimeRef.current = restoredTime;
        restoredTrackIdRef.current = loadedTracks[restoredIndex].id;
      }

      setCurrentTrackIndex(restoredIndex);
      setIsPlaying(false);
      shouldAutoPlayRef.current = false;
    }

    // Initialize metadata cache
    metadataCacheService.initialize().catch(err => {
      logger.warn('[LibraryLoad] Metadata cache init failed:', err);
    });

    // Validate paths in Desktop mode
    // Only validate tracks that have a filePath (skip tracks imported via File objects)
    const tracksToValidate = loadedTracks.filter(t => t.filePath);
    if (tracksToValidate.length > 0) {
      libraryStorage.validateAllPaths(tracksToValidate).then(results => {
        const map = new Map(results.map(r => [r.id, r.exists]));
        setTracks(prev => {
          let changed = false;
          const next = prev.map(track => {
            // Skip tracks without filePath - keep their available status
            if (!track.filePath) return track;
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
    }
  };

  useEffect(() => {
    const loadLibraryFromDisk = async () => {
      logger.debug('[LibraryLoad] Loading library from disk...');
      try {
        const libraryData = await libraryStorage.loadLibrary();
        await loadAndRestoreLibrary(libraryData);
      } catch (error) {
        logger.error('[LibraryLoad] Failed to load library:', error);
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

    logger.debug('[LibraryLoad] Saving library, songs:', libraryData.songs.length);
    libraryStorage.saveLibraryDebounced(libraryData);
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

      logger.debug('[LibraryLoad] Saving library before quit');
      await libraryStorage.saveLibrary(libraryData);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [tracks, volume, currentTrackIndex, isPlaying, currentTrack?.id, playbackMode, currentTime, persistedTimeRef]);
}
