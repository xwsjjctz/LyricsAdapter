/**
 * Automatic packing for the wide poster wall.
 *
 * The wall is a grid of square units, as many as fit the width at about
 * WALL_TARGET_UNIT pixels each, read in bands of two unit rows. Each track, in
 * list order, takes the first free unit in reading order. Every band gets one
 * large cover at a planned column that moves between bands, so each screen has
 * a focal point and large covers never stack; the other covers are small, wide
 * or tall by a hash of their index, falling back to smaller shapes when the
 * wanted one does not fit. Every unit before the newest tile is therefore
 * filled, and earlier tiles never move as tracks are appended.
 *
 * Small covers never gather: a third one in a row, or one that would close a
 * 2x2 square of them, becomes wide or tall instead whenever that fits.
 *
 * Only tall covers cross into the next band, and never under its planned large
 * slot. Tall shapes are only used while at least two rows' worth of tracks
 * follow, so the rows they reach into are always completed and the wall ends
 * in one left-aligned partial row.
 */
import type { WallSlot } from './wallLayout';

interface Shape {
  w: number;
  h: number;
}

const UNIT: Shape = { w: 1, h: 1 };
const WIDE: Shape = { w: 2, h: 1 };
const TALL: Shape = { w: 1, h: 2 };
const LARGE: Shape = { w: 2, h: 2 };

/** Unit rows per band; each band holds one large cover. */
const BAND_ROWS = 2;

/** Wanted shape by hash bucket for covers outside the planned large slot. */
const SHAPE_BUCKETS: readonly { upTo: number; options: readonly Shape[] }[] = [
  { upTo: 0.2, options: [WIDE, UNIT] },
  { upTo: 0.4, options: [TALL, UNIT] },
  { upTo: 1, options: [UNIT] },
];

/** Shapes that break up a cluster of small covers, in either preference. */
const BREAKERS: readonly (readonly Shape[])[] = [[WIDE, TALL], [TALL, WIDE]];

/**
 * Where each band's large cover sits, as a fraction of the free range;
 * neighbouring bands are nudged apart so their large covers never touch.
 */
const LARGE_POSITIONS = [0.15, 0.85, 0.5, 0, 0.7, 0.3, 1];

/** Grid cells per unit; the layout's cells stay half a small cover wide. */
export const CELLS_PER_UNIT = 2;

/** Stable pseudo-random value in [0, 1) for a track index (murmur3 finaliser). */
const hashIndex = (index: number): number => {
  let x = Math.imul(index + 1, 0x9e3779b1);
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 0x1_0000_0000;
};

const optionsFor = (index: number): readonly Shape[] => {
  const value = hashIndex(index);
  return SHAPE_BUCKETS.find(bucket => value < bucket.upTo)!.options;
};

const breakersFor = (index: number): readonly Shape[] => BREAKERS[hashIndex(~index) < 0.5 ? 0 : 1]!;

const FREE = 0;
const TAKEN = 1;
const TAKEN_SMALL = 2;

/** Planned large-cover column for each band, at least two columns from the previous one. */
const largeColumns = (units: number) => {
  const range = Math.max(0, units - LARGE.w);
  const columns: number[] = [];
  return (band: number): number => {
    for (let b = columns.length; b <= band; b++) {
      const wanted = Math.round(LARGE_POSITIONS[b % LARGE_POSITIONS.length]! * range);
      const previous = columns[b - 1];
      if (previous === undefined || Math.abs(wanted - previous) >= LARGE.w || range < LARGE.w) {
        columns.push(wanted);
        continue;
      }
      // Nearest column that clears the previous band's large cover.
      const left = previous - LARGE.w;
      const right = previous + LARGE.w;
      const candidates = [left, right].filter(c => c >= 0 && c <= range);
      const nearest = candidates.reduce<number | undefined>(
        (best, c) => best === undefined || Math.abs(c - wanted) < Math.abs(best - wanted) ? c : best,
        undefined,
      );
      columns.push(nearest ?? wanted);
    }
    return columns[band]!;
  };
};

/** Packs `count` tiles into `units` columns; slots are in layout cells, in list order. */
export function packWall(count: number, units: number): WallSlot[] {
  const grid: Uint8Array[] = [];
  const row = (y: number): Uint8Array => {
    while (grid.length <= y) grid.push(new Uint8Array(units));
    return grid[y]!;
  };
  const cellAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= units ? TAKEN : row(y)[x]!;
  const fits = (x: number, y: number, shape: Shape): boolean => {
    for (let dy = 0; dy < shape.h; dy++) {
      for (let dx = 0; dx < shape.w; dx++) if (cellAt(x + dx, y + dy) !== FREE) return false;
    }
    return true;
  };
  const small = (x: number, y: number): boolean => cellAt(x, y) === TAKEN_SMALL;
  /** A small cover here would be the third in a row or close a 2x2 of them. */
  const crowded = (x: number, y: number): boolean =>
    small(x - 1, y) && (small(x - 2, y) || (small(x - 1, y - 1) && small(x, y - 1)));
  const largeColumnFor = largeColumns(units);
  const bandsWithLarge = new Set<number>();

  const slots: WallSlot[] = [];
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < count; index++) {
    while (cellAt(cx, cy) !== FREE) {
      cx++;
      if (cx === units) { cx = 0; cy++; }
    }
    const canGrowDown = count - 1 - index >= 2 * units;
    const band = Math.floor(cy / BAND_ROWS);
    const bandTop = cy % BAND_ROWS === 0;
    const plannedX = largeColumnFor(band);
    const largePending = canGrowDown && bandTop && !bandsWithLarge.has(band);
    // From a band's last row, a tall cover reaches into the next band; it
    // must stay clear of that band's planned large slot.
    const nextPlannedX = largeColumnFor(band + 1);
    const tallAllowed = canGrowDown
      && (bandTop || cx < nextPlannedX || cx >= nextPlannedX + LARGE.w);
    const allowed = (option: Shape): boolean =>
      (option.h === 1 || tallAllowed)
      // Keep the planned large slot clear for this band's large cover.
      && !(largePending && cx < plannedX && cx + option.w > plannedX)
      && fits(cx, cy, option);

    let shape: Shape;
    if (largePending && cx >= plannedX && fits(cx, cy, LARGE)) {
      shape = LARGE;
      bandsWithLarge.add(band);
    } else {
      shape = optionsFor(index).find(allowed) ?? UNIT;
      if (shape === UNIT && crowded(cx, cy)) shape = breakersFor(index).find(allowed) ?? UNIT;
    }
    const mark = shape === UNIT ? TAKEN_SMALL : TAKEN;
    for (let dy = 0; dy < shape.h; dy++) row(cy + dy).fill(mark, cx, cx + shape.w);
    slots.push({
      x: cx * CELLS_PER_UNIT,
      y: cy * CELLS_PER_UNIT,
      cols: shape.w * CELLS_PER_UNIT,
      rows: shape.h * CELLS_PER_UNIT,
    });
  }
  return slots;
}
