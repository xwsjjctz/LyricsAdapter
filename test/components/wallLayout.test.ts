import { describe, expect, it } from 'vitest';
import {
  WALL_BLOCK_COLS,
  WALL_BLOCK_ROWS,
  WALL_TEMPLATES,
  WALL_FEATURED_TEMPLATE,
  computeWallLayout,
  type WallSlot,
} from '@/components/wall/wallLayout';

const cover = (slots: readonly WallSlot[]): number[][] => {
  const grid = Array.from({ length: WALL_BLOCK_ROWS }, () => Array<number>(WALL_BLOCK_COLS).fill(0));
  for (const slot of slots) {
    for (let y = slot.y; y < slot.y + slot.rows; y++) {
      for (let x = slot.x; x < slot.x + slot.cols; x++) grid[y]![x]! += 1;
    }
  }
  return grid;
};

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('wall templates', () => {
  it.each([...WALL_TEMPLATES, WALL_FEATURED_TEMPLATE].map((template, index) => [index, template] as const))(
    'template %i covers its block exactly once',
    (_index, template) => {
      expect(cover(template).flat().every(count => count === 1)).toBe(true);
    },
  );

  it('reserves a 6x6 slot first in the featured template', () => {
    expect(WALL_FEATURED_TEMPLATE[0]).toEqual({ x: 0, y: 0, cols: 6, rows: 6 });
  });
});

describe('computeWallLayout', () => {
  const metrics = { width: 1200, gap: 8 };

  it('places every track once without overlap', () => {
    const layout = computeWallLayout({ count: 57, featuredIndex: -1, ...metrics });
    expect(layout.tiles.map(tile => tile.index).sort((a, b) => a - b)).toEqual(Array.from({ length: 57 }, (_, i) => i));
    for (let i = 0; i < layout.tiles.length; i++) {
      for (let j = i + 1; j < layout.tiles.length; j++) {
        expect(overlaps(layout.tiles[i]!, layout.tiles[j]!)).toBe(false);
      }
    }
    const bottom = Math.max(...layout.tiles.map(tile => tile.y + tile.height));
    expect(layout.height).toBeCloseTo(bottom, 5);
  });

  it('keeps tiles inside the measured width', () => {
    const layout = computeWallLayout({ count: 30, featuredIndex: 4, ...metrics });
    for (const tile of layout.tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.width).toBeLessThanOrEqual(metrics.width + 0.001);
    }
  });

  it('puts the featured track first at 6x6 and keeps the others in order', () => {
    const layout = computeWallLayout({ count: 20, featuredIndex: 7, ...metrics });
    const [first, ...rest] = layout.tiles;
    expect(first).toMatchObject({ index: 7, x: 0, y: 0, featured: true });
    const cell = (metrics.width - 11 * metrics.gap) / 12;
    expect(first!.width).toBeCloseTo(cell * 6 + metrics.gap * 5, 5);
    expect(rest.map(tile => tile.index)).toEqual([0, 1, 2, 3, 4, 5, 6, ...Array.from({ length: 12 }, (_, i) => i + 8)]);
    expect(rest.every(tile => !tile.featured)).toBe(true);
  });

  it('lays a short tail out as a regular grid instead of leaving template holes', () => {
    const layout = computeWallLayout({ count: 3, featuredIndex: -1, ...metrics });
    expect(new Set(layout.tiles.map(tile => tile.width)).size).toBe(1);
    expect(layout.tiles.every(tile => tile.y === 0)).toBe(true);
  });

  it('returns an empty layout for no tracks or no width', () => {
    expect(computeWallLayout({ count: 0, featuredIndex: -1, ...metrics })).toEqual({ tiles: [], height: 0 });
    expect(computeWallLayout({ count: 5, featuredIndex: -1, width: 0, gap: 8 })).toEqual({ tiles: [], height: 0 });
  });
});
