export const BACKDROP_ALPHA_TRANSITION_DURATION_MS = 700;
export const BACKDROP_ALPHA_EXIT_DURATION_MS = 600;
export const BACKDROP_ALPHA_EDGE_OPACITY = 0.5;

// Warping linear time before smoothstep holds the reveal back early on. When
// the 600ms page slide settles (phase 6/7 of the 700ms reveal) the Canvas
// factor is ~0.87, which maps the backdrop from its 50% edge alpha to ~94%.
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

/** Exit drops immediately, then eases into the 50% edge opacity. */
export function backdropAlphaFactorAtExitProgress(progress: number): number {
  return Math.pow(1 - clampUnit(progress), BACKDROP_ALPHA_EXIT_POWER);
}

/** Invert the exit curve so direction changes continue from the current alpha. */
export function backdropAlphaExitProgressFromFactor(factor: number): number {
  return 1 - Math.pow(clampUnit(factor), 1 / BACKDROP_ALPHA_EXIT_POWER);
}
