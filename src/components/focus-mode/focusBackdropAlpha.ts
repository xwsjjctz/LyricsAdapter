export const BACKDROP_ALPHA_TRANSITION_DURATION_MS = 1000;
export const BACKDROP_ALPHA_EXIT_DURATION_MS = 600;
export const BACKDROP_ALPHA_EDGE_OPACITY = 0.3;

// Warping linear time before smoothstep delays most of the reveal until after
// the 600ms page slide. At phase 0.6 the resulting Canvas factor is ~0.4, which
// maps the visible backdrop from its 30% edge alpha to approximately 58%.
const BACKDROP_ALPHA_TIME_EXPONENT = 1.65;
const BACKDROP_ALPHA_EXIT_POWER = 2.4;
const INVERSE_ITERATIONS = 24;

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

export function backdropAlphaFactorAtPhase(phase: number): number {
  const warpedPhase = Math.pow(clampUnit(phase), BACKDROP_ALPHA_TIME_EXPONENT);
  return warpedPhase * warpedPhase * (3 - 2 * warpedPhase);
}

/** Invert the monotonic reveal curve so an interrupted animation can reverse exactly. */
export function backdropAlphaPhaseFromFactor(factor: number): number {
  const target = clampUnit(factor);
  if (target === 0 || target === 1) return target;

  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < INVERSE_ITERATIONS; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (backdropAlphaFactorAtPhase(midpoint) < target) lower = midpoint;
    else upper = midpoint;
  }
  return (lower + upper) / 2;
}

/** Exit drops immediately, then eases into the 30% edge opacity. */
export function backdropAlphaFactorAtExitProgress(progress: number): number {
  return Math.pow(1 - clampUnit(progress), BACKDROP_ALPHA_EXIT_POWER);
}

/** Invert the exit curve so direction changes continue from the current alpha. */
export function backdropAlphaExitProgressFromFactor(factor: number): number {
  return 1 - Math.pow(clampUnit(factor), 1 / BACKDROP_ALPHA_EXIT_POWER);
}

// Track changes keep a subtle opacity pulse, but the original legacy curve
// (Aout = A * (1 - A * p * (1 - p))) dropped to 0.75 at the midpoint, letting
// the library view show through enough to wash out the cover colour cross-fade.
// Half the dip keeps the pulse while leaving the colours readable.
export const BACKDROP_TRACK_CHANGE_DIP = 0.5;

/**
 * Uniform final-pass alpha for the cover cross-fade. `alpha` is the resting
 * backdrop alpha and `progress` is the 0..1 cross-fade position.
 */
export function backdropTrackChangeAlpha(alpha: number, progress: number): number {
  const p = clampUnit(progress);
  return alpha * (1 - BACKDROP_TRACK_CHANGE_DIP * alpha * p * (1 - p));
}

/**
 * Brightness breathing during a cover cross-fade. Starts from
 * `startBrightness` so an interrupted fade continues from what is on screen
 * instead of jumping back to the resting value, dips at the midpoint, and
 * settles on `restingBrightness`.
 */
export function backdropTrackChangeBrightness(
  startBrightness: number,
  restingBrightness: number,
  dimBrightness: number,
  progress: number,
): number {
  const p = clampUnit(progress);
  const base = startBrightness + (restingBrightness - startBrightness) * p;
  return base - (base - dimBrightness) * Math.sin(p * Math.PI);
}
