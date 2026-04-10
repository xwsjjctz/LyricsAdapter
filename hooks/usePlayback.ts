import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Track, PlaybackContext } from '../types';
import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { metadataCacheService } from '../services/metadataCacheService';
import { logger } from '../services/logger';
import { webdavClient } from '../services/webdavClient';
import { PLAYBACK, UI } from '../constants/config';

interface UsePlaybackOptions {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentTrackIndex: number;
  setCurrentTrackIndex: React.Dispatch<React.SetStateAction<number>>;
  webdavTracks: Track[];
  createTrackedBlobUrl: (blob: Blob | File) => string;
  revokeBlobUrl: (blobUrl: string) => void;
  onTrackSwitch?: () => void;
}

export function usePlayback({
  tracks,
  setTracks,
  currentTrackIndex,
  setCurrentTrackIndex,
  webdavTracks,
  createTrackedBlobUrl,
  revokeBlobUrl,
  onTrackSwitch
}: UsePlaybackOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState<number>(UI.DEFAULT_VOLUME);
  const [playbackMode, setPlaybackMode] = useState<'order' | 'shuffle' | 'repeat-one'>('order');
  const [cloudTrackIndex, setCloudTrackIndex] = useState<number>(-1);

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
  const currentTrackIndexRef = useRef<number>(currentTrackIndex);
  const cloudTrackIndexRef = useRef<number>(cloudTrackIndex);

  // Playback contexts stored as refs to avoid re-render cycles
  const localPlaybackCtx = useRef<PlaybackContext>({
    trackIndex: -1, currentTime: 0, volume: 0.5, playbackMode: 'order', isPlaying: false
  });
  const cloudPlaybackCtx = useRef<PlaybackContext>({
    trackIndex: -1, currentTime: 0, volume: 0.5, playbackMode: 'order', isPlaying: false
  });

  const isCloudMode = cloudTrackIndex >= 0;

  useEffect(() => {
    currentTrackIndexRef.current = currentTrackIndex;
  }, [currentTrackIndex]);

  useEffect(() => {
    cloudTrackIndexRef.current = cloudTrackIndex;
  }, [cloudTrackIndex]);

  const currentTrack = useMemo(() => {
    if (cloudTrackIndex >= 0 && webdavTracks[cloudTrackIndex]) {
      return webdavTracks[cloudTrackIndex];
    }
    return currentTrackIndex >= 0 ? tracks[currentTrackIndex] : null;
  }, [tracks, currentTrackIndex, webdavTracks, cloudTrackIndex]);

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

  const switchToTrackIndex = useCallback((nextIndex: number) => {
    if (nextIndex === currentTrackIndex) return;
    onTrackSwitch?.();
    setCurrentTrackIndex(nextIndex);
  }, [currentTrackIndex, onTrackSwitch, setCurrentTrackIndex]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !currentTrack) return;

    setIsPlaying(prevIsPlaying => {
      if (prevIsPlaying) {
        shouldAutoPlayRef.current = false;
        forcePlayRef.current = false;
        audioRef.current?.pause();
      } else {
        shouldAutoPlayRef.current = true;
        forcePlayRef.current = true;
        audioRef.current?.play().catch(e => logger.error('Playback failed', e));
      }
      return !prevIsPlaying;
    });
  }, [currentTrack]);

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current && currentTrack) {
      if (!isCloudMode) {
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
      }

      if (restoredTimeRef.current > 0) {
        if (restoredTrackIdRef.current && restoredTrackIdRef.current !== currentTrack.id) {
          return;
        }

        const duration = audioRef.current.duration || 0;
        const restoreTime = Math.max(0, Math.min(restoredTimeRef.current, Math.max(0, duration - PLAYBACK.MAX_RESTORE_OFFSET)));
        logger.debug('[Playback] Restoring playback time:', restoreTime);

        audioRef.current.currentTime = restoreTime;
        setCurrentTime(restoreTime);
        restoredTimeRef.current = 0;
        restoredTrackIdRef.current = null;
      }
    }
  }, [currentTrack, currentTrackIndex, setTracks, isCloudMode]);

  const getNextTrackIndex = useCallback((direction: 'forward' | 'backward'): number => {
    const listLength = isCloudMode ? webdavTracks.length : tracks.length;
    if (listLength === 0) return -1;
    const currentIdx = isCloudMode ? cloudTrackIndexRef.current : currentTrackIndexRef.current;

    if (playbackMode === 'shuffle') {
      return getRandomIndex(currentIdx, listLength);
    }

    if (direction === 'forward') {
      return currentIdx < listLength - 1 ? currentIdx + 1 : 0;
    } else {
      return currentIdx > 0 ? currentIdx - 1 : listLength - 1;
    }
  }, [isCloudMode, webdavTracks.length, tracks.length, playbackMode, getRandomIndex]);

  const handleTrackEnded = useCallback(() => {
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

    const nextIndex = getNextTrackIndex('forward');
    if (nextIndex < 0) return;

    shouldAutoPlayRef.current = true;
    forcePlayRef.current = true;
    onTrackSwitch?.();

    if (isCloudMode) {
      setCloudTrackIndex(nextIndex);
    } else {
      setCurrentTrackIndex(nextIndex);
    }
  }, [isCloudMode, playbackMode, getNextTrackIndex, onTrackSwitch, setCurrentTrackIndex]);

  const loadAudioFileForTrack = useCallback(async (track: Track): Promise<Track> => {
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI || !track.filePath || track.audioUrl) {
      return track;
    }

    try {
      logger.debug('[Playback] Loading audio file for:', track.title, `(${desktopAPI.platform})`);
      logger.debug('[Playback] Using blob URL protocol');
      const readResult = await desktopAPI.readFile(track.filePath);

      if (readResult.success && readResult.data.byteLength > 0) {
        const fileName = track.fileName || 'audio.flac';
        const file = new File([readResult.data], fileName, { type: 'audio/flac' });
        const audioUrl = createTrackedBlobUrl(file);

        logger.debug('[Playback] ✓ Audio loaded, size:', (readResult.data.byteLength / 1024 / 1024).toFixed(2), 'MB');

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
    const listLength = isCloudMode ? webdavTracks.length : tracks.length;
    if (listLength === 0) return;
    shouldAutoPlayRef.current = true;
    forcePlayRef.current = true;
    onTrackSwitch?.();

    const nextIndex = getNextTrackIndex('forward');
    if (isCloudMode) {
      setCloudTrackIndex(nextIndex);
    } else {
      setCurrentTrackIndex(nextIndex);
    }
  }, [isCloudMode, webdavTracks.length, tracks.length, getNextTrackIndex, onTrackSwitch, setCurrentTrackIndex]);

  const skipBackward = useCallback(() => {
    const listLength = isCloudMode ? webdavTracks.length : tracks.length;
    if (listLength === 0) return;
    shouldAutoPlayRef.current = true;
    forcePlayRef.current = true;
    onTrackSwitch?.();

    const nextIndex = getNextTrackIndex('backward');
    if (isCloudMode) {
      setCloudTrackIndex(nextIndex);
    } else {
      setCurrentTrackIndex(nextIndex);
    }
  }, [isCloudMode, webdavTracks.length, tracks.length, getNextTrackIndex, onTrackSwitch, setCurrentTrackIndex]);

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
      const restore = lastNonZeroVolumeRef.current || UI.DEFAULT_VOLUME;
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
      const restoreTime = Math.max(0, Math.min(restoredTimeRef.current, Math.max(0, duration - PLAYBACK.MAX_RESTORE_OFFSET)));
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

  // Main track-change effect — does NOT depend on isPlaying
  useEffect(() => {
    if (!audioRef.current || !currentTrack) return;

    logger.debug('[Playback] Track changed:', currentTrack.title, 'cloudIdx:', cloudTrackIndex, 'localIdx:', currentTrackIndex, 'source:', currentTrack.source);

    audioUrlReadyRef.current = false;

    if (currentTrack.source === 'webdav') {
      const handleWebdav = async () => {
        if (!currentTrack.webdavPath) return;
        const capturedCloudIdx = cloudTrackIndex;
        const shouldPlay = shouldAutoPlayRef.current || forcePlayRef.current;
        logger.info('[Playback] Loading WebDAV audio for:', currentTrack.title, 'autoPlay:', shouldPlay);

        try {
          const cdnUrl = await webdavClient.getCdnUrl(currentTrack.webdavPath);
          if (cloudTrackIndexRef.current !== capturedCloudIdx || !audioRef.current) return;
          logger.info('[Playback] CDN URL result:', cdnUrl ? cdnUrl.substring(0, 100) + '...' : 'null');
          if (cdnUrl) {
            audioRef.current.src = cdnUrl;
            audioUrlReadyRef.current = true;
            if (shouldPlay) {
              await audioRef.current.play();
              shouldAutoPlayRef.current = false;
              forcePlayRef.current = false;
              setIsPlaying(true);
            } else {
              audioRef.current.pause();
            }
          } else {
            logger.error('[Playback] Failed to get CDN URL for:', currentTrack.webdavPath);
          }
        } catch (e: any) {
          if (e.name === 'AbortError') return;
          logger.error('[Playback] WebDAV playback error:', e);
          waitingForCanPlayRef.current = true;
        }
      };
      handleWebdav();
      return;
    }

    if (!currentTrack.audioUrl && currentTrack.filePath) {
      logger.debug('[Playback] Lazy loading audio for:', currentTrack.title);

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
      audioRef.current.pause();
      setIsPlaying(false);
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
      if (shouldAutoPlayRef.current || forcePlayRef.current) {
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
      }
    }
  }, [currentTrackIndex, cloudTrackIndex, currentTrack, loadAudioFileForTrack, setTracks]);

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
      if (typeof window.requestIdleCallback === 'function') {
        return window.requestIdleCallback(task, { timeout: 2000 });
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
    if (audioRef.current) {
      const actualVolume = linearToExponentialVolume(volume);
      logger.debug('Volume changed to:', volume, '(actual:', actualVolume.toFixed(3), ')');
      audioRef.current.volume = actualVolume;
    }
  }, [volume, linearToExponentialVolume]);

  const handleAudioError = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.target as HTMLAudioElement;

    if (!audio.src || audio.src === window.location.href) {
      return;
    }

    logger.error('[Playback] Audio error:', e);
    logger.error('[Playback] Audio error code:', audio.error?.code);
    logger.error('[Playback] Audio error message:', audio.error?.message);
    logger.error('[Playback] Current audio src:', audio.src);

    setIsPlaying(false);
    waitingForCanPlayRef.current = false;
    shouldAutoPlayRef.current = false;

    if (currentTrack && audio.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      if (isCloudMode) {
        logger.warn('[Playback] CDN URL not supported, retrying with fresh URL');
        webdavClient.clearCdnCache();
      } else {
        setTracks(prev => {
          const newTracks = [...prev];
          const idx = newTracks.findIndex(t => t.id === currentTrack.id);
          if (idx !== -1) {
            newTracks[idx] = { ...newTracks[idx], audioUrl: '' };
          }
          return newTracks;
        });
      }
    }
  }, [currentTrack, setTracks, isCloudMode]);

  const selectTrack = useCallback((idx: number) => {
    shouldAutoPlayRef.current = true;
    forcePlayRef.current = true;
    setCloudTrackIndex(-1);
    switchToTrackIndex(idx);
    setIsPlaying(true);
  }, [switchToTrackIndex]);

  const setCloudTrack = useCallback((idx: number, autoPlay = true) => {
    shouldAutoPlayRef.current = autoPlay;
    forcePlayRef.current = autoPlay;
    setCloudTrackIndex(idx);
    if (autoPlay) {
      setIsPlaying(true);
    }
  }, []);

  const clearCloudTrack = useCallback(() => {
    setCloudTrackIndex(-1);
  }, []);

  // --- Independent Playback Context API (uses refs, no re-render cycles) ---

  const savePlaybackContext = useCallback((source: 'local' | 'cloud') => {
    const ctx: PlaybackContext = {
      trackIndex: source === 'cloud' ? cloudTrackIndexRef.current : currentTrackIndexRef.current,
      trackId: source === 'cloud'
        ? webdavTracks[cloudTrackIndexRef.current]?.id
        : tracks[currentTrackIndexRef.current]?.id,
      currentTime: persistedTimeRef.current || 0,
      volume,
      playbackMode,
      isPlaying
    };
    if (source === 'cloud') {
      cloudPlaybackCtx.current = ctx;
    } else {
      localPlaybackCtx.current = ctx;
    }
    logger.debug('[Playback] Saved', source, 'playback context:', ctx);
  }, [tracks, webdavTracks, volume, playbackMode, isPlaying]);

  const restorePlaybackContext = useCallback((source: 'local' | 'cloud') => {
    const ctx = source === 'cloud' ? cloudPlaybackCtx.current : localPlaybackCtx.current;
    if (!ctx || ctx.trackIndex < 0) {
      logger.debug('[Playback] No saved context for', source, ', skipping restore');
      return;
    }
    logger.debug('[Playback] Restoring', source, 'playback context:', ctx);

    setVolume(ctx.volume);
    setPlaybackMode(ctx.playbackMode);
    restoredTimeRef.current = ctx.currentTime;
    if (ctx.trackId) {
      restoredTrackIdRef.current = ctx.trackId;
    }

    if (source === 'cloud') {
      if (ctx.trackIndex >= 0 && ctx.trackIndex < webdavTracks.length) {
        setCloudTrackIndex(ctx.trackIndex);
      }
    } else {
      if (ctx.trackIndex >= 0 && ctx.trackIndex < tracks.length) {
        setCurrentTrackIndex(ctx.trackIndex);
      }
    }

    setIsPlaying(false);
  }, [tracks.length, webdavTracks.length]);

  const getPlaybackContexts = useCallback(() => {
    const currentCtx: PlaybackContext = {
      trackIndex: isCloudMode ? cloudTrackIndexRef.current : currentTrackIndexRef.current,
      trackId: isCloudMode
        ? webdavTracks[cloudTrackIndexRef.current]?.id
        : tracks[currentTrackIndexRef.current]?.id,
      currentTime: persistedTimeRef.current || 0,
      volume,
      playbackMode,
      isPlaying
    };
    if (isCloudMode) {
      cloudPlaybackCtx.current = currentCtx;
    } else {
      localPlaybackCtx.current = currentCtx;
    }
    return {
      localPlaybackContext: localPlaybackCtx.current,
      cloudPlaybackContext: cloudPlaybackCtx.current
    };
  }, [tracks, webdavTracks, volume, playbackMode, isPlaying, isCloudMode]);

  const setPlaybackContexts = useCallback((localCtx: PlaybackContext, cloudCtx: PlaybackContext) => {
    localPlaybackCtx.current = localCtx;
    cloudPlaybackCtx.current = cloudCtx;
    logger.debug('[Playback] Set playback contexts from persistence:', { localCtx, cloudCtx });
  }, []);

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
    setCloudTrack,
    clearCloudTrack,
    loadAudioFileForTrack,
    shouldAutoPlayRef,
    waitingForCanPlayRef,
    restoredTimeRef,
    restoredTrackIdRef,
    audioUrlReadyRef,
    persistedTimeRef,
    forcePlayRef,
    cloudTrackIndex,
    savePlaybackContext,
    restorePlaybackContext,
    getPlaybackContexts,
    setPlaybackContexts
  };
}
