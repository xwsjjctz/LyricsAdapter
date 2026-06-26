import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Track } from '../types';
import { metadataCacheService } from '../services/metadataCacheService';
import { logger } from '../services/logger';
import { webdavClient } from '../services/webdavClient';
import { UI } from '../constants/config';

interface UsePlaybackOptions {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentTrackIndex: number;
  setCurrentTrackIndex: (index: number | ((prev: number) => number)) => void;
  revokeBlobUrl: (blobUrl: string) => void;
  onTrackSwitch?: () => void;
  initialCurrentTime?: number;
}

export function usePlayback({
  tracks,
  setTracks,
  currentTrackIndex,
  setCurrentTrackIndex,
  revokeBlobUrl,
  onTrackSwitch,
  initialCurrentTime = 0
}: UsePlaybackOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState<number>(UI.DEFAULT_VOLUME);
  const [playbackMode, setPlaybackMode] = useState<'order' | 'shuffle' | 'repeat-one'>('order');
  const [reloadToken, setReloadToken] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shouldAutoPlayRef = useRef<boolean>(false);
  const waitingForCanPlayRef = useRef<boolean>(false);
  const prevAudioUrlRef = useRef<string | null>(null);
  const audioUrlReadyRef = useRef<boolean>(false);
  const persistedTimeRef = useRef<number>(0);
  const lastNonZeroVolumeRef = useRef<number>(0.5);
  const currentTrackIndexRef = useRef<number>(currentTrackIndex);
  const restoredTimeRef = useRef<number>(0);
  const hasRestoredRef = useRef<boolean>(false);
  const lastTrackIdRef = useRef<string | undefined>(undefined);
  const loadedTrackIdRef = useRef<string | undefined>(undefined);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTrack = useMemo(() => {
    return currentTrackIndex >= 0 ? tracks[currentTrackIndex] ?? null : null;
  }, [tracks, currentTrackIndex]);

  useEffect(() => {
    const currentId = currentTrack?.id;
    if (currentId !== lastTrackIdRef.current) {
      lastTrackIdRef.current = currentId;
      if (currentTrackIndex >= 0) {
        hasRestoredRef.current = false;
        restoredTimeRef.current = initialCurrentTime;
      }
    }
  }, [currentTrack?.id, initialCurrentTime]);

  useEffect(() => {
    if (!hasRestoredRef.current && initialCurrentTime > 0) {
      restoredTimeRef.current = initialCurrentTime;
    }
  }, [initialCurrentTime]);

  useEffect(() => {
    currentTrackIndexRef.current = currentTrackIndex;
  }, [currentTrackIndex]);

  // 清除延迟播放定时器（组件卸载时）
  useEffect(() => {
    return () => {
      if (skipTimerRef.current !== null) {
        clearTimeout(skipTimerRef.current);
      }
    };
  }, []);

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
        audioRef.current?.pause();
      } else {
        shouldAutoPlayRef.current = true;
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
      if (!hasRestoredRef.current && restoredTimeRef.current > 0) {
        const seekTime = Math.min(restoredTimeRef.current, audioRef.current.duration || Infinity);
        if (seekTime > 0) {
          audioRef.current.currentTime = seekTime;
          setCurrentTime(seekTime);
          logger.debug('[Playback] Restored time:', seekTime);
        }
        hasRestoredRef.current = true;
        restoredTimeRef.current = 0;
      }
      if (currentTrack.source !== 'webdav') {
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
    }
  }, [currentTrack, currentTrackIndex, setTracks]);

  const getNextTrackIndex = useCallback((direction: 'forward' | 'backward'): number => {
    const listLength = tracks.length;
    if (listLength === 0) return -1;
    const currentIdx = currentTrackIndexRef.current;

    if (playbackMode === 'shuffle') {
      return getRandomIndex(currentIdx, listLength);
    }

    if (direction === 'forward') {
      return currentIdx < listLength - 1 ? currentIdx + 1 : 0;
    } else {
      return currentIdx > 0 ? currentIdx - 1 : listLength - 1;
    }
  }, [tracks.length, playbackMode, getRandomIndex]);

  const handleTrackEnded = useCallback(() => {
    if (playbackMode === 'repeat-one') {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        shouldAutoPlayRef.current = true;
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
    onTrackSwitch?.();
    setCurrentTrackIndex(nextIndex);
  }, [playbackMode, getNextTrackIndex, onTrackSwitch, setCurrentTrackIndex]);

  const loadAudioFileForTrack = useCallback(async (track: Track): Promise<Track> => {
    // If already has an audioUrl (from a previous load), skip
    if (!track.filePath || track.audioUrl) {
      return track;
    }

    // Local file: use audio:// custom protocol for streaming
    // This avoids loading the entire file into memory via IPC readFile.
    // The browser's <audio> element will issue Range requests as needed.
    if (track.source !== 'webdav') {
      // Format: audio://localhost/absolute/path/to/file.flac
      // Normalize Windows drive-letter paths (C:\Users\...) so the URL parser
      // sees localhost as the host and a proper pathname starting with /.
      // Without this, encodeURI("C:\\...") → "C%3A%5C..." producing
      // audio://localhostC%3A... — the whole thing becomes the hostname.
      const normalizedPath = track.filePath.replace(/\\/g, '/');
      const urlPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath;
      const audioUrl = `audio://localhost${encodeURI(urlPath)}`;
      logger.debug('[Playback] Using audio:// for:', track.title);
      return { ...track, audioUrl };
    }

    return track;
  }, []);

  const skipForward = useCallback(() => {
    if (tracks.length === 0) return;

    // 清除之前的延迟定时器（快速连按时的防抖）
    if (skipTimerRef.current !== null) {
      clearTimeout(skipTimerRef.current);
    }

    // 先更新索引（视觉切换），但不触发音频加载
    shouldAutoPlayRef.current = false;
    onTrackSwitch?.();
    const nextIndex = getNextTrackIndex('forward');
    setCurrentTrackIndex(nextIndex);

    // 延迟触发自动播放：快速连按时只有最后一次会生效
    skipTimerRef.current = setTimeout(() => {
      skipTimerRef.current = null;
      shouldAutoPlayRef.current = true;
      // 清除已加载标记，强制 effect 重新加载当前曲目
      loadedTrackIdRef.current = undefined;
      setReloadToken(t => t + 1);
    }, 150);
  }, [tracks.length, getNextTrackIndex, onTrackSwitch, setCurrentTrackIndex]);

  const skipBackward = useCallback(() => {
    if (tracks.length === 0) return;

    // 清除之前的延迟定时器（快速连按时的防抖）
    if (skipTimerRef.current !== null) {
      clearTimeout(skipTimerRef.current);
    }

    // 先更新索引（视觉切换），但不触发音频加载
    shouldAutoPlayRef.current = false;
    onTrackSwitch?.();
    const nextIndex = getNextTrackIndex('backward');
    setCurrentTrackIndex(nextIndex);

    // 延迟触发自动播放：快速连按时只有最后一次会生效
    skipTimerRef.current = setTimeout(() => {
      skipTimerRef.current = null;
      shouldAutoPlayRef.current = true;
      // 清除已加载标记，强制 effect 重新加载当前曲目
      loadedTrackIdRef.current = undefined;
      setReloadToken(t => t + 1);
    }, 150);
  }, [tracks.length, getNextTrackIndex, onTrackSwitch, setCurrentTrackIndex]);

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

    if (waitingForCanPlayRef.current && audioRef.current) {
      waitingForCanPlayRef.current = false;
      logger.debug('[Playback] Attempting playback after canplay');
      audioRef.current.play().then(() => {
        logger.debug('[Playback] ✓ Playback started after canplay');
        setIsPlaying(true);
        shouldAutoPlayRef.current = false;
      }).catch((e) => {
        logger.debug('[Playback] Playback failed after canplay:', e);
        setIsPlaying(false);
        shouldAutoPlayRef.current = true;
      });
    }
  }, []);

  useEffect(() => {
    if (!audioRef.current || !currentTrack) return;

    // 跳过同曲目（id 相同）的重复加载，避免元数据刷新等操作中断正在播放的音频
    if (currentTrack.id === loadedTrackIdRef.current) {
      return;
    }

    // 防抖/快速切歌模式：仅在防抖定时器活跃时跳过音频加载
    // 避免在初始加载（启动恢复等场景）时也阻塞加载
    if (skipTimerRef.current !== null && !shouldAutoPlayRef.current) {
      // 不标记 loadedTrackIdRef，等定时器到期后 effect 重新执行
      loadedTrackIdRef.current = undefined;
      logger.debug('[Playback] Deferred play mode, skip audio load for:', currentTrack.title);
      return;
    }

    loadedTrackIdRef.current = currentTrack.id;

    logger.debug('[Playback] Track changed:', currentTrack.title, 'index:', currentTrackIndex, 'source:', currentTrack.source);

    audioUrlReadyRef.current = false;

    if (currentTrack.source === 'webdav') {
      const handleWebdav = async () => {
        if (!currentTrack.webdavPath) return;
        const capturedIndex = currentTrackIndex;
        const shouldPlay = shouldAutoPlayRef.current;
        logger.info('[Playback] Loading WebDAV audio for:', currentTrack.title, 'autoPlay:', shouldPlay);

        try {
          const cdnUrl = await webdavClient.getCdnUrl(currentTrack.webdavPath);
          if (currentTrackIndexRef.current !== capturedIndex || !audioRef.current) return;
          logger.info('[Playback] CDN URL result:', cdnUrl ? cdnUrl.substring(0, 100) + '...' : 'null');
          if (cdnUrl) {
            audioRef.current.src = cdnUrl;
            audioUrlReadyRef.current = true;
            if (shouldPlay) {
              await audioRef.current.play();
              shouldAutoPlayRef.current = false;
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
        // 先更新 tracks 数组，缓存 audioUrl 以便后续直接播放
        setTracks(prev => {
          const newTracks = [...prev];
          const idx = newTracks.findIndex(t => t.id === updatedTrack.id);
          if (idx !== -1) {
            newTracks[idx] = updatedTrack;
          }
          return newTracks;
        });

        // 防止过期异步回调：如果当前已经切到其他曲目，不设置 src 和播放
        if (loadedTrackIdRef.current !== updatedTrack.id) {
          logger.debug('[Playback] Stale async load ignored for:', updatedTrack.title);
          return;
        }

        // 懒加载完成后直接播放，绕过 loadedTrackIdRef 守卫
        // （该守卫会拦截后续的 effect 重入，导致 play() 永远不被调用）
        if (audioRef.current && updatedTrack.audioUrl) {
          audioRef.current.src = updatedTrack.audioUrl;
          audioUrlReadyRef.current = true;
          if (shouldAutoPlayRef.current) {
            audioRef.current.play().then(() => {
              shouldAutoPlayRef.current = false;
              setIsPlaying(true);
            }).catch((e) => {
              logger.debug('[Playback] Lazy-load play failed, waiting for canplay:', e);
              waitingForCanPlayRef.current = true;
            });
          }
        }
      });
      return;
    }

    if (!currentTrack.audioUrl) {
      logger.debug('[Playback] No audio URL available, pausing playback');
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    waitingForCanPlayRef.current = false;
    audioUrlReadyRef.current = true;

    if (currentTrack.audioUrl) {
      if (shouldAutoPlayRef.current) {
        audioRef.current.play().then(() => {
          logger.debug('[Playback] ✓ Playback started successfully');
          shouldAutoPlayRef.current = false;
          setIsPlaying(true);
        }).catch((e) => {
          logger.debug('[Playback] Playback failed, waiting for canplay:', e);
          waitingForCanPlayRef.current = true;
        });
      }
    }
  }, [currentTrackIndex, currentTrack, loadAudioFileForTrack, setTracks, reloadToken]);

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
          if (!existing) return prev;
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

    if (currentTrack && audio.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      if (currentTrack.source === 'webdav') {
        logger.warn('[Playback] CDN URL not supported, retrying with fresh URL');
        webdavClient.clearCdnCache();

        const currentTimeBeforeError = audio.currentTime || currentTime;
        (async () => {
          try {
            if (!currentTrack.webdavPath || !audioRef.current) return;
            const freshCdnUrl = await webdavClient.getCdnUrl(currentTrack.webdavPath);
            if (!freshCdnUrl || !audioRef.current) return;
            logger.info('[Playback] WebDAV recovery: got fresh CDN URL, resuming playback');

            audioRef.current.src = freshCdnUrl;
            audioUrlReadyRef.current = true;
            shouldAutoPlayRef.current = true;
            waitingForCanPlayRef.current = true;

            if (currentTimeBeforeError > 0) {
              hasRestoredRef.current = false;
              restoredTimeRef.current = currentTimeBeforeError;
            }
          } catch (e) {
            logger.error('[Playback] WebDAV recovery failed:', e);
          }
        })();
      } else {
        logger.warn('[Playback] Blob URL revoked, re-loading audio file');
        setTracks(prev => {
          const newTracks = [...prev];
          const idx = newTracks.findIndex(t => t.id === currentTrack.id);
          if (idx !== -1) {
            const track = newTracks[idx];
            if (!track) return newTracks;
            newTracks[idx] = { ...track, audioUrl: '' };
          }
          return newTracks;
        });
      }
    } else {
      shouldAutoPlayRef.current = false;
    }
  }, [currentTrack, setTracks]);

  const selectTrack = useCallback((idx: number) => {
    shouldAutoPlayRef.current = true;
    if (idx === currentTrackIndex) {
      // 选中同一首曲目：直接恢复播放（switchToTrackIndex 会跳过同 index 的切换）
      setIsPlaying(true);
      audioRef.current?.play().catch(e => logger.error('[Playback] Resume playback failed', e));
      return;
    }
    switchToTrackIndex(idx);
    setIsPlaying(true);
  }, [switchToTrackIndex, currentTrackIndex]);

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
    waitingForCanPlayRef,
    audioUrlReadyRef,
    persistedTimeRef,
    shouldAutoPlayRef,
  };
}
