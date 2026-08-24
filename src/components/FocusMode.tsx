import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Track } from '../types';
import { logger } from '../services/logger';
import { themeManager } from '../services/themeManager';
import { registerCommand } from '../services/debugCommands';
import { settingsManager } from '../services/settingsManager';
import { ThemeConfig, THEME_IDS } from '../types/theme';
import { getDesktopAPI } from '../services/desktopAdapter';
import { toCoverThumb } from '../services/coverUrl';
import FocusBackdrop from './focus-mode/FocusBackdrop';
import FocusControls from './focus-mode/FocusControls';
import FocusCoverStage from './focus-mode/FocusCoverStage';
import FocusTrackMeta from './focus-mode/FocusTrackMeta';
import FocusLyricRow from './focus-mode/FocusLyricRow';
import { useFocusModeScale } from './focus-mode/focusModeScale';

// FocusMode 沉浸式深色风格的固定颜色（不受主题影响）
const FOCUS_MODE_COLORS = {
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  textMuted: 'rgba(255, 255, 255, 0.4)',
  backgroundCard: 'rgba(255, 255, 255, 0.08)',
  backgroundCardHover: 'rgba(255, 255, 255, 0.12)',
  borderLight: 'rgba(255, 255, 255, 0.1)',
};

// Keep the backdrop below CSS pixel resolution without flattening its colour
// gradients as aggressively as the former 0.25 scale. At 0.5 the visible
// bitmap still has only one quarter of the full-resolution pixels, while the
// expensive blur remains off the full-window compositor path.
const BACKDROP_RENDER_SCALE = 0.5;
const BACKDROP_OVERSCAN_PX = 100;
const BACKDROP_SATURATION = 1.5;
const BACKDROP_RESTING_BRIGHTNESS = 0.55;
const BACKDROP_DIM_BRIGHTNESS = 0.3;
const BACKDROP_TRANSITION_DURATION_MS = 1000;
const CLOCK_RESYNC_THRESHOLD_SECONDS = 0.25;
// Canvas2D blur samples transparent pixels outside its backing store. Prepare
// an edge-extended source with enough filter padding, then crop the centre, so
// an opaque cover remains opaque at every visible window edge.
const BACKDROP_FILTER_PADDING_MULTIPLIER = 4;

interface PreparedBackdrop {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  scaledBlurRadius: number;
}

function coverSourceRect(
  img: HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } {
  const imageRatio = img.naturalWidth / img.naturalHeight;
  const targetRatio = targetWidth / targetHeight;

  if (imageRatio > targetRatio) {
    const height = img.naturalHeight;
    const width = height * targetRatio;
    return { x: (img.naturalWidth - width) / 2, y: 0, width, height };
  }

  const width = img.naturalWidth;
  const height = width / targetRatio;
  return { x: 0, y: (img.naturalHeight - height) / 2, width, height };
}

function drawEdgeExtendedCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  padding: number,
): void {
  const source = coverSourceRect(img, width, height);
  const edgeWidth = Math.min(1, source.width);
  const edgeHeight = Math.min(1, source.height);
  const rightX = source.x + source.width - edgeWidth;
  const bottomY = source.y + source.height - edgeHeight;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, source.x, source.y, source.width, source.height, padding, padding, width, height);

  // Extend the source's outermost pixels through the filter padding. This is
  // equivalent to an edge-clamped blur and avoids mixing transparent black into
  // the visible viewport without zooming or changing the cover crop.
  ctx.drawImage(img, source.x, source.y, source.width, edgeHeight, padding, 0, width, padding);
  ctx.drawImage(img, source.x, bottomY, source.width, edgeHeight, padding, padding + height, width, padding);
  ctx.drawImage(img, source.x, source.y, edgeWidth, source.height, 0, padding, padding, height);
  ctx.drawImage(img, rightX, source.y, edgeWidth, source.height, padding + width, padding, padding, height);
  ctx.drawImage(img, source.x, source.y, edgeWidth, edgeHeight, 0, 0, padding, padding);
  ctx.drawImage(img, rightX, source.y, edgeWidth, edgeHeight, padding + width, 0, padding, padding);
  ctx.drawImage(img, source.x, bottomY, edgeWidth, edgeHeight, 0, padding + height, padding, padding);
  ctx.drawImage(img, rightX, bottomY, edgeWidth, edgeHeight, padding + width, padding + height, padding, padding);
}

interface FocusModeProps {
  track: Track | null;
  isVisible: boolean;
  currentTime: number;
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

const FocusModeContent: React.FC<FocusModeProps> = memo(({
  track, isVisible, currentTime,
  isPlaying, onTogglePlay, onSkipNext, onSkipPrev, onSeek, volume, onVolumeChange, onToggleMute, playbackMode, onTogglePlaybackMode, onToggleFocus: _onToggleFocus, audioRef
}) => {
  const isLinux = getDesktopAPI()?.platform === 'linux';

  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());

  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  const lyricsRef = useRef<HTMLDivElement>(null);
  const lyricListRef = useRef<HTMLDivElement>(null);
  const autoOffsetRef = useRef(0);
  const currentOffsetRef = useRef(0);
  const lyricAnimationRef = useRef<number | null>(null);
  const preScrolledIndexRef = useRef<number>(-1);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [manualOffsetY, setManualOffsetY] = useState(0);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollAnimationRef = useRef<number | null>(null);
  const prevActiveIndexRef = useRef<number>(-1);
  const playerRef = useRef<HTMLDivElement>(null);
  const [isPlayerVisible, setIsPlayerVisible] = useState(true);
  const playerHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Canvas-based color gradient transition
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasBackground, setHasBackground] = useState(false);
  const currentBackgroundRef = useRef<HTMLImageElement | null>(null);
  const incomingBackgroundRef = useRef<HTMLImageElement | null>(null);
  const transitionProgressRef = useRef(1);
  const backdropBrightnessRef = useRef(BACKDROP_RESTING_BRIGHTNESS);
  const animationFrameRef = useRef<number | null>(null);
  const backgroundLoadGenerationRef = useRef(0);
  const backdropSourceScratchRef = useRef<HTMLCanvasElement | null>(null);
  const backdropFilteredScratchRef = useRef<HTMLCanvasElement | null>(null);
  const backdropFrameScratchRef = useRef<HTMLCanvasElement | null>(null);
  const preparedBackdropCacheRef = useRef<WeakMap<HTMLImageElement, PreparedBackdrop>>(new WeakMap());

