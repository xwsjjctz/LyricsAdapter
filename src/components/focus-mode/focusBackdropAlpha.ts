export const BACKDROP_ALPHA_TRANSITION_DURATION_MS = 1000;
export const BACKDROP_ALPHA_EDGE_OPACITY = 0.3;

// Warping linear time before smoothstep delays most of the reveal until after
// the 600ms page slide. At phase 0.6 the resulting Canvas factor is ~0.4, which
// maps the visible backdrop from its 30% edge alpha to approximately 58%.
const BACKDROP_ALPHA_TIME_EXPONENT = 1.65;
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
