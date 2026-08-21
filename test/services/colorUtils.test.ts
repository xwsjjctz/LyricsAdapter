import { describe, expect, it } from 'vitest';
import { readableForeground } from '@/services/colorUtils';

describe('readableForeground', () => {
  it('uses a dark foreground for light pink and yellow accents', () => {
    expect(readableForeground('#ec8cc5')).toBe('#101116');
    expect(readableForeground('#f5e642')).toBe('#101116');
  });

  it('uses a light foreground for dark accents', () => {
    expect(readableForeground('#183153')).toBe('#ffffff');
  });
});
