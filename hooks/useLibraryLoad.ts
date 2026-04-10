import { useEffect, useRef } from 'react';
import { Track, LibrarySlot } from '../types';
import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { libraryStorage } from '../services/libraryStorage';
import { metadataCacheService } from '../services/metadataCacheService';
import { buildLibraryIndexData } from '../services/librarySerializer';
import { logger } from '../services/logger';

interface UseLibraryLoadOptions {
  restoreFromPersistence: (data: any, tracksFromDisk: Track[]) => void;
  getPersistenceData: () => { localSlot: any; cloudSlot: any; activeSlotId: 'local' | 'cloud' };
  slots: Record<'local' | 'cloud', LibrarySlot>;
  setLocalTracks: (updater: Track[] | ((prev: Track[]) => Track[])) => void;
  setActiveTrackIndex: (index: number | ((prev: number) => number)) => void;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setVolume: (volume: number) => void;
  setPlaybackMode: (mode: 'order' | 'shuffle' | 'repeat-one') => void;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  persistedTimeRef: React.MutableRefObject<number>;
  onLibrarySettingsRestored?: (settings: { activeSlotId?: 'local' | 'cloud' }) => void;
}

export function useLibraryLoad({
  restoreFromPersistence,
  getPersistenceData,
  slots,
  setLocalTracks,
  setActiveTrackIndex,
  setIsPlaying,
  setVolume,
  setPlaybackMode,
  audioRef,
  persistedTimeRef,
  onLibrarySettingsRestored,
}: UseLibraryLoadOptions) {
  const isFirstLoadRef = useRef(true);

  const loadAndRestoreLibrary = async (libraryData: { songs: any[]; settings: any }) => {
    logger.debug('[LibraryLoad] Library data loaded, songs:', libraryData.songs?.length || 0);

    const settings = libraryData.settings || {};
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

    restoreFromPersistence(settings, loadedTracks);

    const activeSource = settings.activeSlotId || settings.activeDataSource || 'local';
    const slotData = settings.localSlot || settings.cloudSlot ? settings : null;
    const activeSlotState = activeSource === 'cloud'
      ? slotData?.cloudSlot
      : slotData?.localSlot;

    if (activeSlotState?.volume !== undefined) {
      setVolume(activeSlotState.volume);
    }
    if (activeSlotState?.playbackMode) {
      setPlaybackMode(activeSlotState.playbackMode);
    }

    const trackIndex = activeSlotState?.currentTrackIndex ?? -1;
    if (trackIndex >= 0 && trackIndex < loadedTracks.length) {
      setActiveTrackIndex(trackIndex);
    }
    setIsPlaying(false);

    metadataCacheService.initialize().catch(err => {
      logger.warn('[LibraryLoad] Metadata cache init failed:', err);
    });

    const desktopAPI = await getDesktopAPIAsync();
    if (desktopAPI?.runStartupCleanup) {
      desktopAPI.runStartupCleanup(loadedTracks.map(t => t.id)).catch(err => {
        logger.warn('[LibraryLoad] Startup cleanup failed:', err);
      });
    }

    onLibrarySettingsRestored?.({
      activeSlotId: activeSource,
    });

    const tracksToValidate = loadedTracks.filter(t => t.filePath);
    if (tracksToValidate.length > 0) {
      libraryStorage.validateAllPaths(tracksToValidate).then(results => {
        const map = new Map(results.map(r => [r.id, r.exists]));
        setLocalTracks(prev => {
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

    const persistData = getPersistenceData();
    const libraryData = buildLibraryIndexData(slots.local.tracks, persistData);

    logger.debug('[LibraryLoad] Saving library, songs:', libraryData.songs.length);
    libraryStorage.saveLibraryDebounced(libraryData);
  }, [slots.local.tracks, slots.local.currentTrackIndex, slots.cloud.currentTrackIndex, slots.local.volume, slots.local.playbackMode]);

  useEffect(() => {
    if (!isDesktop()) return;

    persistedTimeRef.current = 0;

    const interval = setInterval(() => {
      if (!audioRef.current) return;
      const nowTime = audioRef.current.currentTime || 0;

      if (Math.abs(nowTime - persistedTimeRef.current) >= 5) {
        persistedTimeRef.current = nowTime;
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [persistedTimeRef, audioRef]);

  useEffect(() => {
    const handleBeforeUnload = async () => {
      const persistData = getPersistenceData();
      const libraryData = buildLibraryIndexData(slots.local.tracks, persistData);

      logger.debug('[LibraryLoad] Saving library before quit');
      await libraryStorage.saveLibrary(libraryData);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [slots.local.tracks, getPersistenceData]);
}
