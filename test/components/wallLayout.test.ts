import { describe, expect, it } from 'vitest';
import {
  WALL_BLOCK_COLS,
  WALL_BLOCK_ROWS,
  WALL_TEMPLATES,
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
  it.each(WALL_TEMPLATES.map((template, index) => [index, template] as const))(
    'template %i covers its block exactly once',
    (_index, template) => {
      expect(cover(template).flat().every(count => count === 1)).toBe(true);
    },
  );
});

describe('computeWallLayout', () => {
  const metrics = { width: 1200, gap: 8 };

  it('places every track once without overlap', () => {
    const layout = computeWallLayout({ count: 57, ...metrics });
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
    const layout = computeWallLayout({ count: 30, ...metrics });
    for (const tile of layout.tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.width).toBeLessThanOrEqual(metrics.width + 0.001);
    }
  });

  it('keeps tracks in list order regardless of what is playing', () => {
    const layout = computeWallLayout({ count: 30, ...metrics });
    expect(layout.tiles.map(tile => tile.index)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it('mixes shapes in every incomplete block, including mirrored cycles', () => {
    let prefix = 0;
    for (let block = 0; block < WALL_TEMPLATES.length * 2; block++) {
      const template = WALL_TEMPLATES[block % WALL_TEMPLATES.length]!;
      for (let remaining = 1; remaining < template.length; remaining++) {
        const layout = computeWallLayout({ count: prefix + remaining, width: 1200, gap: 0 });
        const tail = layout.tiles.slice(prefix);
        expect(tail).toHaveLength(remaining);
        expect(tail.some(tile => tile.cols !== tile.rows)).toBe(true);
        // Every cell inside the tail's rectangle is covered exactly once.
        const rows = Math.round((layout.height - block * 800) / 100);
        const cells = Array.from({ length: rows }, () => Array<number>(WALL_BLOCK_COLS).fill(0));
        for (const tile of tail) {
          const x = Math.round(tile.x / 100);
          const y = Math.round(tile.y / 100) - block * WALL_BLOCK_ROWS;
          for (let row = y; row < y + tile.rows; row++) {
            for (let col = x; col < x + tile.cols; col++) cells[row]![col]! += 1;
          }
        }
        expect(cells.flat().every(coverage => coverage === 1)).toBe(true);
      }
      prefix += template.length;
    }
  });

  it('keeps completed blocks fixed throughout one-by-one additions', () => {
    let completed = 0;
    let nextBlock = 0;
    for (let count = 1; count <= 100; count++) {
      const before = computeWallLayout({ count, ...metrics });
      const after = computeWallLayout({ count: count + 1, ...metrics });
      const nextThreshold = completed + WALL_TEMPLATES[nextBlock % WALL_TEMPLATES.length]!.length;
      if (count === nextThreshold) { completed = count; nextBlock++; }
      expect(after.tiles.slice(0, completed)).toEqual(before.tiles.slice(0, completed));
      expect(after.tiles.map(tile => tile.index)).toEqual(Array.from({ length: count + 1 }, (_, i) => i));
    }
  });

  it('scales mixed tail shapes with the window width', () => {
    const wide = computeWallLayout({ count: 17, width: 1200, gap: 0 });
    const narrow = computeWallLayout({ count: 17, width: 600, gap: 0 });
    for (const [index, tile] of narrow.tiles.entries()) {
      const original = wide.tiles[index]!;
      expect([tile.cols, tile.rows]).toEqual([original.cols, original.rows]);
      expect(tile.x).toBeCloseTo(original.x / 2);
      expect(tile.y).toBeCloseTo(original.y / 2);
      expect(tile.width).toBeCloseTo(original.width / 2);
      expect(tile.height).toBeCloseTo(original.height / 2);
    }
  });

  it('returns an empty layout for no tracks or no width', () => {
    expect(computeWallLayout({ count: 0, ...metrics })).toEqual({ tiles: [], height: 0 });
    expect(computeWallLayout({ count: 5, width: 0, gap: 8 })).toEqual({ tiles: [], height: 0 });
  });
});
