import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { logger } from '../../services/logger';
import { toCoverThumb } from '../../services/coverUrl';
import {
  BACKDROP_ALPHA_EDGE_OPACITY,
  BACKDROP_ALPHA_EXIT_DURATION_MS,
  BACKDROP_ALPHA_TRANSITION_DURATION_MS,
  backdropAlphaExitProgressFromFactor,
  backdropAlphaFactorAtExitProgress,
  backdropAlphaFactorAtPhase,
  backdropAlphaPhaseFromFactor,
  backdropTrackChangeAlpha,
  backdropTrackChangeBrightness,
} from './focusBackdropAlpha';
import { drawEdgeExtendedCover, isBackdropSourceReady, type BackdropSource } from './focusCanvasBackdropDraw';

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
// Canvas2D blur samples transparent pixels outside its backing store. Prepare
// an edge-extended source with enough filter padding, then crop the centre, so
// an opaque cover remains opaque at every visible window edge.
const BACKDROP_FILTER_PADDING_MULTIPLIER = 4;
// Long enough to clear the 1000ms entrance/cross-fade before the scratch
// buffers are deallocated, short enough that they are not session-lifetime.
const BACKDROP_SCRATCH_RELEASE_DELAY_MS = 1200;

interface PreparedBackdrop {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  scaledBlurRadius: number;
}

interface FocusCanvasBackdropProps {
  trackId: string | undefined;
  /** Resolved cover (the app-icon default when the track has none). */
  coverUrl: string | undefined;
  isVisible: boolean;
  isLinux: boolean;
  /** Resting backdrop alpha (the background opacity setting). */
  opacity: number;
  blurRadius: number;
}

/**
 * Classic FocusMode backdrop: the cover blurred and saturated on a Canvas2D,
 * fading in over a blurred Library View, with a breathing cross-fade between
 * covers. Steady state is a static bitmap with no per-frame work.
 */
