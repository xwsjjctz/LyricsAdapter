import { describe, expect, it } from 'vitest';
import { autoLocateScrollTop, centerLocateScrollTop, isTileVisible, type WallLocateInput } from '@/components/wall/wallLocate';

const view = (tileTop: number, tileHeight: number, scrollTop = 0): WallLocateInput => ({
  tileTop, tileBottom: tileTop + tileHeight, scrollTop,
  viewportHeight: 800, contentHeight: 5000, topInset: 40, bottomInset: 100,
});

describe('wall locate', () => {
  it('leaves a fully visible tile alone after a track switch', () => {
    expect(isTileVisible(view(100, 200))).toBe(true);
    expect(autoLocateScrollTop(view(100, 200), true)).toBeNull();
  });

  it('treats tiles under the title bar or control bar as hidden', () => {
    expect(isTileVisible(view(20, 200))).toBe(false);
    expect(isTileVisible(view(600, 200))).toBe(false);
  });

  it('follows the direction of travel like the list view', () => {
    // Forward: the tile's bottom lands just above the control bar.
    expect(autoLocateScrollTop(view(1200, 200), true)).toBe(1400 - (800 - 100));
    // Backward: its top lands just below the title bar.
    expect(autoLocateScrollTop(view(300, 200, 1000), false)).toBe(300 - 40);
  });

  it('aligns a tile taller than the free band by its top', () => {
    expect(autoLocateScrollTop(view(1200, 900), true)).toBe(1200 - 40);
  });

  it('centres an explicitly located tile and clamps to the scroll range', () => {
    expect(centerLocateScrollTop(view(2000, 200))).toBe(2100 - 40 - 330);
    expect(centerLocateScrollTop(view(0, 200))).toBe(0);
    expect(centerLocateScrollTop(view(4900, 100))).toBe(5000 - 800);
  });
});
