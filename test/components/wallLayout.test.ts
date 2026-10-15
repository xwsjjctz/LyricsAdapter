import { describe, expect, it } from 'vitest';
import {
  COMPACT_COLS,
  WALL_TARGET_UNIT,
  computeWallLayout,
  wallColumnsFor,
  type WallLayout,
} from '@/components/wall/wallLayout';

/** Counts how often each grid cell is covered; rows grow with the layout. */
const coverage = (layout: WallLayout, columns: number, cell: number): number[][] => {
  const cells = Array.from({ length: Math.round(layout.height / cell) }, () => Array<number>(columns).fill(0));
  for (const tile of layout.tiles) {
    const x = Math.round(tile.x / cell), y = Math.round(tile.y / cell);
    for (let row = y; row < y + tile.rows; row++) {
      for (let col = x; col < x + tile.cols; col++) cells[row]![col]! += 1;
    }
  }
  return cells;
};

describe('wallColumnsFor', () => {
  it.each([
    [360, 6], [719, 6], [720, 8], [1200, 12], [1440, 14], [1920, 20], [2560, 26],
  ])('picks columns for %i px: %i', (width, columns) => {
    expect(wallColumnsFor(width)).toBe(columns);
  });

  it('keeps small covers near the target size on wide walls', () => {
    for (let width = 720; width <= 3840; width += 37) {
      const unit = (width / wallColumnsFor(width)) * 2;
      expect(Math.abs(unit - WALL_TARGET_UNIT) / WALL_TARGET_UNIT).toBeLessThan(0.12);
    }
  });
});

