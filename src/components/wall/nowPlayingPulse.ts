/**
 * Turns raw band energies into the signals the now-playing glow draws:
 *
 * - `beat`: bass transients above the song's running average, with a fast
 *   attack and slower release, so a kick snaps in and breathes out.
 * - `level`: slow loudness relative to the loudest passage heard so far, so
 *   a chorus glows fuller than a verse regardless of mastering volume.
 * - `shimmer`: smoothed high-frequency energy for the ring's sweeping light.
 * - `onset`: a strong kick, rate limited, that fires the shockwave.
 *
 * Every time constant is in seconds and applied per frame with `dt`, so the
 * motion is independent of the display refresh rate.
 */
import type { AudioPulseBands } from '../../services/audioPulse';

export interface PulseState {
  readonly beat: number;
  readonly level: number;
  readonly shimmer: number;
  readonly bassMean: number;
  readonly bassPeak: number;
  readonly bassFast: number;
  readonly levelRaw: number;
  readonly levelPeak: number;
  readonly highRaw: number;
  readonly highPeak: number;
  readonly sinceOnset: number;
}

export interface PulseFrame {
  readonly state: PulseState;
  readonly onset: boolean;
}

const BASS_MEAN_TAU = 1.2;
const BASS_PEAK_TAU = 3;
const BASS_FAST_TAU = 0.08;
const BEAT_ATTACK_TAU = 0.02;
const BEAT_RELEASE_TAU = 0.24;
const LEVEL_TAU = 1.5;
const LEVEL_PEAK_TAU = 20;
const HIGH_TAU = 0.15;
const HIGH_PEAK_TAU = 8;
/** Below this spread between peak and mean, bass variation is noise. */
const MIN_BASS_RANGE = 0.04;
const MIN_PEAK = 0.12;
const ONSET_BEAT = 0.62;
const ONSET_RISE = 0.025;
const ONSET_MIN_LEVEL = 0.08;
const ONSET_COOLDOWN = 0.36;
/** Without readable audio, everything relaxes towards rest at this rate. */
const IDLE_TAU = 0.35;

export const INITIAL_PULSE_STATE: PulseState = {
  beat: 0, level: 0, shimmer: 0,
  bassMean: 0, bassPeak: MIN_PEAK, bassFast: 0,
  levelRaw: 0, levelPeak: MIN_PEAK,
  highRaw: 0, highPeak: MIN_PEAK,
  sinceOnset: ONSET_COOLDOWN,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Exponential approach of `current` to `target` with time constant `tau`. */
const follow = (current: number, target: number, tau: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-dt / tau));

/** A running maximum that decays towards `floor` when nothing exceeds it. */
const followPeak = (peak: number, value: number, floor: number, tau: number, dt: number) =>
  Math.max(value, follow(peak, floor, tau, dt), MIN_PEAK);

export function stepPulse(state: PulseState, bands: AudioPulseBands | null, dt: number): PulseFrame {
  if (!bands) {
    return {
      onset: false,
      state: {
        ...state,
        beat: follow(state.beat, 0, IDLE_TAU, dt),
        level: follow(state.level, 0, IDLE_TAU, dt),
        shimmer: follow(state.shimmer, 0, IDLE_TAU, dt),
        sinceOnset: state.sinceOnset + dt,
      },
    };
  }

  const bassMean = follow(state.bassMean, bands.bass, BASS_MEAN_TAU, dt);
  const bassPeak = followPeak(state.bassPeak, bands.bass, bassMean, BASS_PEAK_TAU, dt);
  const beatTarget = clamp01((bands.bass - bassMean) / Math.max(bassPeak - bassMean, MIN_BASS_RANGE));
  const beatTau = beatTarget > state.beat ? BEAT_ATTACK_TAU : BEAT_RELEASE_TAU;
  const beat = follow(state.beat, beatTarget, beatTau, dt);

  const levelRaw = follow(state.levelRaw, bands.overall, LEVEL_TAU, dt);
  const levelPeak = followPeak(state.levelPeak, levelRaw, levelRaw, LEVEL_PEAK_TAU, dt);
  const level = clamp01(levelRaw / levelPeak);

  const highRaw = follow(state.highRaw, bands.high, HIGH_TAU, dt);
  const highPeak = followPeak(state.highPeak, highRaw, highRaw, HIGH_PEAK_TAU, dt);
  const shimmer = clamp01(highRaw / highPeak);

  const rise = bands.bass - state.bassFast;
  const onset = beatTarget > ONSET_BEAT
    && rise > ONSET_RISE
    && levelRaw > ONSET_MIN_LEVEL
    && state.sinceOnset >= ONSET_COOLDOWN;

  return {
    onset,
    state: {
      beat, level, shimmer,
      bassMean, bassPeak,
      bassFast: follow(state.bassFast, bands.bass, BASS_FAST_TAU, dt),
      levelRaw, levelPeak, highRaw, highPeak,
      sinceOnset: onset ? 0 : state.sinceOnset + dt,
    },
  };
}

export interface Spring {
  readonly value: number;
  readonly velocity: number;
}

/**
 * Underdamped spring (damping ratio ≈ 0.47): a beat overshoots slightly and
 * settles, which reads as a physical "kick" rather than a linear flicker.
 */
const SPRING_STIFFNESS = 220;
const SPRING_DAMPING = 14;

export function stepSpring(spring: Spring, target: number, dt: number): Spring {
  const acceleration = SPRING_STIFFNESS * (target - spring.value) - SPRING_DAMPING * spring.velocity;
  const velocity = spring.velocity + acceleration * dt;
  return { value: spring.value + velocity * dt, velocity };
}