const FocusCanvasBackdrop: React.FC<FocusCanvasBackdropProps> = ({
  trackId, coverUrl, isVisible, isLinux, opacity, blurRadius,
}) => {
  // Canvas-based color gradient transition
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasBackground, setHasBackground] = useState(false);
  const [blurUnderlyingView, setBlurUnderlyingView] = useState(true);
  const [blurUnderlyingViewForTrackChange, setBlurUnderlyingViewForTrackChange] = useState(false);
  const currentBackgroundRef = useRef<BackdropSource | null>(null);
  const incomingBackgroundRef = useRef<BackdropSource | null>(null);
  const currentBackgroundTrackIdRef = useRef<string | null>(null);
  const incomingBackgroundTrackIdRef = useRef<string | null>(null);
  const transitionProgressRef = useRef(1);
  const backdropBrightnessRef = useRef(BACKDROP_RESTING_BRIGHTNESS);
  const animationFrameRef = useRef<number | null>(null);
  const backgroundLoadGenerationRef = useRef(0);
  // Backing size of the visible canvas, so an interrupted cross-fade can be
  // baked at exactly the resolution the compositor is showing.
  const backdropSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const backdropSourceScratchRef = useRef<HTMLCanvasElement | null>(null);
  const backdropFilteredScratchRef = useRef<HTMLCanvasElement | null>(null);
  const backdropFrameScratchRef = useRef<HTMLCanvasElement | null>(null);
  const scratchReleaseTimerRef = useRef<number | null>(null);
  const preparedBackdropCacheRef = useRef<WeakMap<BackdropSource, PreparedBackdrop>>(new WeakMap());

  // 0..1 enter/exit factor for the backdrop alpha (0 → alpha 0.3, 1 → bgBlurTrans).
  const canvasOpacityRef = useRef(0);
  const enterExitAnimRef = useRef<number | null>(null);
  const bgBlurTransRef = useRef(opacity);
  const bgBlurRadiusRef = useRef(blurRadius);

  // The padded scratch buffers used by prepareBackdrop are only needed while a
  // cover is being prepared. Release their backing stores once the entrance /
  // cross-fade animation has settled instead of holding them for the whole
  // FocusMode session (6.4 MiB @1200x800, 14.8 MiB @2560x1440). Deferring the
  // deallocation keeps the release off the animation frames.
  const scheduleScratchRelease = useCallback(() => {
    if (scratchReleaseTimerRef.current !== null) {
      window.clearTimeout(scratchReleaseTimerRef.current);
    }
    scratchReleaseTimerRef.current = window.setTimeout(() => {
      scratchReleaseTimerRef.current = null;
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
    }, BACKDROP_SCRATCH_RELEASE_DELAY_MS);
  }, []);

  const prepareBackdrop = useCallback((
    source: BackdropSource,
    width: number,
    height: number,
  ): HTMLCanvasElement | null => {
    const scaledBlurRadius = bgBlurRadiusRef.current * BACKDROP_RENDER_SCALE;
    const cached = preparedBackdropCacheRef.current.get(source);
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
    drawEdgeExtendedCover(sourceCtx, source, width, height, padding);

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

    preparedBackdropCacheRef.current.set(source, {
      canvas: preparedCanvas,
      width,
      height,
      scaledBlurRadius,
    });
    scheduleScratchRelease();
    return preparedCanvas;
  }, [scheduleScratchRelease]);

  /**
   * Interruption-safe track change: when a cross-fade is already running, bake
   * the currently visible blend of the two prepared covers into a new backdrop
   * source. The next cover then fades in from exactly what is on screen instead
   * of jumping to the incoming cover as if its fade had completed.
   */
  const bakeInterruptedTransition = useCallback((
    width: number,
    height: number,
  ): HTMLCanvasElement | null => {
    const current = currentBackgroundRef.current;
    const incoming = incomingBackgroundRef.current;
    const progress = transitionProgressRef.current;
    if (!current || !incoming || progress <= 0 || progress >= 1 || width <= 0 || height <= 0) {
      return null;
    }

    const preparedCurrent = prepareBackdrop(current, width, height);
    const preparedIncoming = prepareBackdrop(incoming, width, height);
    if (!preparedCurrent || !preparedIncoming) return null;

    const baked = document.createElement('canvas');
    baked.width = width;
    baked.height = height;
    const bakedCtx = baked.getContext('2d');
    if (!bakedCtx) return null;
    bakedCtx.globalAlpha = 1;
    bakedCtx.drawImage(preparedCurrent, 0, 0);
    bakedCtx.globalAlpha = progress;
    bakedCtx.drawImage(preparedIncoming, 0, 0);
    bakedCtx.globalAlpha = 1;

    // The baked pixels are already blurred, so register them as a prepared
    // backdrop: prepareBackdrop will return them untouched (no double blur).
    preparedBackdropCacheRef.current.set(baked, {
      canvas: baked,
      width,
      height,
      scaledBlurRadius: bgBlurRadiusRef.current * BACKDROP_RENDER_SCALE,
    });
    return baked;
  }, [prepareBackdrop]);

  // Render the complete backdrop frame directly. Transition progress and the
  // brightness "breathing" value live in refs so a cover cross-fade does not
  // cause a React commit on every animation frame.
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const currentBackground = currentBackgroundRef.current;
    if (!canvas || !ctx || !isBackdropSourceReady(currentBackground)) return;

    const cssWidth = Math.max(1, window.innerWidth + BACKDROP_OVERSCAN_PX * 2);
    const cssHeight = Math.max(1, window.innerHeight + BACKDROP_OVERSCAN_PX * 2);
    const width = Math.max(1, Math.ceil(cssWidth * BACKDROP_RENDER_SCALE));
    const height = Math.max(1, Math.ceil(cssHeight * BACKDROP_RENDER_SCALE));
    backdropSizeRef.current = { width, height };
    // Assigning width/height clears and reallocates the backing store. During a
    // transition this function runs every frame, so only resize when necessary.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const preparedCurrent = prepareBackdrop(currentBackground, width, height);
    if (!preparedCurrent) return;

    // Effective backdrop alpha: 0.3 at the dim end (factor 0) up to bgBlurTrans
    // at full visibility (factor 1). canvasOpacityRef is animated on enter/exit.
    const alpha = BACKDROP_ALPHA_EDGE_OPACITY
      + (bgBlurTransRef.current - BACKDROP_ALPHA_EDGE_OPACITY) * canvasOpacityRef.current;
    const incomingBackground = incomingBackgroundRef.current;
    // Clamp defensively: a negative progress would make the globalAlpha
    // assignment below a no-op and flash the incoming cover at full opacity.
    const transitionProgress = Math.max(0, Math.min(1, transitionProgressRef.current));
    const preparedIncoming = isBackdropSourceReady(incomingBackground)
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
    // Keep a subtle track-change opacity pulse. The legacy two-draw source-over
    // path produced Aout = A * (1 - A * p * (1 - p)), which dipped to 0.75 at
    // p = 0.5 when A = 1 and let the library view wash out the cover colour
    // cross-fade; backdropTrackChangeAlpha halves that dip.
    const transitionAlpha = preparedIncoming
      ? backdropTrackChangeAlpha(alpha, transitionProgress)
      : alpha;
    ctx.globalAlpha = transitionAlpha;
    ctx.drawImage(frameCanvas, 0, 0);

    ctx.globalAlpha = 1.0;
  }, [prepareBackdrop]);

  /**
   * Drive `transitionProgressRef` from wherever the cross-fade currently is to
   * `targetProgress` (0 = the base cover, 1 = the incoming cover). Used both for
   * a fresh fade and for reversing/continuing an interrupted one, so the pixels
   * never jump. Brightness continues from its live value and settles on resting.
   */
  const animateTransitionTo = useCallback((
    targetProgress: number,
    onComplete: () => void,
  ) => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    const fromProgress = transitionProgressRef.current;
    const distance = Math.abs(targetProgress - fromProgress);
    if (distance < 1e-4) {
      transitionProgressRef.current = targetProgress;
      onComplete();
      return;
    }

    const startBrightness = backdropBrightnessRef.current;
    const duration = Math.max(1, BACKDROP_TRANSITION_DURATION_MS * distance);
    // Anchor the timeline on the first painted frame. Capturing
    // performance.now() here would count any scheduling delay (a busy main
    // thread can push the first rAF out by hundreds of ms) as elapsed time, so
    // the first visible frame would already be part-way through the fade.
    let startTime: number | null = null;
    const animate = (now: number) => {
      if (startTime === null) startTime = now;
      const elapsed = Math.max(0, Math.min((now - startTime) / duration, 1));
      transitionProgressRef.current = fromProgress + (targetProgress - fromProgress) * elapsed;
      backdropBrightnessRef.current = backdropTrackChangeBrightness(
        startBrightness,
        BACKDROP_RESTING_BRIGHTNESS,
        BACKDROP_DIM_BRIGHTNESS,
        elapsed,
      );
      renderCanvas();
      if (elapsed < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
        transitionProgressRef.current = targetProgress;
        backdropBrightnessRef.current = BACKDROP_RESTING_BRIGHTNESS;
        onComplete();
      }
    };
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [renderCanvas]);

  // Keep the small live backdrop blur below the prepared cover only while the
  // Library View can show through its entrance/exit alpha. Once the cover is
  // opaque, remove that compositor layer completely.
  useLayoutEffect(() => {
    if (!isVisible) {
      setBlurUnderlyingView(true);
      return;
    }

    const currentPhase = backdropAlphaPhaseFromFactor(canvasOpacityRef.current);
    const remainingDuration = BACKDROP_ALPHA_TRANSITION_DURATION_MS * (1 - currentPhase);
    if (remainingDuration <= 0) {
      setBlurUnderlyingView(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setBlurUnderlyingView(false);
    }, remainingDuration);
    return () => window.clearTimeout(timer);
  }, [isVisible]);

  // The page slide still lasts 600ms. The backdrop uses a delayed 1000ms reveal:
  // alpha 0.3 → ~0.58 while the page enters, then ~0.58 → bgBlurTrans afterwards.

  // Animate the backdrop alpha on enter/exit. canvasOpacityRef is a 0..1 factor
  // baked into the draw alpha by renderCanvas; we redraw each frame so the fade
  // always repaints. Declared after renderCanvas so it can reference it.
  useEffect(() => {
    if (enterExitAnimRef.current) {
      cancelAnimationFrame(enterExitAnimRef.current);
      enterExitAnimRef.current = null;
    }

    const fromFactor = Math.max(0, Math.min(1, canvasOpacityRef.current));
    const targetFactor = isVisible ? 1 : 0;
    if (fromFactor === targetFactor) {
      renderCanvas();
      return;
    }

    // Entry and exit deliberately use different curves. Both are invertible, so
    // changing direction continues from the current factor without an alpha jump.
    const fromPosition = isVisible
      ? backdropAlphaPhaseFromFactor(fromFactor)
      : backdropAlphaExitProgressFromFactor(fromFactor);
    const duration = (isVisible
      ? BACKDROP_ALPHA_TRANSITION_DURATION_MS
      : BACKDROP_ALPHA_EXIT_DURATION_MS) * (1 - fromPosition);
    const startTime = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const position = fromPosition + (1 - fromPosition) * progress;
      canvasOpacityRef.current = isVisible
        ? backdropAlphaFactorAtPhase(position)
        : backdropAlphaFactorAtExitProgress(position);
      renderCanvas();
      if (progress < 1) {
        enterExitAnimRef.current = requestAnimationFrame(animate);
      } else {
        canvasOpacityRef.current = targetFactor;
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

  // Settings change infrequently, so bake their new values into the small
  // backing bitmap once instead of leaving a live compositor filter attached.
  useEffect(() => {
    bgBlurTransRef.current = opacity;
    bgBlurRadiusRef.current = blurRadius;
    renderCanvas();
  }, [opacity, blurRadius, renderCanvas]);

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
  // Tracks without artwork use the app-icon default cover as their backdrop too.
  useEffect(() => {
    if (!isVisible || !trackId || !coverUrl) {
      setBlurUnderlyingViewForTrackChange(false);
      return;
    }
    const inFlightIncoming = incomingBackgroundRef.current;
    const inFlightIncomingTrackId = incomingBackgroundTrackIdRef.current;

    // Returning to the cover that is still the fade base: reverse the in-flight
    // cross-fade instead of snapping straight back to it.
    if (currentBackgroundRef.current && currentBackgroundTrackIdRef.current === trackId) {
      if (inFlightIncoming) {
        setBlurUnderlyingViewForTrackChange(true);
        animateTransitionTo(0, () => {
          incomingBackgroundRef.current = null;
          incomingBackgroundTrackIdRef.current = null;
          currentBackgroundTrackIdRef.current = trackId;
          transitionProgressRef.current = 1;
          backdropBrightnessRef.current = BACKDROP_RESTING_BRIGHTNESS;
          setHasBackground(true);
          setBlurUnderlyingViewForTrackChange(false);
          renderCanvas();
        });
        return;
      }

      // A quick exit/re-entry keeps this component mounted. Reuse the prepared
      // cover for the same track instead of mistaking visibility reversal for a
      // new track and replaying the 1000ms cover breathing transition.
      transitionProgressRef.current = 1;
      backdropBrightnessRef.current = BACKDROP_RESTING_BRIGHTNESS;
      setBlurUnderlyingViewForTrackChange(false);
      setHasBackground(true);
      renderCanvas();
      return;
    }
    // The requested track is the one already fading in: continue that fade
    // instead of restarting it over the other cover.
    if (inFlightIncoming && inFlightIncomingTrackId === trackId) {
      setBlurUnderlyingViewForTrackChange(true);
      animateTransitionTo(1, () => {
        currentBackgroundRef.current = inFlightIncoming;
        currentBackgroundTrackIdRef.current = trackId;
        incomingBackgroundRef.current = null;
        incomingBackgroundTrackIdRef.current = null;
        transitionProgressRef.current = 1;
        backdropBrightnessRef.current = BACKDROP_RESTING_BRIGHTNESS;
        setHasBackground(true);
        setBlurUnderlyingViewForTrackChange(false);
        renderCanvas();
      });
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
      const url = new URL(coverUrl);
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
        currentBackgroundTrackIdRef.current = trackId;
        incomingBackgroundRef.current = null;
        incomingBackgroundTrackIdRef.current = null;
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

      // If the previous cover is still fading in, bake that on-screen blend so
      // the new fade starts from the current pixels instead of snapping to the
      // incoming cover. Without this, rapid next/previous jumps each restart the
      // 1000ms fade from a hard cut.
      const bakedBlend = bakeInterruptedTransition(
        backdropSizeRef.current.width,
        backdropSizeRef.current.height,
      );
      const previousTrackId = bakedBlend
        ? null
        : (incomingBackgroundRef.current
          ? incomingBackgroundTrackIdRef.current
          : currentBackgroundTrackIdRef.current);
      currentBackgroundRef.current = bakedBlend ?? previousBackground;
      currentBackgroundTrackIdRef.current = previousTrackId;
      incomingBackgroundRef.current = img;
      incomingBackgroundTrackIdRef.current = trackId;
      transitionProgressRef.current = 0;
      setHasBackground(true);
      renderCanvas();

      animateTransitionTo(1, () => {
        currentBackgroundRef.current = img;
        currentBackgroundTrackIdRef.current = trackId;
        incomingBackgroundRef.current = null;
        incomingBackgroundTrackIdRef.current = null;
        renderCanvas();
        setBlurUnderlyingViewForTrackChange(false);
      });
    };

    img.onerror = () => {
      clearImageHandlers();
      if (!isCurrentLoad()) return;
      // If load fails, don't change background - keep previous one
      logger.warn('[FocusMode] Failed to load cover image for transition');
      incomingBackgroundRef.current = null;
      incomingBackgroundTrackIdRef.current = null;
      transitionProgressRef.current = 1;
      backdropBrightnessRef.current = BACKDROP_RESTING_BRIGHTNESS;
      renderCanvas();
      setBlurUnderlyingViewForTrackChange(false);
    };

    // 背景经 40–80px 的重度模糊，分辨率不可见，用 256px 缩略图即可，大幅减小 GPU 纹理。
    img.src = toCoverThumb(coverUrl, 256)!;

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
  }, [isVisible, trackId, coverUrl, renderCanvas]);

  useLayoutEffect(() => () => {
    if (scratchReleaseTimerRef.current !== null) {
      window.clearTimeout(scratchReleaseTimerRef.current);
      scratchReleaseTimerRef.current = null;
    }
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
    currentBackgroundTrackIdRef.current = null;
    incomingBackgroundTrackIdRef.current = null;
  }, []);

  // The canvas is conditionally mounted after the first image arrives. Paint the
  // current refs once that DOM node exists; subsequent frames draw directly.
  useLayoutEffect(() => {
    if (hasBackground) renderCanvas();
  }, [hasBackground, renderCanvas]);

  const blurUnderlying = blurUnderlyingView || blurUnderlyingViewForTrackChange;
  return (
    <>
      {blurUnderlying && (
        <div
          data-focus-library-backdrop-blur
          className={`fixed inset-0 pointer-events-none backdrop-blur-sm${isLinux ? ' rounded-lg overflow-hidden' : ''}`}
        />
      )}
      {hasBackground && (
        <canvas
          ref={canvasRef}
          data-focus-canvas-backdrop
          style={{
            position: 'absolute',
            top: '-100px',
            left: '-100px',
            width: 'calc(100% + 200px)',
            height: 'calc(100% + 200px)',
          }}
        />
      )}
    </>
  );
};

export default FocusCanvasBackdrop;
