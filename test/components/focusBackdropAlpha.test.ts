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
  it('keeps the page slide at the delayed 30% to 58% portion of a one-second reveal', () => {
    expect(BACKDROP_ALPHA_TRANSITION_DURATION_MS).toBe(1000);
    expect(BACKDROP_ALPHA_EDGE_OPACITY).toBe(0.3);
    expect(backdropAlphaFactorAtPhase(0)).toBe(0);
    expect(backdropAlphaFactorAtPhase(1)).toBe(1);

    const visibleAlphaAtPageSettle = BACKDROP_ALPHA_EDGE_OPACITY
      + (1 - BACKDROP_ALPHA_EDGE_OPACITY) * backdropAlphaFactorAtPhase(0.6);
    expect(visibleAlphaAtPageSettle).toBeCloseTo(0.58, 2);
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
    expect(visibleAlphaAt(0.25)).toBeCloseTo(0.65, 2);
    expect(visibleAlphaAt(0.5)).toBeCloseTo(0.43, 2);
    expect(visibleAlphaAt(0.75)).toBeCloseTo(0.33, 2);
  });

  it('inverts the exit curve for interruption-safe direction changes', () => {
    for (const progress of [0.1, 0.25, 0.5, 0.85]) {
      const factor = backdropAlphaFactorAtExitProgress(progress);
      expect(backdropAlphaExitProgressFromFactor(factor)).toBeCloseTo(progress, 6);
    }
  });
});