describe('computeWallLayout', () => {
  it('returns an empty layout for no tracks or no width', () => {
    expect(computeWallLayout({ count: 0, width: 1200, gap: 8 })).toEqual({ tiles: [], height: 0 });
    expect(computeWallLayout({ count: 5, width: 0, gap: 8 })).toEqual({ tiles: [], height: 0 });
  });

  it.each([720, 1200, 1440, 1920, 2560])('packs wide walls at %i px without holes', width => {
    const columns = wallColumnsFor(width);
    const cell = width / columns;
    for (let count = 1; count <= 120; count++) {
      const layout = computeWallLayout({ count, width, gap: 0 });
      expect(layout.tiles.map(tile => tile.index)).toEqual(Array.from({ length: count }, (_, i) => i));
      for (const tile of layout.tiles) {
        expect(tile.x).toBeGreaterThanOrEqual(0);
        expect(tile.x + tile.width).toBeLessThanOrEqual(width + 0.001);
      }
      const cells = coverage(layout, columns, cell);
      expect(cells.flat().every(value => value <= 1)).toBe(true);
      // Every row is full except the last, which fills from the left.
      for (const row of cells.slice(0, -2)) expect(row.every(value => value === 1)).toBe(true);
      for (const row of cells.slice(-2)) {
        const filled = row.filter(value => value === 1).length;
        expect(row.slice(0, filled).every(value => value === 1)).toBe(true);
      }
    }
  });

  it('never moves settled tiles while tracks are appended', () => {
    const width = 1440;
    const units = wallColumnsFor(width) / 2;
    for (let count = 1; count <= 200; count++) {
      const before = computeWallLayout({ count, width, gap: 0 });
      const after = computeWallLayout({ count: count + 1, width, gap: 0 });
      const settled = Math.max(0, count - 2 * units);
      expect(after.tiles.slice(0, settled)).toEqual(before.tiles.slice(0, settled));
    }
  });

  it('mixes all shapes, with small covers the most common', () => {
    const layout = computeWallLayout({ count: 600, width: 1440, gap: 0 });
    const counts = new Map<string, number>();
    for (const tile of layout.tiles) {
      const kind = `${tile.cols}x${tile.rows}`;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    expect(new Set(counts.keys())).toEqual(new Set(['2x2', '4x2', '2x4', '4x4']));
    expect(Math.max(...counts.values())).toBe(counts.get('2x2'));
  });

  it.each([720, 1200, 1440, 1920, 2560])('rarely lets small covers cluster at %i px', width => {
    const count = 400;
    const units = wallColumnsFor(width) / 2;
    const cell = width / (units * 2);
    const layout = computeWallLayout({ count, width, gap: 0 });
    const smallAt = new Set(layout.tiles
      .filter(tile => tile.cols === 2 && tile.rows === 2)
      .map(tile => `${Math.round(tile.x / cell / 2)},${Math.round(tile.y / cell / 2)}`));
    const small = (x: number, y: number) => smallAt.has(`${x},${y}`);
    let clusters = 0;
    for (const key of smallAt) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      if (small(x - 1, y) && small(x - 2, y)) clusters++;
      if (small(x - 1, y) && small(x - 1, y - 1) && small(x, y - 1)) clusters++;
    }
    expect(clusters / count).toBeLessThan(0.03);
  });

  it.each([720, 1200, 1440, 1920, 2560])('gives every two-row band one large cover at %i px, never touching', width => {
    const count = 400;
    const units = wallColumnsFor(width) / 2;
    const cell = width / (units * 2);
    const layout = computeWallLayout({ count, width, gap: 0 });
    const large = layout.tiles.filter(tile => tile.cols === 4 && tile.rows === 4);
    // Bands whose tracks are all settled, away from the end of the list.
    const settledTop = layout.tiles[count - 2 * units]!.y;
    const bandHeight = cell * 4;
    const bands = Math.floor(settledTop / bandHeight) - 1;
    for (let band = 0; band < bands; band++) {
      const inBand = large.filter(tile => Math.round(tile.y / bandHeight) === band);
      expect(inBand).toHaveLength(1);
      expect(Math.round(inBand[0]!.y / cell) % 4).toBe(0);
    }
    for (const a of large) {
      for (const b of large) {
        if (a === b) continue;
        const touchX = Math.abs(a.x + a.width - b.x) < 0.001 && a.y < b.y + b.height && b.y < a.y + a.height;
        const touchY = Math.abs(a.y + a.height - b.y) < 0.001 && a.x < b.x + b.width && b.x < a.x + a.width;
        expect(touchX || touchY).toBe(false);
      }
    }
  });

  it('scales the same packing with the window width inside one column count', () => {
    const wide = computeWallLayout({ count: 40, width: 1440, gap: 0 });
    const narrow = computeWallLayout({ count: 40, width: 1400, gap: 0 });
    const ratio = 1400 / 1440;
    for (const [index, tile] of narrow.tiles.entries()) {
      const original = wide.tiles[index]!;
      expect([tile.cols, tile.rows]).toEqual([original.cols, original.rows]);
      expect(tile.x).toBeCloseTo(original.x * ratio);
      expect(tile.width).toBeCloseTo(original.width * ratio);
    }
  });

  it.each([360, 393, 600, 719])('keeps narrow covers readable at %i px, including every partial block', width => {
    for (let count = 2; count <= 42; count++) {
      const layout = computeWallLayout({ count, width, gap: 0 });
      expect(layout.tiles).toHaveLength(count);
      const cell = width / COMPACT_COLS;
      for (const tile of layout.tiles) {
        expect(tile.width).toBeGreaterThanOrEqual(width / 3 - 0.001);
        expect(tile.height).toBeGreaterThanOrEqual(width / 3 - 0.001);
        expect(tile.x + tile.width).toBeLessThanOrEqual(width + 0.001);
      }
      expect(coverage(layout, COMPACT_COLS, cell).flat().every(value => value === 1)).toBe(true);
      expect(layout.tiles.some(tile => tile.cols !== tile.rows)).toBe(true);
      const after = computeWallLayout({ count: count + 1, width, gap: 0 });
      const completed = Math.floor(count / 7) * 7;
      expect(after.tiles.slice(0, completed)).toEqual(layout.tiles.slice(0, completed));
    }
  });
});
