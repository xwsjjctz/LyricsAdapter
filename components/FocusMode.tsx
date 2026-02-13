import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Track, SyncedLyricLine } from '../types';

interface FocusModeProps {
  track: Track | null;
  isVisible: boolean;
  currentTime: number;
  onClose: () => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onSeek: (time: number) => void;
  volume: number;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  onTogglePlaybackMode: () => void;
  onToggleFocus: () => void;
  audioRef?: React.RefObject<HTMLAudioElement>; // Access to audio element
}

const FocusMode: React.FC<FocusModeProps> = memo(({
  track, isVisible, currentTime, onClose,
  isPlaying, onTogglePlay, onSkipNext, onSkipPrev, onSeek, volume, onVolumeChange, onToggleMute, playbackMode, onTogglePlaybackMode, onToggleFocus, audioRef
}) => {
  const lyricsRef = useRef<HTMLDivElement>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollAnimationRef = useRef<number | null>(null);
  const prevActiveIndexRef = useRef<number>(-1);
  const playerRef = useRef<HTMLDivElement>(null);
  const [isPlayerVisible, setIsPlayerVisible] = useState(true);
  const playerHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Canvas-based color gradient transition
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transitionProgress, setTransitionProgress] = useState(0); // 0 to 1
  const [isTransitioning, setIsTransitioning] = useState(false);
  const animationFrameRef = useRef<number | null>(null);

  // Background images for blending
  const [bgImage1, setBgImage1] = useState<HTMLImageElement | null>(null);
  const [bgImage2, setBgImage2] = useState<HTMLImageElement | null>(null);
  const [canvasOpacity, setCanvasOpacity] = useState(1); // Canvas is always visible

  // Use RAF to get more accurate currentTime, with higher frequency for better sync
  const [realtimeCurrentTime, setRealtimeCurrentTime] = useState(currentTime);
  const lastUpdateRef = useRef(0);
  const lastTimeRef = useRef(0); // Track last time value to avoid unnecessary updates

  useEffect(() => {
    if (!isVisible || !audioRef?.current) {
      return;
    }

    // Reset time ref when track changes to ensure sync
    lastTimeRef.current = 0;

    let animationId: number;

    const updateTime = (timestamp: number) => {
      // Throttle to ~60fps (16ms) for more accurate sync
      if (timestamp - lastUpdateRef.current > 16) {
        lastUpdateRef.current = timestamp;
        if (audioRef.current) {
          const newTime = audioRef.current.currentTime;
          // Only update state if time actually changed
          if (newTime !== lastTimeRef.current) {
            lastTimeRef.current = newTime;
            setRealtimeCurrentTime(newTime);
          }
        }
      }
      animationId = requestAnimationFrame(updateTime);
    };

    animationId = requestAnimationFrame(updateTime);

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      lastTimeRef.current = 0;
    };
  }, [isVisible, audioRef, track?.id]);

  // Use realtime currentTime for more accurate lyrics sync
  const activeCurrentTime = isVisible && audioRef?.current ? realtimeCurrentTime : currentTime;

  const progress = track && track.duration > 0 ? (activeCurrentTime / track.duration) * 100 : 0;

  // Render canvas with color gradient transition
  const renderCanvas = useCallback((progress: number) => () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    // Check if image is loaded and not in broken state
    if (!canvas || !ctx || !bgImage1 || !bgImage1.complete || bgImage1.naturalWidth === 0) return;

    const width = canvas.width = window.innerWidth;
    const height = canvas.height = window.innerHeight;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // If we have both backgrounds, do the gradient transition
    if (bgImage2 && bgImage2.complete && bgImage2.naturalWidth > 0) {
      // Draw first background
      ctx.globalAlpha = 1 - progress;
      ctx.drawImage(bgImage1, 0, 0, width, height);

      // Draw second background on top with inverted alpha
      ctx.globalAlpha = progress;
      ctx.drawImage(bgImage2, 0, 0, width, height);
    } else {
      // Only draw first background (no transition)
      ctx.globalAlpha = 1;
      ctx.drawImage(bgImage1, 0, 0, width, height);
    }

    ctx.globalAlpha = 1.0;
  }, [bgImage1, bgImage2]);

  // Parse lyrics - use synced lyrics if available, otherwise fall back to plain text
  const lyricsLines = useMemo(() => {
    if (track?.syncedLyrics && track.syncedLyrics.length > 0) {
      return track.syncedLyrics;
    }
    // Fall back to plain text lyrics
    if (track?.lyrics) {
      const plainLines = track.lyrics.split(/\r?\n/).filter(line => line.trim().length > 0);
      // Convert to synced lyrics format with even distribution
      return plainLines.map((text, idx) => ({
        time: 0, // No timing info for plain lyrics
        text
      }));
    }
    return [];
  }, [track?.syncedLyrics, track?.lyrics]);

  // Find the currently active lyric line based on timestamp
  const activeIndex = useMemo(() => {
    if (!track || lyricsLines.length === 0) return -1;

    // If we have synced lyrics, find the line based on current time
    if (track.syncedLyrics && track.syncedLyrics.length > 0) {
      for (let i = lyricsLines.length - 1; i >= 0; i--) {
        if (activeCurrentTime >= lyricsLines[i].time) {
          return i;
        }
      }
      return 0;
    }

    // Fall back to percentage-based for plain text lyrics
    if (track.duration > 0) {
      return Math.floor((activeCurrentTime / track.duration) * lyricsLines.length);
    }
    return 0;
  }, [activeCurrentTime, lyricsLines, track]);

  // Helper to format time
  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds === 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Handle user scroll interaction
  const handleUserScroll = () => {
    setIsUserScrolling(true);

    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Set new timeout to resume auto-scroll after 3 seconds
    scrollTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false);

      // Force scroll to current active index when re-enabling auto-scroll
      // This handles the case where lyrics don't change for a long time (instrumental)
      if (lyricsRef.current && activeIndex >= 0) {
        const lyricElements = lyricsRef.current.querySelectorAll('p');
        const targetElement = lyricElements[activeIndex] as HTMLElement;

        if (targetElement) {
          const container = lyricsRef.current;
          const containerHeight = container.clientHeight;
          const elementTop = targetElement.offsetTop;
          const elementHeight = targetElement.clientHeight;
          const targetScroll = elementTop - (containerHeight / 2) + (elementHeight / 2);

          // Animate scroll with ease-out timing
          const startScroll = container.scrollTop;
          const scrollDistance = targetScroll - startScroll;
          const duration = 0.3;
          const startTime = performance.now();

          const animateScroll = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / (duration * 1000), 1);

            // Ease-out function
            const easeOut = 1 - Math.pow(1 - progress, 3);
            container.scrollTop = startScroll + scrollDistance * easeOut;

            if (progress < 1) {
              requestAnimationFrame(animateScroll);
            }
          };

          requestAnimationFrame(animateScroll);
        }
      }
    }, 3000);
  };

  // Handle player mouse enter
  const handlePlayerMouseEnter = () => {
    // Clear any pending hide timeout
    if (playerHideTimeoutRef.current) {
      clearTimeout(playerHideTimeoutRef.current);
      playerHideTimeoutRef.current = null;
    }
    setIsPlayerVisible(true);
  };

  // Handle player mouse leave
  const handlePlayerMouseLeave = () => {
    // Set timeout to hide player after 1 second
    playerHideTimeoutRef.current = setTimeout(() => {
      setIsPlayerVisible(false);
    }, 1000);
  };

  // Cleanup player hide timeout on unmount
  useEffect(() => {
    return () => {
      if (playerHideTimeoutRef.current) {
        clearTimeout(playerHideTimeoutRef.current);
      }
    };
  }, []);

  // Auto-scroll lyrics to current line (only when not user scrolling)
  useEffect(() => {
    if (!isVisible || activeIndex < 0 || isUserScrolling) return;

    // Only scroll when activeIndex actually changes - immediately without debounce
    if (activeIndex !== prevActiveIndexRef.current) {
      prevActiveIndexRef.current = activeIndex;

      // Cancel any ongoing scroll animation
      if (scrollAnimationRef.current !== null) {
        cancelAnimationFrame(scrollAnimationRef.current);
        scrollAnimationRef.current = null;
      }

      if (lyricsRef.current) {
        const lyricElements = lyricsRef.current.querySelectorAll('p');
        const targetElement = lyricElements[activeIndex] as HTMLElement;

        if (targetElement) {
          const container = lyricsRef.current;
          const containerHeight = container.clientHeight;
          const elementTop = targetElement.offsetTop;
          const elementHeight = targetElement.clientHeight;
          const targetScroll = elementTop - (containerHeight / 2) + (elementHeight / 2);

          // Calculate time difference between current and next lyric
          let timeToNextLyric = 2.0; // Default 2 seconds
          if (track?.syncedLyrics && activeIndex < lyricsLines.length - 1) {
            const currentLyricTime = lyricsLines[activeIndex].time;
            const nextLyricTime = lyricsLines[activeIndex + 1].time;
            timeToNextLyric = Math.max(nextLyricTime - currentLyricTime, 0.3);
          }

          // Calculate scroll distance
          const currentScroll = container.scrollTop;
          const scrollDistance = Math.abs(targetScroll - currentScroll);
          const isLongDistance = scrollDistance > containerHeight * 0.8;

          // Dynamic duration: faster for quick lyrics or long distances
          let duration = Math.min(timeToNextLyric * 0.6, 0.8); // Max 800ms
          if (isLongDistance) {
            duration = Math.min(duration, 0.4); // Faster for long distances
          }

          // Animate scroll with custom duration using ease-out timing
          const startTime = performance.now();
          const startScroll = container.scrollTop;
          const scrollChange = targetScroll - startScroll;

          const animateScroll = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / (duration * 1000), 1);

            // Ease-out function: 1 - (1 - t)^3
            const easeOut = 1 - Math.pow(1 - progress, 3);
            container.scrollTop = startScroll + scrollChange * easeOut;

            if (progress < 1) {
              scrollAnimationRef.current = requestAnimationFrame(animateScroll);
            } else {
              scrollAnimationRef.current = null;
            }
          };

          scrollAnimationRef.current = requestAnimationFrame(animateScroll);
        }
      }
    }
  }, [activeIndex, isVisible, isUserScrolling, track?.syncedLyrics, lyricsLines]);

  // Reset scroll state when track changes
  useEffect(() => {
    prevActiveIndexRef.current = -1;
    lastTimeRef.current = 0; // Reset time ref to force fresh start
    setRealtimeCurrentTime(0); // Reset current time to start

    // Scroll to top when track changes - use setTimeout to ensure it runs after render
    setTimeout(() => {
      if (lyricsRef.current) {
        lyricsRef.current.scrollTop = 0;
      }
    }, 0);
  }, [track?.id]);

  // Reset player visibility when focus mode becomes visible
  useEffect(() => {
    if (isVisible) {
      setIsPlayerVisible(true);
      // Clear any pending hide timeout
      if (playerHideTimeoutRef.current) {
        clearTimeout(playerHideTimeoutRef.current);
        playerHideTimeoutRef.current = null;
      }
      // Start hide timer - mouse enter will cancel it if mouse is over player
      playerHideTimeoutRef.current = setTimeout(() => {
        setIsPlayerVisible(false);
      }, 1000);
    }
  }, [isVisible]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (scrollAnimationRef.current !== null) {
        cancelAnimationFrame(scrollAnimationRef.current);
      }
    };
  }, []);

  // Canvas-based color gradient transition for background switching
  useEffect(() => {
    if (!track?.id || !track?.coverUrl) return;

    // If bgImage1 just loaded and canvasOpacity < 1, apply initial brightness
    if (bgImage1 && canvasOpacity < 1) {
      const canvas = canvasRef.current;
      if (canvas) {
        // Set initial brightness to 0.3 when fading in
        canvas.style.filter = `blur(80px) saturate(1.5) brightness(0.3)`;
      }
    }
  }, [bgImage1, canvasOpacity]);

  // Preload background image when track changes (before entering focus mode)
  useEffect(() => {
    if (!track?.id || !track?.coverUrl) return;

    // Load new background image
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => {
      console.warn('[FocusMode] Failed to load cover image, skipping background');
    };
    img.onload = () => {
      // Start transition from current to new background
      const oldBg = bgImage2 || bgImage1;
      if (!oldBg) {
        // First load, set as bg1
        setBgImage1(img);
        setBgImage2(null);
        setTransitionProgress(1);

        // Apply brightness animation for first load
        // Only animate if focus mode is visible
        const canvas = canvasRef.current;
        if (canvas && isVisible) {
          // Set initial brightness to 0.3
          canvas.style.filter = `blur(80px) saturate(1.5) brightness(0.3)`;

          const startTime = performance.now();
          const duration = 700; // 700ms animation

          const animateFirstLoad = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Brightness fade-in: 0.3 -> 0.55
            const breathingBrightness = 0.3 + 0.25 * progress;
            canvas.style.filter = `blur(80px) saturate(1.5) brightness(${breathingBrightness})`;

            if (progress < 1) {
              requestAnimationFrame(animateFirstLoad);
            }
            // No need to reset - it ends at brightness(0.55) which matches static state
          };

          requestAnimationFrame(animateFirstLoad);
        } else if (canvas) {
          // If not visible, just set to normal values
          canvas.style.filter = `blur(80px) saturate(1.5) brightness(0.55)`;
        }
        return;
      }

      // Start color gradient transition
      setIsTransitioning(true);
      setTransitionProgress(0);

      const startTime = performance.now();
      const duration = 1000; // 1000ms transition (slower, more dramatic)

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        setTransitionProgress(progress);

        // Brightness breathing effect: goes from 0.55 -> 0.3 -> 0.55
        // Using sine wave for smooth curve, more transparent during transition
        const breathingBrightness = 0.55 - 0.25 * Math.sin(progress * Math.PI);

        // Directly update canvas filter for immediate effect
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.style.filter = `blur(80px) saturate(1.5) brightness(${breathingBrightness})`;
        }

        if (progress < 1) {
          animationFrameRef.current = requestAnimationFrame(animate);
        } else {
          // Transition complete
          setIsTransitioning(false);
          setBgImage1(img);
          setBgImage2(null);
          setTransitionProgress(1);
          setCanvasOpacity(1); // Reset canvas opacity to fully opaque

          // Reset filter to normal
          if (canvas) {
            canvas.style.filter = `blur(80px) saturate(1.5) brightness(0.55)`;
          }

          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
        }
      };

      // Start animation
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(animate);

      // Update bg2 to the new image during transition
      setBgImage2(img);
    };

    img.onerror = () => {
      // If load fails, just set as bg1
      setBgImage1(img);
      setBgImage2(null);
      setTransitionProgress(1);
    };

    img.src = track.coverUrl;
  }, [track?.id, track?.coverUrl]);

  // Render canvas when transitioning or when bgImage1 loads
  useEffect(() => {
    // Render during transition
    if (isTransitioning && bgImage1 && bgImage2) {
      const render = renderCanvas(transitionProgress);
      const frame = requestAnimationFrame(render);
      return () => cancelAnimationFrame(frame);
    }

    // Also render when bgImage1 loads and we're not transitioning
    if (!isTransitioning && bgImage1 && !bgImage2) {
      const render = renderCanvas(1); // Progress = 1 (fully visible)
      render();
    }
  }, [isTransitioning, transitionProgress, bgImage1, bgImage2, renderCanvas]);

  // Handle click on synced lyric line to seek
  const handleLyricClick = (lyricTime: number) => {
    if (lyricTime > 0 && onSeek) {
      onSeek(lyricTime);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 transition-all duration-700 ease-in-out ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}>
      {/* Canvas-based Color Gradient Background */}
      {bgImage1 && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{
            filter: 'blur(80px) saturate(1.5) brightness(0.55)',
            opacity: 1,
            transition: 'filter 700ms ease-in-out'
          }}
        />
      )}
      <div className="fixed inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/50 backdrop-blur-sm" />

      <div className="relative h-full flex flex-col z-10 overflow-hidden">
        {/* Top Header */}
        <header className="flex items-center justify-start px-6 py-4 shrink-0 pt-12">
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-white/40 hover:text-white transition-all group"
          >
            <div className="bg-white/5 p-1.5 rounded-full group-hover:bg-white/10 transition-colors flex items-center justify-center">
              <span className="material-symbols-outlined text-base">keyboard_arrow_down</span>
            </div>
            <span className="text-[9px] font-bold tracking-[0.15em] uppercase">Now Playing</span>
          </button>
        </header>

        {/* Content Section */}
        <main className="flex-1 flex flex-col lg:flex-row items-center justify-center pl-0 pr-4 lg:pl-0 lg:pr-8 gap-20 lg:gap-32 overflow-visible mb-24 max-w-5xl mx-auto w-full translate-x-8 lg:translate-x-12">

          {/* Cover & Title */}
          <div className="flex-none flex flex-col items-center justify-center w-auto p-6">
            <div className="relative w-full aspect-square max-w-[280px] lg:max-w-[340px] shadow-[0_30px_80px_rgba(0,0,0,0.5)] rounded-2xl overflow-hidden group">
              <img
                src={track?.coverUrl}
                className={`w-full h-full object-cover transition-transform duration-[6s] ${isPlaying ? 'scale-110' : 'scale-100'}`}
                alt="album cover"
              />
            </div>
            <div className="mt-5 lg:mt-7 text-center w-full max-w-[340px]">
              <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-white mb-2 line-clamp-2 drop-shadow-2xl">
                {track?.title}
              </h1>
              <p className="text-base lg:text-lg text-primary font-semibold truncate opacity-80">
                {track?.artist}
              </p>
              <p className="text-xs lg:text-sm text-white/30 font-medium truncate mt-1">
                {track?.album}
              </p>
            </div>
          </div>

          {/* Lyrics */}
          <div
            className="flex-1 h-full max-h-[50vh] lg:max-h-[60vh] overflow-y-auto no-scrollbar mask-fade flex flex-col gap-5 lg:gap-7 py-36 px-8"
            ref={lyricsRef}
            onScroll={handleUserScroll}
          >
            {lyricsLines.length > 0 ? (
              lyricsLines.map((lyric, idx) => {
                const isActive = idx === activeIndex;
                const hasTimestamp = track?.syncedLyrics && lyric.time > 0;
                return (
                  <p
                    key={idx}
                    className={`text-xl lg:text-2xl font-bold leading-tight cursor-default ${
                      isActive ? 'active-lyric transition-all duration-300' : 'text-white/10 hover:text-white/30 transition-all duration-200'
                    } ${hasTimestamp ? 'cursor-pointer' : ''}`}
                    onClick={() => hasTimestamp && handleLyricClick(lyric.time)}
                  >
                    {lyric.text}
                  </p>
                );
              })
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-white/10 gap-3">
                <span className="material-symbols-outlined text-4xl">lyrics</span>
                <p className="italic text-base">No lyrics found in metadata</p>
              </div>
            )}
          </div>
        </main>

        {/* Compact Bottom Player */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xl px-5">
          <div
            ref={playerRef}
            onMouseEnter={handlePlayerMouseEnter}
            onMouseLeave={handlePlayerMouseLeave}
            className="glass rounded-2xl p-4 flex flex-col gap-3 shadow-xl border border-white/5 relative z-20 transition-opacity duration-500"
            style={{ opacity: isPlayerVisible ? 1 : 0 }}
          >
            {/* Progress */}
            <div className="w-full flex items-center gap-3">
              <span className="text-[10px] tabular-nums font-bold text-white/30 w-10 text-right">{formatTime(activeCurrentTime)}</span>
              <div
                className="flex-1 relative h-1 bg-white/10 rounded-full cursor-pointer group"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const pct = x / rect.width;
                  onSeek(pct * (track?.duration || 0));
                }}
              >
                <div
                  className="absolute top-0 left-0 h-full bg-primary shadow-[0_0_15px_rgba(43,140,238,0.5)] rounded-full transition-all duration-100"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 size-2 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ left: `${progress}%`, marginLeft: '-4px' }}
                />
              </div>
              <span className="text-[10px] tabular-nums font-bold text-white/30 w-10">{formatTime(track?.duration || 0)}</span>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between px-4">
              <div className="flex gap-4 text-white/20">
                <span
                  className="material-symbols-outlined text-lg hover:text-white cursor-pointer transition-colors relative -left-[4px]"
                  onClick={onTogglePlaybackMode}
                >
                  {playbackMode === 'shuffle'
                    ? 'shuffle'
                    : playbackMode === 'repeat-one'
                    ? 'repeat_one'
                    : 'repeat'}
                </span>
              </div>

              <div className="flex items-center gap-6 relative left-[30px]">
                <button onClick={onSkipPrev} className="text-white/60 hover:text-white transition-all hover:scale-110">
                  <span className="material-symbols-outlined text-2xl">skip_previous</span>
                </button>
                <button
                  onClick={onTogglePlay}
                  className="bg-white text-black size-11 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg"
                >
                  <span className="material-symbols-outlined text-3xl">{isPlaying ? 'pause' : 'play_arrow'}</span>
                </button>
                <button onClick={onSkipNext} className="text-white/60 hover:text-white transition-all hover:scale-110">
                  <span className="material-symbols-outlined text-2xl">skip_next</span>
                </button>
              </div>

              <div className="flex justify-end gap-4 text-white/20 items-center">
                <span
                  className="material-symbols-outlined text-lg hover:text-white cursor-pointer transition-colors"
                  onClick={onToggleMute}
                >
                  {volume === 0 ? 'volume_off' : 'volume_up'}
                </span>
                <div className="w-16 relative h-4 flex items-center group">
                  <input
                    type="range" min="0" max="1" step="0.01" value={volume}
                    onChange={(e) => onVolumeChange(Number(e.target.value))}
                    className="w-full absolute z-10 opacity-0 cursor-pointer h-full"
                  />
                  <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-white/60" style={{width: `${volume * 100}%`}}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for React.memo
  // FocusMode is expensive to render, so we want to minimize re-renders

  // Always re-render when visibility changes
  if (prevProps.isVisible !== nextProps.isVisible) return false;

  // Re-render when track changes
  if (prevProps.track !== nextProps.track) return false;

  // Re-render when playback state changes
  if (prevProps.isPlaying !== nextProps.isPlaying) return false;

  // Re-render when volume changes
  if (prevProps.volume !== nextProps.volume) return false;

  // Check callbacks
  if (prevProps.onClose !== nextProps.onClose) return false;
  if (prevProps.onTogglePlay !== nextProps.onTogglePlay) return false;
  if (prevProps.onSkipNext !== nextProps.onSkipNext) return false;
  if (prevProps.onSkipPrev !== nextProps.onSkipPrev) return false;
  if (prevProps.onSeek !== nextProps.onSeek) return false;
  if (prevProps.onVolumeChange !== nextProps.onVolumeChange) return false;
  if (prevProps.onToggleMute !== nextProps.onToggleMute) return false;
  if (prevProps.playbackMode !== nextProps.playbackMode) return false;
  if (prevProps.onTogglePlaybackMode !== nextProps.onTogglePlaybackMode) return false;
  if (prevProps.onToggleFocus !== nextProps.onToggleFocus) return false;

  // For currentTime, we allow more frequent updates (0.5 second threshold)
  // This keeps the lyrics scrolling smooth while avoiding excessive re-renders
  const timeDiff = Math.abs(prevProps.currentTime - nextProps.currentTime);
  if (timeDiff > 0.5) return false;

  // All props are effectively the same, skip re-render
  return true;
});

FocusMode.displayName = 'FocusMode';

export default FocusMode;
