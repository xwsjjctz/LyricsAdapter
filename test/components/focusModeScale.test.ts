import { describe, expect, it } from 'vitest';
import {
  calculateFocusModeScale,
  FOCUS_MODE_MAX_SCALE,
} from '@/components/focus-mode/focusModeScale';

describe('calculateFocusModeScale', () => {
  it('preserves the existing layout at and below the default window size', () => {
    expect(calculateFocusModeScale(1200, 800)).toBe(1);
    expect(calculateFocusModeScale(1080, 720)).toBe(1);
  });

  it('scales proportionally using the limiting viewport dimension', () => {
    expect(calculateFocusModeScale(1440, 900)).toBe(1.125);
    expect(calculateFocusModeScale(1800, 900)).toBe(1.125);
  });

  it('caps the enlarged layout and safely handles invalid dimensions', () => {
    expect(calculateFocusModeScale(2560, 1440)).toBe(FOCUS_MODE_MAX_SCALE);
    expect(calculateFocusModeScale(0, 800)).toBe(1);
  });
});
