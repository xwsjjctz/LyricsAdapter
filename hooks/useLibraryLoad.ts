import { useEffect } from 'react';
import { Track } from '../types';
import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { libraryStorage } from '../services/metadataService';
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
  useEffect(() => {
    const loadLibraryFromDisk = async () => {
      logger.debug('[LibraryLoad] Loading library from disk...');
      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI) {
        logger.debug('[LibraryLoad] Not running in Desktop mode, skipping library load');
        return;
      }

      try {
        const libraryData = await libraryStorage.loadLibrary();
        logger.debug('[LibraryLoad] Library index loaded from disk:', libraryData);
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
            lyrics: '',
            syncedLyrics: undefined,
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

        if (loadedTracks.length > 0) {
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
      } catch (error) {
        logger.error('Failed to load library:', error);
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
    if (isDesktop()) {
      logger.debug('🔄 Tracks or volume changed, triggering auto-save...');

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
      logger.debug('  - volume:', libraryData.settings.volume);
      logger.debug('  - currentTrackIndex:', libraryData.settings.currentTrackIndex);
      logger.debug('  - currentTime:', libraryData.settings.currentTime);
      logger.debug('  - isPlaying:', libraryData.settings.isPlaying);

      libraryStorage.saveLibraryDebounced(libraryData);
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
      if (isDesktop()) {
        const libraryData = buildLibraryIndexData(tracks, {
          volume: volume,
          currentTrackIndex: currentTrackIndex,
          currentTrackId: currentTrack?.id,
          currentTime: persistedTimeRef.current || currentTime,
          isPlaying: isPlaying,
          playbackMode: playbackMode
        });

        logger.debug('💾 Saving library before quit...');
        await libraryStorage.saveLibrary(libraryData);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [tracks, volume, currentTrackIndex, isPlaying, currentTrack?.id, playbackMode, currentTime, persistedTimeRef]);
}
