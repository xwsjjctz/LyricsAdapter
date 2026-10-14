import { describe, expect, it } from 'vitest';
import { INITIAL_PULSE_STATE, stepPulse, stepSpring, type PulseState } from '@/components/wall/nowPlayingPulse';
import { paletteFromPixels } from '@/services/coverPalette';

const FRAME = 1 / 60;

function run(state: PulseState, bands: { bass: number; high: number; overall: number }, seconds: number): PulseState {
  let next = state;
  for (let t = 0; t < seconds; t += FRAME) next = stepPulse(next, bands, FRAME).state;
  return next;
}

describe('stepPulse', () => {
  it('stays calm on steady bass and fires one onset on a kick', () => {
    const steady = run(INITIAL_PULSE_STATE, { bass: 0.3, high: 0.2, overall: 0.4 }, 8);
    expect(steady.beat).toBeLessThan(0.1);

    const kick = stepPulse(steady, { bass: 0.9, high: 0.2, overall: 0.4 }, FRAME);
    expect(kick.onset).toBe(true);
    expect(kick.state.beat).toBeGreaterThan(0.4);

    // A second kick inside the cooldown does not fire another shockwave.
    const again = stepPulse(kick.state, { bass: 0.95, high: 0.2, overall: 0.4 }, FRAME);
    expect(again.onset).toBe(false);
  });

  it('relaxes to rest when no audio can be read', () => {
    const loud = run(INITIAL_PULSE_STATE, { bass: 0.6, high: 0.5, overall: 0.5 }, 2);
    let state = loud;
    for (let t = 0; t < 3; t += FRAME) state = stepPulse(state, null, FRAME).state;
    expect(state.level).toBeLessThan(0.01);
    expect(state.shimmer).toBeLessThan(0.01);
  });
});

describe('stepSpring', () => {
  it('overshoots its target slightly and settles on it', () => {
    let spring = { value: 0, velocity: 0 };
    let peak = 0;
    for (let t = 0; t < 2; t += FRAME) {
      spring = stepSpring(spring, 1, FRAME);
      peak = Math.max(peak, spring.value);
    }
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.4);
    expect(spring.value).toBeCloseTo(1, 2);
  });
});

describe('paletteFromPixels', () => {
  const pixels = (rgb: [number, number, number], count = 16) =>
    new Uint8ClampedArray(Array.from({ length: count }, () => [...rgb, 255]).flat());

  it('lifts a single cover hue into a four-colour glow', () => {
    const palette = paletteFromPixels(pixels([200, 20, 20]));
    expect(palette).toHaveLength(4);
    expect(palette?.[0]).toBe('hsl(0 88% 64%)');
  });

  it('returns null for a greyscale cover so the theme accent is used', () => {
    expect(paletteFromPixels(pixels([128, 128, 128]))).toBeNull();
  });
});
