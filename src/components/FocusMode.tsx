import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, memo } from 'react';
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
import { useFocusModeScale } from './focus-mode/focusModeScale';
import FocusLyrics from './focus-mode/FocusLyrics';
import {
  CLOCK_RESYNC_THRESHOLD_SECONDS,
  useFocusPlaybackClock,
} from './focus-mode/useFocusPlaybackClock';

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
const BACKDROP_TRANSITION_EDGE_ALPHA = 0.5;
const BACKDROP_TRANSITION_DURATION_MS = 1000;
const CANVAS_ALPHA_DURATION_MS = 600;
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
  getCurrentPlaybackTime: () => number;
}

const FocusModeContent: React.FC<FocusModeProps> = memo(({
  track, isVisible, currentTime,
  isPlaying, onTogglePlay, onSkipNext, onSkipPrev, onSeek, volume, onVolumeChange, onToggleMute, playbackMode, onTogglePlaybackMode, onToggleFocus: _onToggleFocus, getCurrentPlaybackTime
}) => {
  const isLinux = getDesktopAPI()?.platform === 'linux';

  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());

  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  const playerRef = useRef<HTMLDivElement>(null);
  const [isPlayerVisible, setIsPlayerVisible] = useState(true);
  const playerHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Canvas-based color gradient transition
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasBackground, setHasBackground] = useState(false);
  const [blurUnderlyingView, setBlurUnderlyingView] = useState(true);
  const [blurUnderlyingViewForTrackChange, setBlurUnderlyingViewForTrackChange] = useState(false);
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

  // 0..1 enter/exit factor for the backdrop alpha (0 → alpha 0.5, 1 → bgBlurTrans).
  const canvasOpacityRef = useRef(0);
  const enterExitAnimRef = useRef<number | null>(null);

  // Global background transparency control for debugging
  const [bgBlurTrans, setBgBlurTrans] = useState(() => settingsManager.getBgBlurTrans());
  const [bgBlurRadius, setBgBlurRadius] = useState(() => settingsManager.getFocusBgBlurRadius());
  const [lyricsFontSize, setLyricsFontSize] = useState(() => settingsManager.getFocusLyricsFontSize());
  const [lyricLineSpacing, setLyricLineSpacing] = useState(() => settingsManager.getFocusLyricLineSpacing());
  const [inactiveLyricBlur, setInactiveLyricBlur] = useState(() => settingsManager.getFocusInactiveLyricBlur());
  const [focusAmlLyricsEnabled, setFocusAmlLyricsEnabled] = useState(
    () => settingsManager.getFocusAmlLyricsEnabled(),
  );
  const focusScale = useFocusModeScale();
  // Keep lyric density stable as the window grows. The vh-based lyric viewport
  // gets taller instead, revealing more surrounding lines.
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
      setFocusAmlLyricsEnabled(settingsManager.getFocusAmlLyricsEnabled());
    });
    return unsubscribe;
  }, []);

  // Theme colors
  const colors = currentTheme.colors;
  // FocusMode uses fixed dark colors for immersive experience (except player controls)
  const focusColors = FOCUS_MODE_COLORS;
  const useDefaultThemeControlGlass =
    (currentTheme.id === THEME_IDS.DEFAULT_DARK || currentTheme.id === THEME_IDS.DEFAULT);

  const { activeCurrentTime, realtimeCurrentTimeRef } = useFocusPlaybackClock({
    trackId: track?.id,
    isVisible,
    currentTime,
    isPlaying,
    getCurrentPlaybackTime,
  });

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

    // Effective backdrop alpha: 0.5 at the dim end (factor 0) up to bgBlurTrans
    // at full visibility (factor 1). canvasOpacityRef is animated on enter/exit.
    const alpha = BACKDROP_TRANSITION_EDGE_ALPHA
      + (bgBlurTransRef.current - BACKDROP_TRANSITION_EDGE_ALPHA) * canvasOpacityRef.current;
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

  // Keep the small live backdrop blur below the prepared cover only while the
  // Library View can show through its entrance/exit alpha. Once the cover is
  // opaque, remove that compositor layer completely.
  useLayoutEffect(() => {
    if (!isVisible) {
      setBlurUnderlyingView(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setBlurUnderlyingView(false);
    }, CANVAS_ALPHA_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [isVisible]);

  // Duration of the canvas backdrop alpha fade on enter/exit (matches the
  // Focus Mode slide). Entry: alpha 0.5 → bgBlurTrans; exit: bgBlurTrans → 0.5.

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
      const p = Math.min((now - startTime) / CANVAS_ALPHA_DURATION_MS, 1);
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
    if (!isVisible || !track?.id || !track?.coverUrl) {
      setBlurUnderlyingViewForTrackChange(false);
      return;
    }

    // Activate the Library View blur as soon as a replacement cover starts
    // loading. It will already be in the compositor before the Canvas cross-fade
    // reveals the view underneath.
    if (currentBackgroundRef.current || incomingBackgroundRef.current) {
      setBlurUnderlyingViewForTrackChange(true);
    }

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
          setBlurUnderlyingViewForTrackChange(false);
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
      setBlurUnderlyingViewForTrackChange(false);
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

  const handleLyricSeek = useCallback((lyricTime: number) => {
    onSeek(lyricTime);
    // A lyric click is explicit playback intent, matching the previous Focus Mode behavior.
    if (!isPlaying) onTogglePlay();
  }, [isPlaying, onSeek, onTogglePlay]);

  return (
    <div className={`focus-mode-overlay fixed inset-0 z-[120] transition-transform duration-600 ease-in-out overflow-hidden ${isVisible ? 'translate-y-0' : 'translate-y-full pointer-events-none'}${isLinux ? ' rounded-lg' : ''}`}>
      <FocusBackdrop
        hasBackground={hasBackground}
        isLinux={isLinux}
        blurUnderlyingView={blurUnderlyingView || blurUnderlyingViewForTrackChange}
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
          <FocusLyrics
            track={track}
            currentTime={activeCurrentTime}
            currentTimeRef={realtimeCurrentTimeRef}
            isPlaying={isPlaying}
            isVisible={isVisible}
            useAmlLyrics={focusAmlLyricsEnabled}
            fontSize={lyricsFontSize}
            lineSpacing={lyricLineSpacing}
            inactiveBlur={inactiveLyricBlur}
            textPrimary={focusColors.textPrimary}
            textSecondary={focusColors.textSecondary}
            textMuted={focusColors.textMuted}
            onSeek={handleLyricSeek}
          />
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
  if (prevProps.getCurrentPlaybackTime !== nextProps.getCurrentPlaybackTime) return false;
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
