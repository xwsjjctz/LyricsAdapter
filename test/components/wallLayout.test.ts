import { describe, expect, it } from 'vitest';
import { heroesForBand } from '@/components/wall/wallPacker';
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
      // Full rows come first; after them every row fills from the left without gaps.
      const firstPartial = cells.findIndex(row => !row.every(value => value === 1));
      const partialRows = firstPartial < 0 ? [] : cells.slice(firstPartial);
      for (const row of partialRows) {
        const filled = row.filter(value => value === 1).length;
        expect(row.slice(0, filled).every(value => value === 1)).toBe(true);
      }
    }
  });

  it('never moves tiles of a completed band while tracks are appended', () => {
    const width = 1440;
    const units = wallColumnsFor(width) / 2;
    for (let count = 1; count <= 200; count++) {
      const before = computeWallLayout({ count, width, gap: 0 });
      const after = computeWallLayout({ count: count + 1, width, gap: 0 });
      const unchanged = before.tiles.findIndex((tile, i) => JSON.stringify(tile) !== JSON.stringify(after.tiles[i]));
      const settled = unchanged < 0 ? count : unchanged;
      // Only the tail, which is shorter than one band, may reshape.
      expect(count - settled).toBeLessThan(3 * units);
    }
  });

  it.each([720, 1200, 1440, 1920, 2560])('keeps covers square apart from a few 4:3 pairs at %i px', width => {
    const layout = computeWallLayout({ count: 600, width, gap: 0 });
    const kinds = new Map<string, number>();
    for (const tile of layout.tiles) kinds.set(`${tile.cols}x${tile.rows}`, (kinds.get(`${tile.cols}x${tile.rows}`) ?? 0) + 1);
    for (const kind of kinds.keys()) expect(['2x2', '3x3', '4x4', '4x3']).toContain(kind);
    expect(kinds.has('2x2') && kinds.has('3x3') && kinds.has('4x4')).toBe(true);
    expect((kinds.get('4x3') ?? 0) / layout.tiles.length).toBeLessThan(0.1);
  });

  it('alternates hero bands on the narrowest wide wall so medium covers still appear', () => {
    expect([0, 1, 2, 3].map(band => heroesForBand(band, 8))).toEqual([1, 0, 1, 0]);
    expect([0, 1].map(band => heroesForBand(band, 14))).toEqual([1, 1]);
    expect(heroesForBand(0, 26)).toBe(2);
  });

  it.each([720, 1200, 1440, 1920, 2560])('gives every full band its heroes at %i px', width => {
    const columns = wallColumnsFor(width);
    const cell = width / columns;
    const layout = computeWallLayout({ count: 600, width, gap: 0 });
    const bandHeight = cell * 6;
    const bands = Math.floor(layout.height / bandHeight) - 2;
    let withWidePair = 0;
    for (let band = 0; band < bands; band++) {
      const inBand = layout.tiles.filter(tile => Math.floor(tile.y / bandHeight + 1e-6) === band);
      expect(inBand.filter(tile => tile.cols === 4 && tile.rows === 4)).toHaveLength(heroesForBand(band, columns));
      if (inBand.some(tile => tile.cols === 4 && tile.rows === 3)) withWidePair++;
    }
    expect(withWidePair).toBeGreaterThan(0);
    expect(withWidePair / bands).toBeLessThan(0.5);
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