  // 0..1 enter/exit factor for the backdrop alpha (0 → alpha 0.3, 1 → bgBlurTrans).
  const canvasOpacityRef = useRef(0);
  const enterExitAnimRef = useRef<number | null>(null);

  // Global background transparency control for debugging
  const [bgBlurTrans, setBgBlurTrans] = useState(() => settingsManager.getBgBlurTrans());
  const [bgBlurRadius, setBgBlurRadius] = useState(() => settingsManager.getFocusBgBlurRadius());
  const [lyricsFontSize, setLyricsFontSize] = useState(() => settingsManager.getFocusLyricsFontSize());
  const [lyricLineSpacing, setLyricLineSpacing] = useState(() => settingsManager.getFocusLyricLineSpacing());
  const [inactiveLyricBlur, setInactiveLyricBlur] = useState(() => settingsManager.getFocusInactiveLyricBlur());
  const focusScale = useFocusModeScale();
  const effectiveLyricsFontSize = Math.round(lyricsFontSize * focusScale * 100) / 100;
  const effectiveLyricLineSpacing = Math.round(lyricLineSpacing * focusScale * 100) / 100;
  const hasScaledLayout = focusScale > 1;
  const bgBlurTransRef = useRef(bgBlurTrans);
  const bgBlurRadiusRef = useRef(bgBlurRadius);

  // Sync with settingsManager when changed externally (e.g. from SettingsView slider)
  useEffect(() => {
    const unsubscribe = settingsManager.subscribe(() => {
      const transparency = settingsManager.getBgBlurTrans();
      bgBlurTransRef.current = transparency;
      setBgBlurTrans(transparency);
      const radius = settingsManager.getFocusBgBlurRadius();
      bgBlurRadiusRef.current = radius;
      setBgBlurRadius(radius);
      setLyricsFontSize(settingsManager.getFocusLyricsFontSize());
      setLyricLineSpacing(settingsManager.getFocusLyricLineSpacing());
      setInactiveLyricBlur(settingsManager.getFocusInactiveLyricBlur());
    });
    return unsubscribe;
  }, []);

  // Theme colors
  const colors = currentTheme.colors;
  // FocusMode uses fixed dark colors for immersive experience (except player controls)
  const focusColors = FOCUS_MODE_COLORS;
  const useDefaultThemeControlGlass =
    (currentTheme.id === THEME_IDS.DEFAULT_DARK || currentTheme.id === THEME_IDS.DEFAULT);

  // Keep an exact RAF time ref for karaoke and a lighter state snapshot for UI.
  const [realtimeCurrentTime, setRealtimeCurrentTime] = useState(currentTime);
  const realtimeCurrentTimeRef = useRef(currentTime);
  const lastUpdateRef = useRef(0);
  const lastTimeRef = useRef(0); // Track last time value to avoid unnecessary updates

