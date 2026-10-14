import React, { useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { realCoverUrl, toCoverThumb } from '../../services/coverUrl';
import { getCoverPalette, type CoverPalette } from '../../services/coverPalette';
import { retainAudioPulse, sampleAudioPulse } from '../../services/audioPulse';
import { INITIAL_PULSE_STATE, stepPulse, stepSpring, type PulseState, type Spring } from './nowPlayingPulse';

interface NowPlayingGlowProps {
  coverUrl?: string | undefined;
  width: number;
  height: number;
  /** Playing and on screen: the glow moves with the music; otherwise it settles to rest. */
  animated: boolean;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const PALETTE_THUMB_SIZE = 128;
/** Longer frames (a stalled tab) are clamped so springs never explode. */
const MAX_FRAME_SECONDS = 1 / 30;

/* Rotation of the colour field, in degrees per second. */
const BASE_SPEED = 14;
const LEVEL_SPEED = 34;
const BEAT_SPEED = 110;
const SPEED_TAU = 0.6;
/** The ring's highlight runs ahead of the colour field, faster with treble. */
const COMET_SPEED_RATIO = 2.2;
const COMET_SHIMMER_SPEED = 70;

/* Resting looks, matching the CSS defaults used under reduced motion. */
const HALO_REST = 0.42;
const COMET_REST = 0.22;
/** Without readable audio (e.g. a WebDAV CDN), the glow breathes on its own. */
const BREATH_SECONDS = 3.4;
const SIGNAL_TAU = 0.8;

/** How far the shockwave travels past the tile edge, in pixels. */
const WAVE_SPREAD = 28;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const follow = (current: number, target: number, tau: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-dt / tau));

function useCoverPalette(coverUrl: string | undefined): CoverPalette | null {
  const url = useMemo(() => toCoverThumb(realCoverUrl(coverUrl), PALETTE_THUMB_SIZE), [coverUrl]);
  const [palette, setPalette] = useState<CoverPalette | null>(null);
  useEffect(() => {
    if (!url) {
      setPalette(null);
      return;
    }
    let cancelled = false;
    void getCoverPalette(url).then(colors => {
      if (!cancelled) setPalette(colors);
    });
    return () => { cancelled = true; };
  }, [url]);
  return palette;
}

interface Motion {
  pulse: PulseState;
  spring: Spring;
  speed: number;
  angle: number;
  cometAngle: number;
  signal: number;
  clock: number;
}

const INITIAL_MOTION: Motion = {
  pulse: INITIAL_PULSE_STATE,
  spring: { value: 0, velocity: 0 },
  speed: 0,
  angle: 0,
  cometAngle: 0,
  signal: 0,
  clock: 0,
};

/**
 * Light around the playing poster: a cover-coloured ring, a blurred halo that
 * spills onto neighbouring covers, a highlight sweeping the ring, and a
 * shockwave on strong beats. Only opacity and transform change per frame;
 * the blurred layers are composited, never re-laid out.
 */
const NowPlayingGlow: React.FC<NowPlayingGlowProps> = ({ coverUrl, width, height, animated }) => {
  const palette = useCoverPalette(coverUrl);
  const haloRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const cometRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const spinRefs = useRef<HTMLDivElement[]>([]);
  const motionRef = useRef<Motion>(INITIAL_MOTION);
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  useEffect(() => {
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return;
    const halo = haloRef.current;
    const flash = flashRef.current;
    const comet = cometRef.current;
    const wave = waveRef.current;
    if (!halo || !flash || !comet || !wave) return;

    const releasePulse = animated ? retainAudioPulse() : undefined;
    const fireWave = () => {
      const size = sizeRef.current;
      gsap.fromTo(wave, { opacity: 0.9, scaleX: 1, scaleY: 1 }, {
        opacity: 0,
        scaleX: 1 + (2 * WAVE_SPREAD) / Math.max(size.width, 1),
        scaleY: 1 + (2 * WAVE_SPREAD) / Math.max(size.height, 1),
        duration: 0.85,
        ease: 'power2.out',
        overwrite: true,
      });
    };

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = clamp((now - last) / 1000, 0, MAX_FRAME_SECONDS);
      last = now;
      const previous = motionRef.current;
      const bands = animated ? sampleAudioPulse() : null;
      const { state: pulse, onset } = stepPulse(previous.pulse, bands, dt);
      const spring = stepSpring(previous.spring, pulse.beat, dt);
      const signal = follow(previous.signal, bands ? 1 : 0, SIGNAL_TAU, dt);
      const clock = previous.clock + dt;
      const breath = animated ? (1 - signal) * (0.5 - 0.5 * Math.cos((2 * Math.PI * clock) / BREATH_SECONDS)) : 0;
      const targetSpeed = animated ? BASE_SPEED + LEVEL_SPEED * pulse.level + BEAT_SPEED * pulse.beat : 0;
      const speed = follow(previous.speed, targetSpeed, SPEED_TAU, dt);
      const angle = (previous.angle + speed * dt) % 360;
      const cometSpeed = speed * COMET_SPEED_RATIO + (animated ? COMET_SHIMMER_SPEED * pulse.shimmer : 0);
      const cometAngle = (previous.cometAngle + cometSpeed * dt) % 360;
      motionRef.current = { pulse, spring, speed, angle, cometAngle, signal, clock };

      const kick = clamp(spring.value, 0, 1.2);
      halo.style.opacity = String(clamp(HALO_REST + 0.26 * pulse.level + 0.34 * kick + 0.22 * breath, 0, 1));
      halo.style.scale = String(1 + 0.04 * kick + 0.015 * breath);
      flash.style.opacity = String(clamp(0.75 * kick, 0, 1));
      comet.style.opacity = String(clamp(COMET_REST + 0.7 * pulse.shimmer + 0.25 * breath, 0, 1));
      for (const spin of spinRefs.current) spin.style.rotate = `${angle}deg`;
      comet.style.rotate = `${cometAngle}deg`;
      if (onset) fireWave();

      // Once paused and settled, stop drawing until playback resumes.
      const settled = !animated && speed < 0.2 && kick < 0.005 && Math.abs(spring.velocity) < 0.01
        && pulse.level < 0.01 && pulse.shimmer < 0.01;
      if (!settled) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      releasePulse?.();
    };
  }, [animated]);

  useEffect(() => {
    const wave = waveRef.current;
    return () => {
      if (wave) gsap.killTweensOf(wave);
    };
  }, []);

  const setSpin = (index: number) => (node: HTMLDivElement | null) => {
    if (node) spinRefs.current[index] = node;
  };

  // The rotating square must cover the tile's diagonal at every angle.
  const style = {
    '--glow-diagonal': `${Math.ceil(Math.hypot(width, height)) + 2 * WAVE_SPREAD}px`,
    ...(palette ? Object.fromEntries(palette.map((color, i) => [`--glow-c${i + 1}`, color])) : {}),
  } as React.CSSProperties;

  return (
    <div className="wall-glow" style={style} aria-hidden="true">
      <div ref={haloRef} className="wall-glow__halo">
        <div className="wall-glow__frame">
          <div ref={setSpin(0)} className="wall-glow__spin" />
        </div>
      </div>
      <div ref={waveRef} className="wall-glow__wave" />
      <div className="wall-glow__ring">
        <div ref={setSpin(1)} className="wall-glow__spin" />
        <div ref={cometRef} className="wall-glow__spin wall-glow__comet" />
      </div>
      <div ref={flashRef} className="wall-glow__flash" />
    </div>
  );
};

export default NowPlayingGlow;
