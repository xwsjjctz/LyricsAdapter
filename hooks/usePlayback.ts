import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Track } from '../types';
import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { metadataCacheService } from '../services/metadataCacheService';
import { logger } from '../services/logger';

interface UsePlaybackOptions {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentTrackIndex: number;
  setCurrentTrackIndex: React.Dispatch<React.SetStateAction<number>>;
  createTrackedBlobUrl: (blob: Blob | File) => string;
  revokeBlobUrl: (blobUrl: string) => void;
}

export function usePlayback({
  tracks,
  setTracks,
  currentTrackIndex,
  setCurrentTrackIndex,
  createTrackedBlobUrl,
  revokeBlobUrl
}: UsePlaybackOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.5);
  const [playbackMode, setPlaybackMode] = useState<'order' | 'shuffle' | 'repeat-one'>('order');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shouldAutoPlayRef = useRef<boolean>(false);
  const waitingForCanPlayRef = useRef<boolean>(false);
  const restoredTimeRef = useRef<number>(0);
  const restoredTrackIdRef = useRef<string | null>(null);
  const prevAudioUrlRef = useRef<string | null>(null);
  const audioUrlReadyRef = useRef<boolean>(false);
  const persistedTimeRef = useRef<number>(0);
  const forcePlayRef = useRef<boolean>(false);
  const lastNonZeroVolumeRef = useRef<number>(0.5);

  const currentTrack = useMemo(() => (
    currentTrackIndex >= 0 ? tracks[currentTrackIndex] : null
  ), [tracks, currentTrackIndex]);

  const getRandomIndex = useCallback((exclude: number, length: number) => {
    if (length <= 1) return exclude;
    let next = exclude;
    while (next === exclude) {
      next = Math.floor(Math.random() * length);
    }
    return next;
  }, []);

  const linearToExponentialVolume = useCallback((linearVolume: number): number => {
    return linearVolume * linearVolume;
  }, []);

  const setAudioRef = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    if (node) {
      const actualVolume = linearToExponentialVolume(volume);
      logger.debug('Audio element created, setting volume to:', volume, '(actual:', actualVolume.toFixed(3), ')');
      node.volume = actualVolume;
    }
  }, [volume, linearToExponentialVolume]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !currentTrack) return;
    if (isPlaying) {
      shouldAutoPlayRef.current = false;
      forcePlayRef.current = false;
      audioRef.current.pause();
    } else {
      shouldAutoPlayRef.current = true;
      forcePlayRef.current = true;
      audioRef.current.play().catch(e => logger.error('Playback failed', e));
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, currentTrack]);

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current && currentTrack) {
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

      if (restoredTimeRef.current > 0) {
        if (restoredTrackIdRef.current && restoredTrackIdRef.current !== currentTrack.id) {
          return;
        }

        const duration = audioRef.current.duration || 0;
        const restoreTime = Math.max(0, Math.min(restoredTimeRef.current, Math.max(0, duration - 0.5)));
        logger.debug('[Playback] Restoring playback time:', restoreTime);

        audioRef.current.currentTime = restoreTime;
        setCurrentTime(restoreTime);
        restoredTimeRef.current = 0;
        restoredTrackIdRef.current = null;
      }
    }
  }, [currentTrack, currentTrackIndex, setTracks]);

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
      shouldAutoPlayRef.current = true;
      forcePlayRef.current = true;
      setCurrentTrackIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
    }
  }, [currentTrackIndex, tracks.length, playbackMode, getRandomIndex, setCurrentTrackIndex]);

  const loadAudioFileForTrack = useCallback(async (track: Track): Promise<Track> => {
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI || !(track as any).filePath || track.audioUrl) {
      return track;
    }

    try {
      logger.debug('[Playback] Loading audio file for:', track.title, `(${desktopAPI.platform})`);
      logger.debug('[Playback] Using blob URL protocol');
      const readResult = await desktopAPI.readFile((track as any).filePath);

      if (readResult.success && readResult.data.byteLength > 0) {
        const fileData = new Uint8Array(readResult.data);
        const file = new File([fileData], (track as any).fileName, { type: 'audio/flac' });
        const audioUrl = createTrackedBlobUrl(file);

        logger.debug('[Playback] ✓ Audio loaded, size:', (fileData.length / 1024 / 1024).toFixed(2), 'MB');

        return {
          ...track,
          audioUrl: audioUrl
        };
      }

      logger.error('[Playback] Failed to load audio file:', readResult.error);
      return track;
    } catch (error) {
      logger.error('[Playback] Failed to load audio file:', error);
      return track;
    }
  }, [createTrackedBlobUrl]);

  const skipForward = useCallback(() => {
    if (tracks.length === 0) return;
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
  }, [currentTrackIndex, tracks.length, playbackMode, getRandomIndex, setCurrentTrackIndex]);

  const skipBackward = useCallback(() => {
    if (tracks.length === 0) return;
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
  }, [currentTrackIndex, tracks.length, playbackMode, getRandomIndex, setCurrentTrackIndex]);

  const handleSeek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const handleVolumeChange = useCallback((vol: number) => {
    if (vol > 0) {
      lastNonZeroVolumeRef.current = vol;
    }
    setVolume(vol);
  }, []);

  const handleToggleMute = useCallback(() => {
    if (volume > 0) {
      lastNonZeroVolumeRef.current = volume;
      setVolume(0);
    } else {
      const restore = lastNonZeroVolumeRef.current || 0.5;
      setVolume(restore);
    }
  }, [volume]);

  const handleTogglePlaybackMode = useCallback(() => {
    setPlaybackMode(prev => {
      if (prev === 'order') return 'shuffle';
      if (prev === 'shuffle') return 'repeat-one';
      return 'order';
    });
  }, []);

  const handleCanPlay = useCallback(() => {
    logger.debug('[Playback] Audio is ready to play');

    if (restoredTimeRef.current > 0 && audioRef.current) {
      if (restoredTrackIdRef.current && currentTrack && restoredTrackIdRef.current !== currentTrack.id) {
        return;
      }

      const duration = audioRef.current.duration || 0;
      const restoreTime = Math.max(0, Math.min(restoredTimeRef.current, Math.max(0, duration - 0.5)));
      logger.debug('[Playback] Restoring playback time in canplay:', restoreTime);

      audioRef.current.currentTime = restoreTime;
      setCurrentTime(restoreTime);

      restoredTimeRef.current = 0;
      restoredTrackIdRef.current = null;
      logger.debug('[Playback] ✓ Playback time restored');
    }

    if ((waitingForCanPlayRef.current || shouldAutoPlayRef.current || forcePlayRef.current) && audioRef.current) {
      waitingForCanPlayRef.current = false;
      logger.debug('[Playback] Attempting playback after canplay');
      audioRef.current.play().then(() => {
        logger.debug('[Playback] ✓ Playback started after canplay');
        setIsPlaying(true);
        shouldAutoPlayRef.current = false;
        forcePlayRef.current = false;
      }).catch((e) => {
        logger.debug('[Playback] Playback failed after canplay:', e);
        setIsPlaying(false);
        shouldAutoPlayRef.current = true;
        forcePlayRef.current = true;
      });
    }
  }, [currentTrack]);

  useEffect(() => {
    if (!audioRef.current || !currentTrack) return;

    logger.debug('[Playback] Track changed:', currentTrack.title, 'index:', currentTrackIndex);

    audioUrlReadyRef.current = false;

    if (!currentTrack.audioUrl && (currentTrack as any).filePath) {
      logger.debug('[Playback] Lazy loading audio for:', currentTrack.title);

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
      return;
    }

    if (!currentTrack.audioUrl) {
      logger.debug('[Playback] No audio URL available, pausing playback');
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
      return;
    }

    if (waitingForCanPlayRef.current) {
      waitingForCanPlayRef.current = false;
    }

    if (restoredTimeRef.current > 0) {
      logger.debug('[Playback] Need to restore playback time:', restoredTimeRef.current);
    }

    audioUrlReadyRef.current = true;

    if (currentTrack.audioUrl) {
      if (isPlaying || shouldAutoPlayRef.current || forcePlayRef.current) {
        audioRef.current.play().then(() => {
          logger.debug('[Playback] ✓ Playback started successfully');
          shouldAutoPlayRef.current = false;
          forcePlayRef.current = false;
          setIsPlaying(true);
        }).catch((e) => {
          logger.debug('[Playback] Playback failed, waiting for canplay:', e);
          waitingForCanPlayRef.current = true;
          shouldAutoPlayRef.current = true;
          forcePlayRef.current = true;
        });
      } else {
        audioRef.current.pause();
      }
    }
  }, [currentTrackIndex, isPlaying, currentTrack, loadAudioFileForTrack, setTracks]);

  useEffect(() => {
    if (!audioRef.current || !currentTrack || !currentTrack.audioUrl) return;

    if ((shouldAutoPlayRef.current || forcePlayRef.current) && audioUrlReadyRef.current) {
      logger.debug('[Playback] Auto-playing after audio URL loaded:', currentTrack.title);
      audioRef.current.play().then(() => {
        logger.debug('[Playback] ✓ Auto-play started successfully');
        setIsPlaying(true);
        shouldAutoPlayRef.current = false;
        forcePlayRef.current = false;
      }).catch((e) => {
        logger.debug('[Playback] Auto-play failed:', e);
        waitingForCanPlayRef.current = true;
        shouldAutoPlayRef.current = true;
        forcePlayRef.current = true;
      });
    }
  }, [currentTrack?.audioUrl, currentTrack]);

  useEffect(() => {
    if (!currentTrack) return;

    const needsMetadata =
      (!currentTrack.lyrics || currentTrack.lyrics.length === 0) &&
      (!currentTrack.syncedLyrics || currentTrack.syncedLyrics.length === 0);

    if (!needsMetadata) return;

    let cancelled = false;

    const scheduleIdle = (task: () => void) => {
      if (typeof (window as any).requestIdleCallback === 'function') {
        return (window as any).requestIdleCallback(task, { timeout: 2000 });
      }
      return window.setTimeout(task, 600);
    };

    scheduleIdle(async () => {
      try {
        await metadataCacheService.initialize();
        if (cancelled) return;
        const cached = metadataCacheService.get(currentTrack.id);
        if (!cached) return;

        setTracks(prev => {
          const idx = prev.findIndex(t => t.id === currentTrack.id);
          if (idx === -1) return prev;
          const existing = prev[idx];
          const hasLyrics = existing.lyrics && existing.lyrics.length > 0;
          const hasSynced = existing.syncedLyrics && existing.syncedLyrics.length > 0;
          if (hasLyrics || hasSynced) return prev;

          const next = [...prev];
          next[idx] = {
            ...existing,
            lyrics: cached.lyrics || existing.lyrics,
            syncedLyrics: cached.syncedLyrics || existing.syncedLyrics,
            duration: existing.duration || cached.duration,
            title: existing.title || cached.title,
            artist: existing.artist || cached.artist,
            album: existing.album || cached.album
          };
          return next;
        });
      } catch (error) {
        logger.warn('[Playback] Failed to hydrate metadata from cache:', error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!currentTrack) return;

    const currentAudioUrl = currentTrack.audioUrl;
    const previousAudioUrl = prevAudioUrlRef.current;

    if (previousAudioUrl && previousAudioUrl.startsWith('blob:') && previousAudioUrl !== currentAudioUrl) {
      logger.debug('[Playback] Cleaning up previous blob URL:', previousAudioUrl);
      revokeBlobUrl(previousAudioUrl);
    }

    prevAudioUrlRef.current = currentAudioUrl;
  }, [currentTrack?.audioUrl, revokeBlobUrl]);

  useEffect(() => {
    const preloadAdjacent = async () => {
      if (currentTrackIndex < 0 || !isDesktop()) return;

      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI) return;

      const MAX_PRELOAD_SIZE = 50 * 1024 * 1024;

      if (currentTrackIndex < tracks.length - 1) {
        const nextTrack = tracks[currentTrackIndex + 1];
        const fileSize = (nextTrack as any).fileSize || 0;

        if (!fileSize || fileSize <= 0) {
          logger.debug('[Playback] Skipping preload (unknown size):', nextTrack.title);
        } else if (!nextTrack.audioUrl && (nextTrack as any).filePath && fileSize <= MAX_PRELOAD_SIZE) {
          logger.debug('[Playback] Preloading next track:', nextTrack.title, `(${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
          loadAudioFileForTrack(nextTrack).then(updatedTrack => {
            setTracks(prev => {
              const newTracks = [...prev];
              newTracks[currentTrackIndex + 1] = updatedTrack;
              return newTracks;
            });
          });
        } else if (fileSize > MAX_PRELOAD_SIZE) {
          logger.debug('[Playback] Skipping large file for preload:', nextTrack.title, `(${(fileSize / 1024 / 1024).toFixed(2)} MB > 50 MB)`);
        }
      }

      if (currentTrackIndex > 0) {
        const prevTrack = tracks[currentTrackIndex - 1];
        const fileSize = (prevTrack as any).fileSize || 0;

        if (!fileSize || fileSize <= 0) {
          logger.debug('[Playback] Skipping preload (unknown size):', prevTrack.title);
        } else if (!prevTrack.audioUrl && (prevTrack as any).filePath && fileSize <= MAX_PRELOAD_SIZE) {
          logger.debug('[Playback] Preloading previous track:', prevTrack.title, `(${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
          loadAudioFileForTrack(prevTrack).then(updatedTrack => {
            setTracks(prev => {
              const newTracks = [...prev];
              newTracks[currentTrackIndex - 1] = updatedTrack;
              return newTracks;
            });
          });
        } else if (fileSize > MAX_PRELOAD_SIZE) {
          logger.debug('[Playback] Skipping large file for preload:', prevTrack.title, `(${(fileSize / 1024 / 1024).toFixed(2)} MB > 50 MB)`);
        }
      }
    };

    const timer = setTimeout(preloadAdjacent, 500);
    return () => clearTimeout(timer);
  }, [currentTrackIndex, tracks, loadAudioFileForTrack, setTracks]);

  useEffect(() => {
    if (audioRef.current) {
      const actualVolume = linearToExponentialVolume(volume);
      logger.debug('Volume changed to:', volume, '(actual:', actualVolume.toFixed(3), ')');
      audioRef.current.volume = actualVolume;
    }
  }, [volume, linearToExponentialVolume]);

  const handleAudioError = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
    logger.error('[Playback] Audio error:', e);
    const audio = e.target as HTMLAudioElement;
    logger.error('[Playback] Audio error code:', audio.error?.code);
    logger.error('[Playback] Audio error message:', audio.error?.message);
    logger.error('[Playback] Current audio src:', audio.src);

    setIsPlaying(false);
    waitingForCanPlayRef.current = false;
    shouldAutoPlayRef.current = false;

    if (currentTrack && audio.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      logger.warn('[Playback] Audio source not supported, clearing audioUrl for reload');
      setTracks(prev => {
        const newTracks = [...prev];
        const idx = newTracks.findIndex(t => t.id === currentTrack.id);
        if (idx !== -1) {
          newTracks[idx] = { ...newTracks[idx], audioUrl: '' };
        }
        return newTracks;
      });
    }
  }, [currentTrack, setTracks]);

  const selectTrack = useCallback((idx: number) => {
    shouldAutoPlayRef.current = true;
    forcePlayRef.current = true;
    setCurrentTrackIndex(idx);
    setIsPlaying(true);
  }, [setCurrentTrackIndex]);

  return {
    audioRef,
    setAudioRef,
    currentTrack,
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    volume,
    setVolume,
    playbackMode,
    setPlaybackMode,
    togglePlay,
    skipForward,
    skipBackward,
    handleSeek,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleTrackEnded,
    handleCanPlay,
    handleVolumeChange,
    handleToggleMute,
    handleTogglePlaybackMode,
    handleAudioError,
    selectTrack,
    loadAudioFileForTrack,
    shouldAutoPlayRef,
    waitingForCanPlayRef,
    restoredTimeRef,
    restoredTrackIdRef,
    audioUrlReadyRef,
    persistedTimeRef,
    forcePlayRef
  };
}