  useEffect(() => {
    if (!isVisible || !isPlaying || !audioRef?.current) {
      return;
    }

    // Reset time ref when track changes to ensure sync
    lastTimeRef.current = 0;

    let animationId: number;

    const updateTime = (timestamp: number) => {
      if (audioRef.current) {
        realtimeCurrentTimeRef.current = audioRef.current.currentTime;
      }

      // Active-line selection, controls and pre-scroll only need a lightweight
      // 20fps React update. The word fill above still reads the ref every frame.
      if (timestamp - lastUpdateRef.current > 50) {
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
  }, [isVisible, isPlaying, audioRef, track?.id]);

  // Browser fallback, paused seeks, and renderer restoration all need the
  // shared clock. During normal playback the local RAF remains authoritative;
  // only a meaningful drift triggers this pre-paint correction.
  useLayoutEffect(() => {
    if (!Number.isFinite(currentTime) || currentTime < 0) return;
    const drift = Math.abs(realtimeCurrentTimeRef.current - currentTime);
    if (!isPlaying || drift >= CLOCK_RESYNC_THRESHOLD_SECONDS) {
      realtimeCurrentTimeRef.current = currentTime;
      lastTimeRef.current = currentTime;
      setRealtimeCurrentTime(currentTime);
    }
  }, [currentTime, isPlaying]);

  // A paused player has no moving clock: read its exact media time once during
  // render and stop both Focus RAF loops until playback resumes.
  const pausedCurrentTime = !isPlaying && audioRef?.current
    ? audioRef.current.currentTime
    : currentTime;
  if (!isPlaying) realtimeCurrentTimeRef.current = pausedCurrentTime;

  // Use realtime currentTime for more accurate lyrics sync while playing.
  const activeCurrentTime = isVisible && audioRef?.current
    ? (isPlaying ? realtimeCurrentTime : pausedCurrentTime)
    : currentTime;

  const progress = track && track.duration > 0 ? (activeCurrentTime / track.duration) * 100 : 0;

  const prepareBackdrop = useCallback((
    img: HTMLImageElement,
    width: number,
    height: number,
  ): HTMLCanvasElement | null => {
    const scaledBlurRadius = bgBlurRadiusRef.current * BACKDROP_RENDER_SCALE;
    const cached = preparedBackdropCacheRef.current.get(img);
    if (
      cached
      && cached.width === width
      && cached.height === height
      && cached.scaledBlurRadius === scaledBlurRadius
    ) {
      return cached.canvas;
    }

    const padding = Math.max(
      2,
      Math.ceil(scaledBlurRadius * BACKDROP_FILTER_PADDING_MULTIPLIER),
    );
    const paddedWidth = width + padding * 2;
    const paddedHeight = height + padding * 2;
    const sourceCanvas = backdropSourceScratchRef.current ?? document.createElement('canvas');
    const filteredCanvas = backdropFilteredScratchRef.current ?? document.createElement('canvas');
    backdropSourceScratchRef.current = sourceCanvas;
    backdropFilteredScratchRef.current = filteredCanvas;

    if (sourceCanvas.width !== paddedWidth) sourceCanvas.width = paddedWidth;
    if (sourceCanvas.height !== paddedHeight) sourceCanvas.height = paddedHeight;
    if (filteredCanvas.width !== paddedWidth) filteredCanvas.width = paddedWidth;
    if (filteredCanvas.height !== paddedHeight) filteredCanvas.height = paddedHeight;

    const sourceCtx = sourceCanvas.getContext('2d');
    const filteredCtx = filteredCanvas.getContext('2d');
    if (!sourceCtx || !filteredCtx) return null;

    sourceCtx.clearRect(0, 0, paddedWidth, paddedHeight);
    drawEdgeExtendedCover(sourceCtx, img, width, height, padding);

    filteredCtx.filter = 'none';
    filteredCtx.globalAlpha = 1;
    filteredCtx.clearRect(0, 0, paddedWidth, paddedHeight);
    filteredCtx.imageSmoothingEnabled = true;
    filteredCtx.imageSmoothingQuality = 'high';
    filteredCtx.filter = `blur(${scaledBlurRadius}px) saturate(${BACKDROP_SATURATION})`;
    filteredCtx.drawImage(sourceCanvas, 0, 0);
    filteredCtx.filter = 'none';

    const preparedCanvas = document.createElement('canvas');
    preparedCanvas.width = width;
    preparedCanvas.height = height;
    const preparedCtx = preparedCanvas.getContext('2d');
    if (!preparedCtx) return null;
    preparedCtx.imageSmoothingEnabled = true;
    preparedCtx.imageSmoothingQuality = 'high';
    preparedCtx.drawImage(
      filteredCanvas,
      padding,
      padding,
      width,
      height,
      0,
      0,
      width,
      height,
    );

    preparedBackdropCacheRef.current.set(img, {
      canvas: preparedCanvas,
      width,
      height,
      scaledBlurRadius,
    });
    return preparedCanvas;
  }, []);

  // Render the complete backdrop frame directly. Transition progress and the
  // brightness "breathing" value live in refs so a cover cross-fade does not
  // cause a React commit on every animation frame.
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const currentBackground = currentBackgroundRef.current;
    if (!canvas || !ctx || !currentBackground || !currentBackground.complete || currentBackground.naturalWidth === 0) return;

    const cssWidth = Math.max(1, window.innerWidth + BACKDROP_OVERSCAN_PX * 2);
    const cssHeight = Math.max(1, window.innerHeight + BACKDROP_OVERSCAN_PX * 2);
    const width = Math.max(1, Math.ceil(cssWidth * BACKDROP_RENDER_SCALE));
    const height = Math.max(1, Math.ceil(cssHeight * BACKDROP_RENDER_SCALE));
    // Assigning width/height clears and reallocates the backing store. During a
    // transition this function runs every frame, so only resize when necessary.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const preparedCurrent = prepareBackdrop(currentBackground, width, height);
    if (!preparedCurrent) return;

    // Effective backdrop alpha: 0.3 at the dim end (factor 0) up to bgBlurTrans
    // at full visibility (factor 1). canvasOpacityRef is animated on enter/exit.
    const alpha = 0.3 + (bgBlurTransRef.current - 0.3) * canvasOpacityRef.current;
    const incomingBackground = incomingBackgroundRef.current;
    const transitionProgress = transitionProgressRef.current;
    const preparedIncoming = incomingBackground
      && incomingBackground.complete
      && incomingBackground.naturalWidth > 0
      ? prepareBackdrop(incomingBackground, width, height)
      : null;
    if (incomingBackground && !preparedIncoming) return;

    const frameCanvas = backdropFrameScratchRef.current ?? document.createElement('canvas');
    backdropFrameScratchRef.current = frameCanvas;
    if (frameCanvas.width !== width) frameCanvas.width = width;
    if (frameCanvas.height !== height) frameCanvas.height = height;
    const frameCtx = frameCanvas.getContext('2d');
    if (!frameCtx) return;

    frameCtx.filter = 'none';
    frameCtx.globalAlpha = 1;
    frameCtx.clearRect(0, 0, width, height);
    frameCtx.imageSmoothingEnabled = true;
    frameCtx.imageSmoothingQuality = 'high';
    // Blur and saturation are cached per decoded cover. Animation frames only
    // apply the inexpensive brightness matrix and alpha blend.
    frameCtx.filter = `brightness(${backdropBrightnessRef.current})`;
    frameCtx.drawImage(preparedCurrent, 0, 0);

    // Paint the old image opaquely, then fade the new one over it. This keeps
    // colour interpolation linear and prevents either cover's blur edge from
    // creating an accidental alpha seam inside the prepared frame.
    if (preparedIncoming) {
      frameCtx.globalAlpha = transitionProgress;
      frameCtx.drawImage(preparedIncoming, 0, 0);
    }
    frameCtx.globalAlpha = 1;
    frameCtx.filter = 'none';

    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Restore the original track-change opacity breathing as a deliberate,
    // uniform final-pass alpha. The legacy two-draw source-over path produced:
    //   Aout = A * (1 - A * p * (1 - p))
    // (Aout = 0.75 at p = 0.5 when A = 1). Applying the same curve after the
    // opaque colour cross-fade preserves that visual rhythm without bringing
    // back steady-state edge transparency or nonlinear colour blending.
    const transitionAlpha = preparedIncoming
      ? alpha * (1 - alpha * transitionProgress * (1 - transitionProgress))
      : alpha;
    ctx.globalAlpha = transitionAlpha;
    ctx.drawImage(frameCanvas, 0, 0);

    ctx.globalAlpha = 1.0;
  }, [prepareBackdrop]);

  // Duration of the canvas backdrop alpha fade on enter/exit (matches the
  // Focus Mode slide). Entry: alpha 0.3 → bgBlurTrans; exit: bgBlurTrans → 0.3.
  const CANVAS_ALPHA_DURATION = 600;

