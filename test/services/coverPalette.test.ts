import { describe, expect, it } from 'vitest';
import { paletteFromPixels } from '@/services/coverPalette';

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
