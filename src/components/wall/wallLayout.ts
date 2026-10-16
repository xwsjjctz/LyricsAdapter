/**
 * Pure geometry for the library poster wall.
 *
 * Narrow windows use 6 columns filled from 8-row templates whose slots tile the
 * block exactly; an incomplete block uses a compact tail sized to its track
 * count. Wider windows pack covers automatically (see wallPacker.ts) on a grid
 * whose column count follows the width, so covers stay near WALL_TARGET_UNIT
 * pixels instead of growing with the window. Tiles follow list order, so
 * playing a track never moves it, and appending tracks only reshapes the end.
 */
import { CELLS_PER_UNIT, packWall } from './wallPacker';

export interface WallSlot {
  x: number;
  y: number;
  cols: number;
  rows: number;
}

export interface WallTile {
  /** Index into the track array this tile renders. */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Span in grid cells, used to size typography. */
  cols: number;
  rows: number;
}

export interface WallLayout {
  tiles: WallTile[];
  height: number;
}

interface WallLayoutInput {
  count: number;
  width: number;
  gap: number;
}

export const WALL_COMPACT_BREAKPOINT = 720;
/** Target edge of a small cover on wide walls, in pixels. */
export const WALL_TARGET_UNIT = 200;
export const COMPACT_COLS = 6;
const COMPACT_BLOCK_ROWS = 8;

const slot = (x: number, y: number, cols: number, rows: number): WallSlot => ({ x, y, cols, rows });

// Three cover widths, like the Android collage, with a seamless, count-aware
// tail policy.
const COMPACT_TEMPLATE: readonly WallSlot[] = [
  slot(0, 0, 2, 2), slot(2, 0, 2, 2), slot(4, 0, 2, 4),
  slot(0, 2, 4, 2), slot(0, 4, 4, 4), slot(4, 4, 2, 2), slot(4, 6, 2, 2),
];
const COMPACT_TAILS: readonly (readonly WallSlot[])[] = [
  [slot(0, 0, 6, 3)],
  [slot(0, 0, 4, 4), slot(4, 0, 2, 4)],
  [slot(0, 0, 4, 2), slot(4, 0, 2, 4), slot(0, 2, 4, 2)],
  [slot(0, 0, 4, 2), slot(4, 0, 2, 2), slot(0, 2, 2, 2), slot(2, 2, 4, 2)],
  [slot(0, 0, 4, 4), slot(4, 0, 2, 4), slot(0, 4, 2, 2), slot(2, 4, 2, 2), slot(4, 4, 2, 2)],
  [
    slot(0, 0, 4, 2), slot(4, 0, 2, 2), slot(0, 2, 2, 4),
    slot(2, 2, 4, 2), slot(2, 4, 2, 2), slot(4, 4, 2, 2),
  ],
];

const byReadingOrder = (a: WallSlot, b: WallSlot) => a.y - b.y || a.x - b.x;

const mirror = (slots: readonly WallSlot[]): WallSlot[] =>
  slots.map(s => ({ ...s, x: COMPACT_COLS - s.x - s.cols })).sort(byReadingOrder);

/** Column count for a measured width: 6 when narrow, otherwise two per unit. */
export function wallColumnsFor(width: number): number {
  if (width < WALL_COMPACT_BREAKPOINT) return COMPACT_COLS;
  return Math.round(width / WALL_TARGET_UNIT) * CELLS_PER_UNIT;
}

/** Template slots for the narrow wall, in list order; every second block is mirrored. */
const compactSlots = (count: number): WallSlot[] => {
  // A library with one track uses a small square instead of a full-width tail.
  if (count === 1) return [slot(0, 0, 2, 2)];
  const slots: WallSlot[] = [];
  for (let block = 0; slots.length < count; block++) {
    const remaining = count - slots.length;
    const base = remaining < COMPACT_TEMPLATE.length ? COMPACT_TAILS[remaining - 1]! : COMPACT_TEMPLATE;
    const oriented = block % 2 === 1 ? mirror(base) : [...base].sort(byReadingOrder);
    slots.push(...oriented.map(s => ({ ...s, y: s.y + block * COMPACT_BLOCK_ROWS })));
  }
  return slots;
};

export function computeWallLayout({ count, width, gap }: WallLayoutInput): WallLayout {
  if (count <= 0 || width <= 0) return { tiles: [], height: 0 };

  const columns = wallColumnsFor(width);
  const cell = (width - gap * (columns - 1)) / columns;
  const pitch = cell + gap;
  const span = (cells: number) => cells * cell + (cells - 1) * gap;

  const slots = columns === COMPACT_COLS ? compactSlots(count) : packWall(count, columns / CELLS_PER_UNIT);
  const tiles = slots.map(({ x, y, cols, rows }, index): WallTile => ({
    index,
    x: x * pitch,
    y: y * pitch,
    width: span(cols),
    height: span(rows),
    cols,
    rows,
  }));
  const height = tiles.reduce((bottom, tile) => Math.max(bottom, tile.y + tile.height), 0);
  return { tiles, height };
}