  // Animate the backdrop alpha on enter/exit. canvasOpacityRef is a 0..1 factor
  // baked into the draw alpha by renderCanvas; we redraw each frame so the fade
  // always repaints. Declared after renderCanvas so it can reference it.
  useEffect(() => {
    if (enterExitAnimRef.current) {
      cancelAnimationFrame(enterExitAnimRef.current);
      enterExitAnimRef.current = null;
    }

    const target = isVisible ? 1 : 0;
    const from = canvasOpacityRef.current;
    if (from === target) {
      renderCanvas();
      return;
    }

    // Preserve the original Focus entrance cadence. The pre-load pass may draw
    // nothing; when the background commits it restarts from the factor already
    // reached, just as changing the old bgImage state changed renderCanvas'
    // identity. A very late image therefore appears at the completed alpha.
    const startTime = performance.now();
    const animate = (now: number) => {
      const p = Math.min((now - startTime) / CANVAS_ALPHA_DURATION, 1);
      // Entry (target 1): ease-in → alpha ramps up LATE, once more of the page
      //   is on screen, so the brightening is easier to perceive.
      // Exit (target 0): ease-out → alpha drops EARLY, before the page slides
      //   away, so the dimming is visible.
      const eased = target === 1 ? Math.pow(p, 3) : 1 - Math.pow(1 - p, 3);
      canvasOpacityRef.current = from + (target - from) * eased;
      renderCanvas();
      if (p < 1) {
        enterExitAnimRef.current = requestAnimationFrame(animate);
      } else {
        canvasOpacityRef.current = target;
        enterExitAnimRef.current = null;
      }
    };
    enterExitAnimRef.current = requestAnimationFrame(animate);

    return () => {
      if (enterExitAnimRef.current) {
        cancelAnimationFrame(enterExitAnimRef.current);
        enterExitAnimRef.current = null;
      }
    };
  }, [hasBackground, isVisible, renderCanvas]);

  // Parse lyrics - use synced lyrics if available, otherwise fall back to plain text
  const lyricsLines = useMemo(() => {
    if (track?.syncedLyrics && track.syncedLyrics.length > 0) {
      // NetEase lyrics carry no `[ti:]` title header (they start at 作词/作曲
      // or the first verse), so synthesize one from track metadata to match the
      // QQ Music lyric-list presentation. QQ/local/WebDAV lyrics already embed
      // their own title line, so leave those untouched.
      if (track.source === 'netease' && (track.title || track.artist)) {
        const titleText = [track.title, track.artist].filter(Boolean).join(' - ');
        if (titleText) {
          return [{ time: 0, text: titleText }, ...track.syncedLyrics];
        }
      }
      return track.syncedLyrics;
    }
    // Fall back to plain text lyrics
    if (track?.lyrics) {
      const plainLines = track.lyrics.split(/\r?\n/)
        .map(line => line.trim().replace(/^\[\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?\]/, ''))
        .filter(line => line.length > 0 && line !== '//');
      // Convert to synced lyrics format with even distribution
      return plainLines.map((text, _idx) => ({
        time: 0, // No timing info for plain lyrics
        text
      }));
    }
    return [];
  }, [track?.syncedLyrics, track?.lyrics, track?.source, track?.title, track?.artist]);
  const hasLyrics = lyricsLines.length > 0;

