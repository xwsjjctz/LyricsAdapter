/**
 * Pure geometry for the library poster wall.
 *
 * The wall is a 12-column grid of square cells, consumed in 12x8 blocks. Each
 * full block is filled from a template whose slots tile the block exactly, so
 * mixed tile sizes never leave holes. An incomplete block uses compact mixed
 * bands sized to its track count, so adding tracks never needs to wait for a
 * full block to show varied shapes. Tiles follow list order, so playing a track
 * never moves it; only the incomplete block changes as tracks are appended.
 */

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

export const WALL_BLOCK_COLS = 12;
export const WALL_BLOCK_ROWS = 8;
const TAIL_BAND_ROWS = 4;

const slot = (x: number, y: number, cols: number, rows: number): WallSlot => ({ x, y, cols, rows });

/** Rotating block layouts; each covers 12x8 exactly. */
export const WALL_TEMPLATES: readonly (readonly WallSlot[])[] = [
  [
    slot(0, 0, 4, 4), slot(4, 0, 2, 2), slot(6, 0, 2, 2), slot(8, 0, 4, 4),
    slot(4, 2, 4, 2),
    slot(0, 4, 2, 2), slot(2, 4, 2, 2), slot(4, 4, 4, 4), slot(8, 4, 2, 2), slot(10, 4, 2, 2),
    slot(0, 6, 4, 2), slot(8, 6, 4, 2),
  ],
  [
    slot(0, 0, 3, 3), slot(3, 0, 3, 3), slot(6, 0, 6, 4),
    slot(0, 3, 2, 2), slot(2, 3, 2, 2), slot(4, 3, 2, 2),
    slot(6, 4, 3, 4), slot(9, 4, 3, 4),
    slot(0, 5, 3, 3), slot(3, 5, 3, 3),
  ],
  [
    slot(0, 0, 2, 2), slot(2, 0, 2, 2), slot(4, 0, 4, 4), slot(8, 0, 2, 2), slot(10, 0, 2, 2),
    slot(0, 2, 4, 2), slot(8, 2, 4, 2),
    slot(0, 4, 4, 4), slot(4, 4, 2, 2), slot(6, 4, 2, 2), slot(8, 4, 4, 4),
    slot(4, 6, 4, 2),
  ],
];

/** Two to six posters tile a compact 12x4 band without empty cells. */
const TAIL_BANDS: readonly (readonly WallSlot[])[] = [
  [slot(0, 0, 8, 4), slot(8, 0, 4, 4)],
  [slot(0, 0, 6, 4), slot(6, 0, 3, 4), slot(9, 0, 3, 4)],
  [slot(0, 0, 4, 4), slot(4, 0, 4, 2), slot(8, 0, 4, 4), slot(4, 2, 4, 2)],
  [
    slot(0, 0, 4, 4), slot(4, 0, 2, 2), slot(6, 0, 2, 2), slot(8, 0, 4, 4),
    slot(4, 2, 4, 2),
  ],
  [
    slot(0, 0, 6, 4), slot(6, 0, 2, 2), slot(8, 0, 2, 2), slot(10, 0, 2, 2),
    slot(6, 2, 4, 2), slot(10, 2, 2, 2),
  ],
];

const byReadingOrder = (a: WallSlot, b: WallSlot) => a.y - b.y || a.x - b.x;

const mirror = (slots: readonly WallSlot[]): WallSlot[] =>
  slots.map(s => ({ ...s, x: WALL_BLOCK_COLS - s.x - s.cols })).sort(byReadingOrder);

/** Template for the n-th block; every second cycle is mirrored. */
const templateFor = (blockIndex: number): WallSlot[] => {
  const base = WALL_TEMPLATES[blockIndex % WALL_TEMPLATES.length]!;
  const cycle = Math.floor(blockIndex / WALL_TEMPLATES.length);
  return cycle % 2 === 1 ? mirror(base) : [...base].sort(byReadingOrder);
};

const tailFor = (count: number, blockIndex: number): WallSlot[] => {
  // A single poster fills the width at 2:1, matching the existing wide tiles.
  if (count === 1) return [slot(0, 0, WALL_BLOCK_COLS, 6)];

  const bandCounts = count <= 6 ? [count] : [Math.ceil(count / 2), Math.floor(count / 2)];
  return bandCounts.flatMap((bandCount, bandIndex) => {
    const base = TAIL_BANDS[bandCount - 2]!;
    const band = (blockIndex + bandIndex) % 2 === 1 ? mirror(base) : [...base].sort(byReadingOrder);
    return band.map(s => ({ ...s, y: s.y + bandIndex * TAIL_BAND_ROWS }));
  });
};

export function computeWallLayout({ count, width, gap }: WallLayoutInput): WallLayout {
  if (count <= 0 || width <= 0) return { tiles: [], height: 0 };

  const cell = (width - gap * (WALL_BLOCK_COLS - 1)) / WALL_BLOCK_COLS;
  const pitch = cell + gap;
  const blockHeight = WALL_BLOCK_ROWS * pitch;
  const span = (cells: number) => cells * cell + (cells - 1) * gap;

  const tiles: WallTile[] = [];
  let cursor = 0;
  let top = 0;
  let bottom = 0;

  const place = (slots: readonly WallSlot[], blockTop: number) => {
    for (let s = 0; s < slots.length && cursor < count; s++) {
      const { x, y, cols, rows } = slots[s]!;
      const tile: WallTile = {
        index: cursor,
        x: x * pitch,
        y: blockTop + y * pitch,
        width: span(cols),
        height: span(rows),
        cols,
        rows,
      };
      tiles.push(tile);
      bottom = Math.max(bottom, tile.y + tile.height);
      cursor++;
    }
  };

  for (let block = 0; cursor < count; block++) {
    const template = templateFor(block);
    if (count - cursor < template.length) {
      place(tailFor(count - cursor, block), top);
      break;
    }
    place(template, top);
    top += blockHeight;
  }

  return { tiles, height: bottom };
}
