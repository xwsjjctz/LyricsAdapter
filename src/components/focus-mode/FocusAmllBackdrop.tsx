import React, { useEffect, useRef } from 'react';
import { BackgroundRender, MeshGradientRenderer } from '@applemusic-like-lyrics/core';
import { DEFAULT_COVER_ARTWORK_URL, toCoverThumb } from '../../services/coverUrl';
import { logger } from '../../services/logger';
import { retainAudioPulse, sampleAudioPulse } from '../../services/audioPulse';
import { INITIAL_PULSE_STATE, stepPulse, stepSpring, type PulseState, type Spring } from '../../services/audioPulseEnvelope';

interface FocusAmllBackdropProps {
  /** Resolved cover (the app-icon default when the track has none). */
  coverUrl: string | undefined;
  /** FocusMode is presented; albums load only then. */
  isVisible: boolean;
  isPlaying: boolean;
  /**
   * Constant layer opacity (the background opacity setting). It never fades on
   * enter or exit, which would let the busy poster wall show through.
   */
  opacity: number;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** The mesh gradient is pure colour; half resolution is visually identical. */
const RENDER_SCALE = 0.5;
const RENDER_FPS = 60;
/** The renderer downsamples to 32px; a 256px thumbnail is plenty. */
const ALBUM_THUMB_SIZE = 256;
const MAX_FRAME_SECONDS = 1 / 30;
/*
 * AMLL zooms the mesh texture by up to 20% at volume 1 and uses the value
 * unsmoothed, so feed it a spring-smoothed kick plus a little loudness.
 */
const VOLUME_LEVEL_WEIGHT = 0.18;
const VOLUME_KICK_WEIGHT = 0.5;
const VOLUME_MAX = 0.8;
const VOLUME_REST_EPSILON = 0.002;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A CORS-clean image: WebGL cannot upload tainted pixels. */
function loadCorsImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`album failed to load: ${url}`));
    image.src = url;
  });
}

/**
 * Remote covers whose CDN refuses CORS cannot reach WebGL; they fall back to
 * the app-icon default, which is same-origin.
 */
async function loadAlbumImage(coverUrl: string): Promise<HTMLImageElement> {
  try {
    return await loadCorsImage(toCoverThumb(coverUrl, ALBUM_THUMB_SIZE) ?? coverUrl);
  } catch (error) {
    if (coverUrl === DEFAULT_COVER_ARTWORK_URL) throw error;
    logger.warn('[FocusBackdrop] Cover not readable by WebGL, using the default artwork:', error);
    return loadCorsImage(DEFAULT_COVER_ARTWORK_URL);
  }
}

/** AMLL never releases its context; free it so repeated FocusMode visits do not pile up. */
function releaseWebGlContext(canvas: HTMLCanvasElement): void {
  canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext();
}

/**
 * Apple Music–style flowing mesh-gradient backdrop (AMLL's MeshGradientRenderer),
 * zooming gently with the bass while music plays. AMLL cross-fades between
 * albums itself. Paused, it finishes any cross-fade and then stops drawing.
 */
const FocusAmllBackdrop: React.FC<FocusAmllBackdropProps> = ({ coverUrl, isVisible, isPlaying, opacity }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<BackgroundRender<MeshGradientRenderer> | null>(null);
  const albumQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pulseRef = useRef<PulseState>(INITIAL_PULSE_STATE);
  const springRef = useRef<Spring>({ value: 0, velocity: 0 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: BackgroundRender<MeshGradientRenderer>;
    try {
      renderer = BackgroundRender.new(MeshGradientRenderer);
    } catch (error) {
      logger.warn('[FocusBackdrop] WebGL backdrop unavailable:', error);
      return;
    }
    const canvas = renderer.getElement();
    // AMLL puts its canvas at z-index -1; keep it in DOM order with the overlays.
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: 'auto' });
    host.appendChild(canvas);
    renderer.setRenderScale(RENDER_SCALE);
    renderer.setFPS(RENDER_FPS);
    renderer.setStaticMode(true);
    rendererRef.current = renderer;
    return () => {
      rendererRef.current = null;
      renderer.dispose();
      releaseWebGlContext(canvas);
    };
  }, []);

  // Albums apply in order; a newer cover cancels any older one still loading.
  useEffect(() => {
    if (!isVisible || !coverUrl) return;
    let cancelled = false;
    const apply = async () => {
      const image = await loadAlbumImage(coverUrl);
      const renderer = rendererRef.current;
      if (cancelled || !renderer) return;
      await renderer.setAlbum(image);
      hostRef.current?.setAttribute('data-focus-backdrop-cover', coverUrl);
    };
    albumQueueRef.current = albumQueueRef.current
      .then(() => (cancelled ? undefined : apply()))
      .catch(error => logger.warn('[FocusBackdrop] Album update failed:', error));
    return () => { cancelled = true; };
  }, [coverUrl, isVisible]);

  const active = isVisible && isPlaying;
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      renderer.setLowFreqVolume(0);
      renderer.setStaticMode(true);
      return;
    }
    if (active) renderer.setStaticMode(false);
    const releasePulse = active ? retainAudioPulse() : undefined;

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = clamp((now - last) / 1000, 0, MAX_FRAME_SECONDS);
      last = now;
      const pulse = stepPulse(pulseRef.current, active ? sampleAudioPulse() : null, dt).state;
      const spring = stepSpring(springRef.current, pulse.beat, dt);
      pulseRef.current = pulse;
      springRef.current = spring;
      const kick = clamp(spring.value, 0, 1.2);
      const volume = clamp(VOLUME_LEVEL_WEIGHT * pulse.level + VOLUME_KICK_WEIGHT * kick, 0, VOLUME_MAX);
      renderer.setLowFreqVolume(volume);
      // Paused: ease the zoom back to rest, then let the renderer go static.
      if (!active && volume < VOLUME_REST_EPSILON && Math.abs(spring.velocity) < 0.01) {
        renderer.setLowFreqVolume(0);
        renderer.setStaticMode(true);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      releasePulse?.();
    };
  }, [active]);

  // A solid base: AMLL fades the first album in from transparent, and the
  // poster wall must never show through while it does.
  return (
    <div ref={hostRef} data-focus-backdrop className="absolute inset-0 pointer-events-none bg-black" style={{ opacity }} />
  );
};

export default FocusAmllBackdrop;