  // Find the currently active lyric line based on timestamp
  const activeIndex = useMemo(() => {
    if (!track || lyricsLines.length === 0) return -1;

    // If we have synced lyrics, find the line based on current time
    if (track.syncedLyrics && track.syncedLyrics.length > 0) {
        for (let i = lyricsLines.length - 1; i >= 0; i--) {
        if (lyricsLines[i] && activeCurrentTime >= lyricsLines[i]!.time) {
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

  // Calculate scroll boundaries for lyrics
  const getScrollBounds = useCallback(() => {
    const container = lyricsRef.current;
    const lyricList = lyricListRef.current;
    if (!container || !lyricList) return { min: -Infinity, max: Infinity };
    
    const containerHeight = container.clientHeight;
    const lineElements = Array.from(lyricList.children) as HTMLElement[];
    if (lineElements.length === 0) return { min: -Infinity, max: Infinity };

    const GAP = effectiveLyricLineSpacing;
    
    // Calculate total content height
    let totalContentHeight = 0;
    for (let i = 0; i < lineElements.length; i++) {
      totalContentHeight += lineElements[i]!.offsetHeight;
      if (i < lineElements.length - 1) {
        totalContentHeight += GAP;
      }
    }

    // First line should stay visible - restrict downward scroll
    // Keep first line within upper half of container (around 8% from top)
    const firstLineHeight = lineElements[0]!.offsetHeight;
    const minOffset = containerHeight * 0.02 - totalContentHeight + firstLineHeight / 2;
    
    // Restrict upward scroll - keep first line from scrolling too far up
    // Limit to 20% from top so first line stays visible when scrolling down
    const lastLineHeight = lineElements[lineElements.length - 1]!.offsetHeight;
    const maxOffset = containerHeight * 0.2 - lastLineHeight / 2;

    return { min: minOffset, max: maxOffset };
  }, [effectiveLyricLineSpacing]);

  // Handle wheel scroll - manual scrolling with momentum
  // Using native event listener with passive: false to allow preventDefault
  const handleWheelRef = useRef<(e: WheelEvent) => void>();
  
  useEffect(() => {
    const lyricsEl = lyricsRef.current;
    if (!lyricsEl) return;

    handleWheelRef.current = (e: WheelEvent) => {
      e.preventDefault();
      setIsUserScrolling(true);

      const bounds = getScrollBounds();

      // Update manual offset based on wheel delta with bounds
      setManualOffsetY(prev => {
        const newValue = prev - e.deltaY;
        // Clamp to bounds relative to auto offset
        const minManual = bounds.min - autoOffsetRef.current;
        const maxManual = bounds.max - autoOffsetRef.current;
        return Math.max(minManual, Math.min(maxManual, newValue));
      });

      // Resume auto-scroll after a short period of inactivity. The manual-scroll
      // state is transient: the user browses, then playback takes over again.
      // (The original cause of "lyrics can't scroll" was the wheel listener not
      // being bound at all — fixed via the hasLyrics dependency — NOT this timer.)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        setIsUserScrolling(false);
        setManualOffsetY(0);
      }, 3000);
    };

    const handler = (e: WheelEvent) => handleWheelRef.current?.(e);
    lyricsEl.addEventListener('wheel', handler, { passive: false });
    return () => lyricsEl.removeEventListener('wheel', handler);
    // The lyrics container (lyricsRef) mounts only once `hasLyrics` is true —
    // it is fetched asynchronously. This effect MUST re-run when hasLyrics
    // changes (and when the active lyric list changes, since bounds depend on
    // the number of lines), otherwise the wheel listener is bound once against
    // a null ref and never re-attached to the real element. That was the root
    // cause of "Focus Mode 歌词无法手动滚动".
  }, [getScrollBounds, hasLyrics, lyricsLines]);

  // Handle mouse drag start
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartOffsetRef.current = manualOffsetY;
    setIsUserScrolling(true);

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
  };

  // Handle mouse drag move
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const deltaY = e.clientY - dragStartYRef.current;
    const newOffset = dragStartOffsetRef.current + deltaY;
    
    // Apply scroll bounds
    const bounds = getScrollBounds();
    const minManual = bounds.min - autoOffsetRef.current;
    const maxManual = bounds.max - autoOffsetRef.current;
    setManualOffsetY(Math.max(minManual, Math.min(maxManual, newOffset)));
  };

  // Handle mouse drag end
  const handleMouseUp = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    // Resume auto-scroll after a short period of inactivity (same as wheel).
    scrollTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false);
      setManualOffsetY(0);
    }, 3000);
  };

  // Handle mouse leave during drag
  const handleMouseLeave = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      scrollTimeoutRef.current = setTimeout(() => {
        setIsUserScrolling(false);
        setManualOffsetY(0);
      }, 3000);
    }
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
      if (lyricAnimationRef.current !== null) {
        cancelAnimationFrame(lyricAnimationRef.current);
        lyricAnimationRef.current = null;
      }
    };
  }, []);

  // Persist bgBlurTrans to settingsManager when it changes
  useEffect(() => {
    settingsManager.setBgBlurTrans(bgBlurTrans);
  }, [bgBlurTrans]);

  // Register global debug function for background transparency
  useEffect(() => {
    return registerCommand(
      'bg_blur_trans',
      (value: number) => {
        if (typeof value === 'number' && value >= 0 && value <= 1) {
          setBgBlurTrans(value);
        }
      },
      'Set FocusMode background transparency (0~1), e.g. bg_blur_trans(0.92)'
    );
  }, []);

  // Hardware-accelerated lyric positioning using CSS transform with bezier easing.
  // The offset is transient DOM state: keeping it out of React avoids repainting
  // every lyric row during the 500–900ms line transition.
  const applyLyricOffset = useCallback((nextOffset: number) => {
    currentOffsetRef.current = nextOffset;
    if (lyricListRef.current) {
      lyricListRef.current.style.transform = `translateY(${nextOffset}px)`;
    }
  }, []);

  // Recenter the active lyric after its size or spacing changes.
  useEffect(() => {
    preScrolledIndexRef.current = -1;
  }, [effectiveLyricsFontSize, effectiveLyricLineSpacing, track?.id]);
  
  // Start the line transition before its first word begins to fill.
  const PRE_SCROLL_TIME = 0.2;
  
  // Cubic bezier curve: ease-out-cubic with slight overshoot for natural feel
  const bezierEaseOut = (t: number): number => {
    return 1 - Math.pow(1 - t, 3) * (1 - t * 0.3);
  };
  
  // More pronounced curve for long distances - ease-out-expo variant
  const bezierEaseOutLong = (t: number): number => {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  };

  const lyricScrollTargetIndex = useMemo(() => {
    if (activeIndex < 0) return -1;

    // Preserve the previous "first line inside the pre-scroll window" rule,
    // but find it in O(log n) instead of scanning every lyric at 20fps.
    const earliestTime = activeCurrentTime - 0.1;
    const latestTime = activeCurrentTime + PRE_SCROLL_TIME;
    let low = 0;
    let high = lyricsLines.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (lyricsLines[middle]!.time <= earliestTime) low = middle + 1;
      else high = middle;
    }
    if (low < lyricsLines.length && lyricsLines[low]!.time <= latestTime) return low;
    return activeIndex;
  }, [activeCurrentTime, activeIndex, lyricsLines]);
  
  // Calculate auto position with pre-scroll logic.
  useEffect(() => {
    if (!isVisible || lyricScrollTargetIndex < 0 || !lyricListRef.current || isUserScrolling) return;

    // Most 20fps time snapshots stay within the same lyric. Exit before any
    // DOM collection or layout read unless the visual target actually changed.
    if (lyricScrollTargetIndex === preScrolledIndexRef.current) return;
    preScrolledIndexRef.current = lyricScrollTargetIndex;

    const container = lyricsRef.current;
    const lyricList = lyricListRef.current;
    if (!container || !track?.syncedLyrics) return;

    const containerHeight = container.clientHeight;
    const lineElements = Array.from(lyricList.children) as HTMLElement[];

    if (!lineElements[lyricScrollTargetIndex]) return;

    // Calculate cumulative offset to the target line
    const GAP = effectiveLyricLineSpacing;
    let offsetToTarget = 0;
    for (let i = 0; i < lyricScrollTargetIndex; i++) {
      offsetToTarget += lineElements[i]!.offsetHeight + GAP;
    }

    const targetLineHeight = lineElements[lyricScrollTargetIndex]!.offsetHeight;
    const autoOffsetY = containerHeight * 0.1 - offsetToTarget - targetLineHeight / 2;
    
    autoOffsetRef.current = autoOffsetY;

    // Cancel any ongoing animation
    if (lyricAnimationRef.current !== null) {
      cancelAnimationFrame(lyricAnimationRef.current);
      lyricAnimationRef.current = null;
    }

    // Animate with longer, slower duration for more visible motion
    const startY = currentOffsetRef.current;
    const targetY = autoOffsetY;
    const distance = targetY - startY;
    const startTime = performance.now();
    
    // Longer duration: 500ms for short, up to 900ms for long moves
    const absDistance = Math.abs(distance);
    const isLongDistance = absDistance > containerHeight * 0.3;
    const duration = isLongDistance ? 900 : Math.min(500 + absDistance * 0.4, 750);
    
    const easeFn = isLongDistance ? bezierEaseOutLong : bezierEaseOut;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const rawProgress = Math.min(elapsed / duration, 1);
      
      const easedProgress = easeFn(rawProgress);
      const newY = startY + distance * easedProgress;
      
      applyLyricOffset(newY);

      if (rawProgress < 1) {
        lyricAnimationRef.current = requestAnimationFrame(animate);
      } else {
        applyLyricOffset(targetY);
        lyricAnimationRef.current = null;
      }
    };

    lyricAnimationRef.current = requestAnimationFrame(animate);
  }, [isVisible, isUserScrolling, track?.syncedLyrics, lyricScrollTargetIndex, effectiveLyricsFontSize, effectiveLyricLineSpacing, applyLyricOffset]);

  // Manual scroll mode: directly apply offset without auto-position
  useEffect(() => {
    if (!isVisible) return;

    if (isUserScrolling) {
      // Cancel any animation during manual scroll
      if (lyricAnimationRef.current !== null) {
        cancelAnimationFrame(lyricAnimationRef.current);
        lyricAnimationRef.current = null;
      }

      const combinedY = autoOffsetRef.current + manualOffsetY;
      applyLyricOffset(combinedY);
    } else {
      // Auto mode: keep the lyrics pinned to the auto offset. This also handles
      // the transition OUT of manual mode (the 3s resume timer sets
      // isUserScrolling=false). The previous guard `manualOffsetY > 0.5` failed
      // because the timer resets manualOffsetY to 0 in the SAME commit, so the
      // resume animation never ran and lyrics got stuck at the manual position.
      // Now: if the current offset is off from the auto target, ease back to it.
      const targetY = autoOffsetRef.current;
      if (Math.abs(currentOffsetRef.current - targetY) > 0.5) {
        const startY = currentOffsetRef.current;
        const distance = targetY - startY;
        const startTime = performance.now();
        const duration = 600;

        const animateReturn = (currentTime: number) => {
          const elapsed = currentTime - startTime;
          const rawProgress = Math.min(elapsed / duration, 1);
          const easedProgress = bezierEaseOut(rawProgress);

          const newY = startY + distance * easedProgress;
          applyLyricOffset(newY);

          if (rawProgress < 1) {
            lyricAnimationRef.current = requestAnimationFrame(animateReturn);
          } else {
            applyLyricOffset(targetY);
            lyricAnimationRef.current = null;
          }
        };

        if (lyricAnimationRef.current !== null) {
          cancelAnimationFrame(lyricAnimationRef.current);
        }
        lyricAnimationRef.current = requestAnimationFrame(animateReturn);
      }
    }
  }, [manualOffsetY, isUserScrolling, isVisible, applyLyricOffset]);

  // Reset scroll state when track changes
  useEffect(() => {
    prevActiveIndexRef.current = -1;
    preScrolledIndexRef.current = -1;
    lastTimeRef.current = 0;
    realtimeCurrentTimeRef.current = 0;
    setRealtimeCurrentTime(0);
    applyLyricOffset(0);
    setManualOffsetY(0);
    setIsUserScrolling(false);
    autoOffsetRef.current = 0;

    if (lyricAnimationRef.current !== null) {
      cancelAnimationFrame(lyricAnimationRef.current);
      lyricAnimationRef.current = null;
    }
  }, [track?.id, applyLyricOffset]);

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

  // Settings change infrequently, so bake their new values into the small
  // backing bitmap once instead of leaving a live compositor filter attached.
  useEffect(() => {
    bgBlurTransRef.current = bgBlurTrans;
    bgBlurRadiusRef.current = bgBlurRadius;
    renderCanvas();
  }, [bgBlurTrans, bgBlurRadius, renderCanvas]);

  // The canvas backing dimensions only change when the window does. Coalesce a
  // resize burst into one redraw and keep the steady-state backdrop completely
  // idle.
  useEffect(() => {
    let resizeFrame: number | null = null;
    const handleResize = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        renderCanvas();
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    };
  }, [renderCanvas]);

  // Load the active background only while FocusMode is actually visible. The
  // host component unmounts this content after the exit animation, releasing
  // the canvas, decoded images and lyric DOM while ordinary playback continues.
  useEffect(() => {
    if (!isVisible || !track?.id || !track?.coverUrl) return;

    const generation = backgroundLoadGenerationRef.current + 1;
    backgroundLoadGenerationRef.current = generation;
    let cancelled = false;

    // Load new background image
    const img = new Image();
    // Note: Don't set crossOrigin for all images as some servers don't support CORS
    // Only set it for known CORS-enabled sources
    const corsEnabledHosts = ['localhost', '127.0.0.1'];
    try {
      const url = new URL(track.coverUrl);
      if (corsEnabledHosts.some(host => url.hostname.includes(host))) {
        img.crossOrigin = 'anonymous';
      }
    } catch {
      // URL is relative or blob URL, no need to set crossOrigin
    }
    const isCurrentLoad = () => !cancelled && backgroundLoadGenerationRef.current === generation;
    const clearImageHandlers = () => {
      img.onload = null;
      img.onerror = null;
    };

    img.onload = () => {
      // Images kept for drawing must not retain this closure. Otherwise each
      // decoded cover can retain the previous transition through captured state.
      clearImageHandlers();
      if (!isCurrentLoad()) return;

      const previousBackground = incomingBackgroundRef.current || currentBackgroundRef.current;
      if (!previousBackground) {
        currentBackgroundRef.current = img;
        incomingBackgroundRef.current = null;
        transitionProgressRef.current = 1;
        // The original first-load brightness animation was scheduled before its
        // conditional Canvas existed, so the actually observed entrance used
        // the resting brightness and only the page/alpha fades. Keep that visual
        // contract while retaining the new pre-filtered Canvas pipeline.
        backdropBrightnessRef.current = BACKDROP_RESTING_BRIGHTNESS;
        setHasBackground(true);
        renderCanvas();
        return;
      }

      currentBackgroundRef.current = previousBackground;
      incomingBackgroundRef.current = img;
      transitionProgressRef.current = 0;
      backdropBrightnessRef.current = BACKDROP_RESTING_BRIGHTNESS;
      setHasBackground(true);
      renderCanvas();
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        if (!isCurrentLoad()) return;
        const progress = Math.min(
          (currentTime - startTime) / BACKDROP_TRANSITION_DURATION_MS,
          1,
        );
        transitionProgressRef.current = progress;

        // Brightness breathing effect: goes from 0.55 -> 0.3 -> 0.55
        // using the same sine curve and timing as the previous CSS-filter path.
        backdropBrightnessRef.current = BACKDROP_RESTING_BRIGHTNESS
          - (BACKDROP_RESTING_BRIGHTNESS - BACKDROP_DIM_BRIGHTNESS)
            * Math.sin(progress * Math.PI);
        renderCanvas();

        if (progress < 1) {
          animationFrameRef.current = requestAnimationFrame(animate);
        } else {
          currentBackgroundRef.current = img;
          incomingBackgroundRef.current = null;
          transitionProgressRef.current = 1;
          backdropBrightnessRef.current = BACKDROP_RESTING_BRIGHTNESS;
          animationFrameRef.current = null;
          renderCanvas();
        }
      };

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    img.onerror = () => {
      clearImageHandlers();
      if (!isCurrentLoad()) return;
      // If load fails, don't change background - keep previous one
      logger.warn('[FocusMode] Failed to load cover image for transition');
      incomingBackgroundRef.current = null;
      transitionProgressRef.current = 1;
      backdropBrightnessRef.current = BACKDROP_RESTING_BRIGHTNESS;
      renderCanvas();
    };

    // 背景经 40–80px 的重度模糊，分辨率不可见，用 256px 缩略图即可，大幅减小 GPU 纹理。
    img.src = toCoverThumb(track.coverUrl, 256)!;

    return () => {
      cancelled = true;
      if (backgroundLoadGenerationRef.current === generation) {
        backgroundLoadGenerationRef.current += 1;
      }
      clearImageHandlers();
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      // Abort a pending remote image request. Do not clear a successfully loaded
      // image because it may still be the currently painted transition source.
      if (!img.complete) img.src = '';
    };
  }, [isVisible, track?.id, track?.coverUrl, renderCanvas]);

  useLayoutEffect(() => () => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    const sourceScratch = backdropSourceScratchRef.current;
    if (sourceScratch) {
      sourceScratch.width = 0;
      sourceScratch.height = 0;
    }
    const filteredScratch = backdropFilteredScratchRef.current;
    if (filteredScratch) {
      filteredScratch.width = 0;
      filteredScratch.height = 0;
    }
    const frameScratch = backdropFrameScratchRef.current;
    if (frameScratch) {
      frameScratch.width = 0;
      frameScratch.height = 0;
    }
    backdropSourceScratchRef.current = null;
    backdropFilteredScratchRef.current = null;
    backdropFrameScratchRef.current = null;
    preparedBackdropCacheRef.current = new WeakMap();
    currentBackgroundRef.current = null;
    incomingBackgroundRef.current = null;
  }, []);

  // The canvas is conditionally mounted after the first image arrives. Paint the
  // current refs once that DOM node exists; subsequent frames draw directly.
  useLayoutEffect(() => {
    if (hasBackground) renderCanvas();
  }, [hasBackground, renderCanvas]);

  // Handle click on synced lyric line to seek
  const handleLyricClick = useCallback((lyricTime: number, idx: number) => {
    if (lyricTime > 0 && onSeek) {
      onSeek(lyricTime);
      // 点击歌词跳转是明确的播放意图：暂停状态下跳转后自动继续播放
      if (!isPlaying && onTogglePlay) onTogglePlay();
    }
    // Clicking the currently-active line exits manual follow mode and resumes
    // auto-scrolling. This is the explicit "I'm done browsing" gesture, in
    // place of the old automatic 3-second snap-back.
    if (isUserScrolling && idx === activeIndex) {
      setIsUserScrolling(false);
      setManualOffsetY(0);
    }
  }, [activeIndex, isUserScrolling, onSeek, isPlaying, onTogglePlay]);

  return (
    <div className={`focus-mode-overlay fixed inset-0 z-[120] transition-transform duration-600 ease-in-out overflow-hidden ${isVisible ? 'translate-y-0' : 'translate-y-full pointer-events-none'}${isLinux ? ' rounded-lg' : ''}`}>
      <FocusBackdrop
        hasBackground={hasBackground}
        isLinux={isLinux}
        canvasRef={canvasRef}
      />

      <div className={`focus-mode-content relative h-full flex flex-col z-10 overflow-hidden transition-opacity duration-600 ease-in-out ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
        {/* Spacer to avoid content behind titlebar */}
        <div className="shrink-0 pt-12" style={hasScaledLayout ? { paddingTop: `${48 * focusScale}px` } : undefined} />

        {/* Content Section */}
        <main
          className="flex-1 flex items-center justify-center overflow-visible mb-24 mx-auto w-full flex-col lg:flex-row pl-0 pr-4 lg:pl-0 lg:pr-8 gap-20 lg:gap-32 max-w-5xl translate-x-6 lg:translate-x-6"
          style={hasScaledLayout ? {
            marginBottom: `${96 * focusScale}px`,
            maxWidth: `${1024 * focusScale}px`,
            paddingRight: `${32 * focusScale}px`,
            gap: `${128 * focusScale}px`,
            transform: `translateX(${24 * focusScale}px)`,
          } : undefined}
        >

          {/* Cover & Title */}
          <div
            className="flex-none flex flex-col items-center justify-center w-auto p-6"
            style={hasScaledLayout ? { padding: `${24 * focusScale}px` } : undefined}
          >
            <FocusCoverStage coverUrl={track?.coverUrl} isPlaying={isPlaying} scale={focusScale} />
            <FocusTrackMeta
              track={track}
              textPrimary={focusColors.textPrimary}
              textMuted={focusColors.textMuted}
              scale={focusScale}
            />
          </div>

          {/* Lyrics */}
          {hasLyrics && (
            <div
              className="flex-1 h-full max-h-[50vh] lg:max-h-[60vh] overflow-hidden mask-fade relative px-8 select-none"
              ref={lyricsRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              style={{
                cursor: isDraggingRef.current ? 'grabbing' : 'grab',
                ...(hasScaledLayout ? {
                  paddingLeft: `${32 * focusScale}px`,
                  paddingRight: `${32 * focusScale}px`,
                } : {}),
              }}
            >
              <div
                ref={lyricListRef}
                className="flex flex-col py-36 px-8 will-change-transform"
                style={{
                  transform: 'translateY(0px)',
                  gap: `${effectiveLyricLineSpacing}px`,
                  ...(hasScaledLayout ? {
                    paddingTop: `${144 * focusScale}px`,
                    paddingBottom: `${144 * focusScale}px`,
                    paddingLeft: `${32 * focusScale}px`,
                    paddingRight: `${32 * focusScale}px`,
                  } : {}),
                }}
              >
                {lyricsLines.map((lyric, idx) => {
                  const isActive = idx === activeIndex;
                  const hasTimestamp = track?.syncedLyrics && lyric.time > 0;
                  return (
                    <FocusLyricRow
                      key={idx}
                      lyric={lyric}
                      index={idx}
                      isActive={isActive}
                      hasTimestamp={Boolean(hasTimestamp)}
                      shouldAnimate={isActive && isVisible && isPlaying}
                      currentTimeRef={realtimeCurrentTimeRef}
                      pausedTime={!isPlaying && isActive ? activeCurrentTime : undefined}
                      fontSize={effectiveLyricsFontSize}
                      inactiveBlur={inactiveLyricBlur}
                      textPrimary={focusColors.textPrimary}
                      textSecondary={focusColors.textSecondary}
                      textMuted={focusColors.textMuted}
                      onSeek={handleLyricClick}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </main>

        <div>
          <FocusControls
            track={track}
            colors={colors}
            isPlaying={isPlaying}
            isPlayerVisible={isPlayerVisible}
            activeCurrentTime={activeCurrentTime}
            progress={progress}
            volume={volume}
            playbackMode={playbackMode}
            playerRef={playerRef}
            onSeek={onSeek}
            onTogglePlay={onTogglePlay}
            onSkipNext={onSkipNext}
            onSkipPrev={onSkipPrev}
            onVolumeChange={onVolumeChange}
            onToggleMute={onToggleMute}
            onTogglePlaybackMode={onTogglePlaybackMode}
            onMouseEnter={handlePlayerMouseEnter}
            onMouseLeave={handlePlayerMouseLeave}
            glassMaterial={useDefaultThemeControlGlass}
            scale={focusScale}
          />
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
  if (prevProps.onTogglePlay !== nextProps.onTogglePlay) return false;
  if (prevProps.onSkipNext !== nextProps.onSkipNext) return false;
  if (prevProps.onSkipPrev !== nextProps.onSkipPrev) return false;
  if (prevProps.onSeek !== nextProps.onSeek) return false;
  if (prevProps.onVolumeChange !== nextProps.onVolumeChange) return false;
  if (prevProps.onToggleMute !== nextProps.onToggleMute) return false;
  if (prevProps.playbackMode !== nextProps.playbackMode) return false;
  if (prevProps.onTogglePlaybackMode !== nextProps.onTogglePlaybackMode) return false;
  if (prevProps.onToggleFocus !== nextProps.onToggleFocus) return false;
  // Keep the prop threshold aligned with the layout-effect drift correction;
  // otherwise a 0.25–0.5s restoration drift could be filtered before paint.
  if (!nextProps.isPlaying && prevProps.currentTime !== nextProps.currentTime) return false;
  const timeDiff = Math.abs(prevProps.currentTime - nextProps.currentTime);
  if (timeDiff >= CLOCK_RESYNC_THRESHOLD_SECONDS) return false;

  // All props are effectively the same, skip re-render
  return true;
});

FocusModeContent.displayName = 'FocusModeContent';

const FOCUS_MODE_EXIT_DURATION_MS = 700;

/**
 * Keep the content mounted just long enough for its exit transition, then
 * unmount the heavy full-screen layers completely. Playback lives outside this
 * component, so releasing FocusMode has no effect on background audio.
 */
const FocusMode: React.FC<FocusModeProps> = (props) => {
  const [shouldMountContent, setShouldMountContent] = useState(props.isVisible);
  const [isPresented, setIsPresented] = useState(false);

  useLayoutEffect(() => {
    if (props.isVisible) {
      setShouldMountContent(true);
      let presentFrame = 0;
      const mountFrame = window.requestAnimationFrame(() => {
        presentFrame = window.requestAnimationFrame(() => {
          setIsPresented(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(mountFrame);
        if (presentFrame) window.cancelAnimationFrame(presentFrame);
      };
    }

    setIsPresented(false);
    if (!shouldMountContent) {
      return;
    }

    const timer = window.setTimeout(() => {
      setShouldMountContent(false);
    }, FOCUS_MODE_EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [props.isVisible, shouldMountContent]);

  return shouldMountContent
    ? <FocusModeContent {...props} isVisible={isPresented} />
    : null;
};

FocusMode.displayName = 'FocusMode';

export default memo(FocusMode);
