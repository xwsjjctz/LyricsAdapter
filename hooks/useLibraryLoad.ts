import { useEffect, useRef } from 'react';
import { Track, PlaybackContext } from '../types';
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
  libraryDataSource: 'local' | 'cloud';
  cloudTracks: Track[];
  cloudTrackIndex: number;
  onLibrarySettingsRestored?: (settings: {
    libraryDataSource: 'local' | 'cloud';
    localCurrentTrackId?: string;
    cloudCurrentTrackId?: string;
    cloudTracks: Track[];
  }) => void;
  setPlaybackContexts: (localCtx: PlaybackContext, cloudCtx: PlaybackContext) => void;
  getPlaybackContexts: () => { localPlaybackContext: PlaybackContext; cloudPlaybackContext: PlaybackContext };
}

const DEFAULT_CONTEXT: PlaybackContext = {
  trackIndex: -1, currentTime: 0, volume: 0.5, playbackMode: 'order', isPlaying: false
};

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
  persistedTimeRef,
  libraryDataSource,
  cloudTracks,
  cloudTrackIndex,
  onLibrarySettingsRestored,
  setPlaybackContexts,
  getPlaybackContexts
}: UseLibraryLoadOptions) {
  const isFirstLoadRef = useRef(true);

  const loadAndRestoreLibrary = async (libraryData: { songs: any[]; settings: any }) => {
    logger.debug('[LibraryLoad] Library data loaded, songs:', libraryData.songs?.length || 0);

    // Migration: if no playback contexts exist, create them from legacy fields
    const settings = libraryData.settings || {};
    if (!settings.localPlaybackContext && !settings.cloudPlaybackContext) {
      logger.info('[LibraryLoad] Migrating legacy playback state to independent contexts');
      settings.localPlaybackContext = {
        trackIndex: settings.currentTrackIndex ?? -1,
        trackId: settings.currentTrackId,
        currentTime: settings.currentTime ?? 0,
        volume: settings.volume ?? 0.5,
        playbackMode: settings.playbackMode ?? 'order',
        isPlaying: false
      };
      settings.cloudPlaybackContext = { ...DEFAULT_CONTEXT };
      settings.activeDataSource = settings.activeDataSource || 'local';
    }

    if (settings.volume !== undefined) {
      setVolume(settings.volume);
    }
    if (settings.playbackMode) {
      setPlaybackMode(settings.playbackMode);
    }

    // Load playback contexts into usePlayback's refs
    const localCtx: PlaybackContext = settings.localPlaybackContext || { ...DEFAULT_CONTEXT };
    const cloudCtx: PlaybackContext = settings.cloudPlaybackContext || { ...DEFAULT_CONTEXT };
    setPlaybackContexts(localCtx, cloudCtx);

    const loadedTracks: Track[] = (libraryData.songs || []).map((song: any) => {
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

    // Restore track from the active context
    const activeSource = settings.activeDataSource || 'local';
    const activeCtx = activeSource === 'cloud' ? cloudCtx : localCtx;

    let restoredIndex = -1;
    if (activeCtx.trackId) {
      restoredIndex = loadedTracks.findIndex(t => t.id === activeCtx.trackId);
    }
    if (restoredIndex < 0 && activeCtx.trackIndex >= 0 && activeCtx.trackIndex < loadedTracks.length) {
      restoredIndex = activeCtx.trackIndex;
    }

    if (restoredIndex >= 0 && restoredIndex < loadedTracks.length) {
      restoredTimeRef.current = activeCtx.currentTime || 0;
      restoredTrackIdRef.current = loadedTracks[restoredIndex].id;
      setCurrentTrackIndex(restoredIndex);
      setIsPlaying(false);
      shouldAutoPlayRef.current = false;
    }

    metadataCacheService.initialize().catch(err => {
      logger.warn('[LibraryLoad] Metadata cache init failed:', err);
    });

    const desktopAPI = await getDesktopAPIAsync();
    if (desktopAPI?.runStartupCleanup) {
      desktopAPI.runStartupCleanup(loadedTracks.map(t => t.id)).catch(err => {
        logger.warn('[LibraryLoad] Startup cleanup failed:', err);
      });
    }

    const localCurrentTrackId = localCtx.trackId;
    const cloudCurrentTrackId = cloudCtx.trackId;
    onLibrarySettingsRestored?.({
      libraryDataSource: activeSource,
      localCurrentTrackId,
      cloudCurrentTrackId,
      cloudTracks: []
    });

    const tracksToValidate = loadedTracks.filter(t => t.filePath);
    if (tracksToValidate.length > 0) {
      libraryStorage.validateAllPaths(tracksToValidate).then(results => {
        const map = new Map(results.map(r => [r.id, r.exists]));
        setTracks(prev => {
          let changed = false;
          const next = prev.map(track => {
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
        isFirstLoadRef.current = false;
      } catch (error) {
        logger.error('[LibraryLoad] Failed to load library:', error);
      }
    };

    loadLibraryFromDisk();
  }, []);

  useEffect(() => {
    if (isFirstLoadRef.current) return;

    const { localPlaybackContext, cloudPlaybackContext } = getPlaybackContexts();
    const libraryData = buildLibraryIndexData(tracks, {
      volume: volume,
      currentTrackIndex: currentTrackIndex,
      currentTrackId: currentTrack?.id,
      currentTime: persistedTimeRef.current || currentTime,
      isPlaying: isPlaying,
      playbackMode: playbackMode,
      libraryDataSource,
      localCurrentTrackId: libraryDataSource === 'local' ? currentTrack?.id : undefined,
      cloudCurrentTrackId: libraryDataSource === 'cloud' ? cloudTracks[cloudTrackIndex]?.id : undefined,
      activeDataSource: libraryDataSource,
      localPlaybackContext,
      cloudPlaybackContext
    });

    logger.debug('[LibraryLoad] Saving library, songs:', libraryData.songs.length);
    libraryStorage.saveLibraryDebounced(libraryData);
  }, [tracks, volume, currentTrackIndex, isPlaying, currentTrack?.id, playbackMode, currentTime, persistedTimeRef, libraryDataSource, cloudTracks, cloudTrackIndex]);

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
      const { localPlaybackContext, cloudPlaybackContext } = getPlaybackContexts();
      const libraryData = buildLibraryIndexData(tracks, {
        volume: volume,
        currentTrackIndex: currentTrackIndex,
        currentTrackId: currentTrack?.id,
        currentTime: persistedTimeRef.current || currentTime,
        isPlaying: isPlaying,
        playbackMode: playbackMode,
        libraryDataSource,
        activeDataSource: libraryDataSource,
        localPlaybackContext,
        cloudPlaybackContext
      });

      logger.debug('[LibraryLoad] Saving library before quit');
      await libraryStorage.saveLibrary(libraryData);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [tracks, volume, currentTrackIndex, isPlaying, currentTrack?.id, playbackMode, currentTime, persistedTimeRef, libraryDataSource]);
}
