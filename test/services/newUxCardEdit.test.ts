import { describe, expect, it } from 'vitest';
import { constrainImageDimensions } from '../../src/services/newUxCardEdit';

describe('constrainImageDimensions', () => {
  it('keeps images that are already display-sized', () => {
    expect(constrainImageDimensions(1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it('preserves aspect ratio while limiting very large backgrounds', () => {
    expect(constrainImageDimensions(7680, 4320)).toEqual({ width: 2048, height: 1152 });
    expect(constrainImageDimensions(4320, 7680)).toEqual({ width: 1152, height: 2048 });
  });
});
