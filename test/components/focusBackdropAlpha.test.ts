import { describe, expect, it } from 'vitest';
import {
  BACKDROP_ALPHA_EDGE_OPACITY,
  BACKDROP_ALPHA_EXIT_DURATION_MS,
  BACKDROP_ALPHA_TRANSITION_DURATION_MS,
  backdropAlphaExitProgressFromFactor,
  backdropAlphaFactorAtExitProgress,
  backdropAlphaFactorAtPhase,
  backdropAlphaPhaseFromFactor,
} from '@/components/focus-mode/focusBackdropAlpha';

describe('Focus backdrop alpha timeline', () => {
  it('reaches about 94% as the 600ms page slide settles inside a 700ms reveal from 50%', () => {
    expect(BACKDROP_ALPHA_TRANSITION_DURATION_MS).toBe(700);
    expect(BACKDROP_ALPHA_EDGE_OPACITY).toBe(0.5);
    expect(backdropAlphaFactorAtPhase(0)).toBe(0);
    expect(backdropAlphaFactorAtPhase(1)).toBe(1);

    const visibleAlphaAtPageSettle = BACKDROP_ALPHA_EDGE_OPACITY
      + (1 - BACKDROP_ALPHA_EDGE_OPACITY) * backdropAlphaFactorAtPhase(600 / BACKDROP_ALPHA_TRANSITION_DURATION_MS);
    expect(visibleAlphaAtPageSettle).toBeCloseTo(0.94, 2);
  });

  it('inverts the curve so an interrupted transition can retrace its current phase', () => {
    for (const phase of [0.1, 0.35, 0.6, 0.85]) {
      const factor = backdropAlphaFactorAtPhase(phase);
      expect(backdropAlphaPhaseFromFactor(factor)).toBeCloseTo(phase, 5);
    }
  });

  it('drops immediately on exit and slows near the edge opacity', () => {
    expect(BACKDROP_ALPHA_EXIT_DURATION_MS).toBe(600);
    expect(backdropAlphaFactorAtExitProgress(0)).toBe(1);
    expect(backdropAlphaFactorAtExitProgress(1)).toBe(0);

    const visibleAlphaAt = (progress: number) =>
      BACKDROP_ALPHA_EDGE_OPACITY
      + (1 - BACKDROP_ALPHA_EDGE_OPACITY) * backdropAlphaFactorAtExitProgress(progress);

    expect(visibleAlphaAt(0.01)).toBeLessThan(0.99);
    expect(visibleAlphaAt(0.25)).toBeCloseTo(0.75, 2);
    expect(visibleAlphaAt(0.5)).toBeCloseTo(0.59, 2);
    expect(visibleAlphaAt(0.75)).toBeCloseTo(0.52, 2);
  });

  it('inverts the exit curve for interruption-safe direction changes', () => {
    for (const progress of [0.1, 0.25, 0.5, 0.85]) {
      const factor = backdropAlphaFactorAtExitProgress(progress);
      expect(backdropAlphaExitProgressFromFactor(factor)).toBeCloseTo(progress, 6);
    }
  });
});
