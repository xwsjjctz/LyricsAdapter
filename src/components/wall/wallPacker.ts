/**
 * Band composition for the wide poster wall.
 *
 * The wall is a grid of cells half a small cover wide, as many as fit the
 * width at about WALL_TARGET_UNIT pixels per small cover. It is read in bands
 * six cells tall. Each band lines up hand-designed blocks side by side: one or
 * more hero blocks (a large 4x4 cover with medium 3x3 or small 2x2 covers
 * around it) and filler blocks of medium or small covers, occasionally a pair
 * of 4:3 covers. Covers stay square except for those 4:3 pairs, so artwork is
 * never cut in half. Blocks are mirrored and flipped by a hash of the band, and
 * heroes move between bands, so the rhythm varies without random gaps.
 *
 * A band's blocks depend only on its index and the column count, so a full band
 * never changes as tracks are appended. Tracks that do not fill the next band
 * form the tail: a large cover first, small covers to its right and below,
 * left-aligned, reshaped into a full band once enough tracks arrive.
 */
import type { WallSlot } from './wallLayout';

/** Grid cells per small cover; the layout's cells stay half a small cover wide. */
export const CELLS_PER_UNIT = 2;

const BAND_ROWS = 6;
const SMALL = 2;
const LARGE = 4;

interface Block {
  width: number;
  slots: readonly WallSlot[];
}

const slot = (x: number, y: number, cols: number, rows: number): WallSlot => ({ x, y, cols, rows });

/** Large cover with two medium and two small covers; 7 cells wide. */
const HERO_MEDIUM: Block = {
  width: 7,
  slots: [slot(0, 0, 4, 4), slot(4, 0, 3, 3), slot(4, 3, 3, 3), slot(0, 4, 2, 2), slot(2, 4, 2, 2)],
};
/** Large cover framed by five small covers; 6 cells wide. */
const HERO_SMALL: Block = {
  width: 6,
  slots: [
    slot(0, 0, 4, 4), slot(4, 0, 2, 2), slot(4, 2, 2, 2),
    slot(0, 4, 2, 2), slot(2, 4, 2, 2), slot(4, 4, 2, 2),
  ],
};
const FILLERS: Readonly<Record<number, Block>> = {
  6: { width: 6, slots: [slot(0, 0, 3, 3), slot(3, 0, 3, 3), slot(0, 3, 3, 3), slot(3, 3, 3, 3)] },
  4: { width: 4, slots: [slot(0, 0, 4, 3), slot(0, 3, 4, 3)] },
  3: { width: 3, slots: [slot(0, 0, 3, 3), slot(0, 3, 3, 3)] },
  2: { width: 2, slots: [slot(0, 0, 2, 2), slot(0, 2, 2, 2), slot(0, 4, 2, 2)] },
};
/** Square fillers cover any width except 1; the 4:3 pair is opt-in per band. */
const SQUARE_FILLER_WIDTHS = [6, 3, 2] as const;
/** Share of bands that include one 4:3 pair. */
const WIDE_PAIR_SHARE = 0.3;
/** Roughly one hero per this many cells of width. */
const CELLS_PER_HERO = 11;
/** Below this width a hero leaves no room for medium covers, so every other band has none. */
const NARROW_COLUMNS = 12;

/** Hero blocks wanted in a band. */
export const heroesForBand = (band: number, columns: number): number =>
  columns < NARROW_COLUMNS && band % 2 === 1 ? 0 : Math.max(1, Math.round(columns / CELLS_PER_HERO));

/** Stable pseudo-random value in [0, 1) (murmur3 finaliser). */
const hash = (value: number): number => {
  let x = Math.imul(value + 1, 0x9e3779b1);
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 0x1_0000_0000;
};

const mirrored = (block: Block): Block => ({
  ...block,
  slots: block.slots.map(s => ({ ...s, x: block.width - s.x - s.cols })),
});
const flipped = (block: Block): Block => ({
  ...block,
  slots: block.slots.map(s => ({ ...s, y: BAND_ROWS - s.y - s.rows })),
});

/** Filler widths summing to `rest`, largest first; null when impossible. */
const fillerWidths = (rest: number, withWidePair: boolean): number[] | null => {
  if (rest < 0 || rest === 1) return null;
  if (withWidePair && rest >= 4) {
    const others = fillerWidths(rest - 4, false);
    if (others) return [4, ...others];
  }
  const widths: number[] = [];
  let left = rest;
  for (const width of SQUARE_FILLER_WIDTHS) {
    // Keep a remainder the smaller fillers can still cover (never exactly 1).
    while (left >= width && left - width !== 1) {
      widths.push(width);
      left -= width;
    }
  }
  return left === 0 ? widths : null;
};

/** Blocks of one band, left to right; depends only on the band and column count. */
const bandBlocks = (band: number, columns: number): Block[] => {
  const withWidePair = hash(band * 17 + 3) < WIDE_PAIR_SHARE;
  const wanted = heroesForBand(band, columns);
  for (let heroes = wanted; heroes >= Math.min(wanted, 1); heroes--) {
    const picks = Array.from({ length: heroes }, (_, i) => hash(band * 31 + i) < 0.5 ? HERO_MEDIUM : HERO_SMALL);
    // Swapping one hero's width shifts the remainder by one, so some choice always fits.
    for (let swap = -1; swap < heroes; swap++) {
      const chosen = picks.map((hero, i) => i !== swap ? hero : hero === HERO_MEDIUM ? HERO_SMALL : HERO_MEDIUM);
      const used = chosen.reduce((sum, hero) => sum + hero.width, 0);
      const widths = fillerWidths(columns - used, withWidePair);
      if (!widths) continue;
      const rotate = Math.floor(hash(band * 7) * widths.length);
      const blocks = [...widths.slice(rotate), ...widths.slice(0, rotate)].map(width => FILLERS[width]!);
      // Spread heroes across the band, shifting between neighbouring bands.
      const offset = band % 2 === 0 ? 0.2 : 0.7;
      chosen.forEach((hero, i) => {
        const at = Math.round(((i + offset) / Math.max(heroes, 1)) * blocks.length);
        blocks.splice(Math.min(at + i, blocks.length), 0, hero);
      });
      return blocks.map((block, i) => {
        let shaped = hash(band * 101 + i) < 0.5 ? mirrored(block) : block;
        if (hash(band * 211 + i) < 0.35) shaped = flipped(shaped);
        return shaped;
      });
    }
  }
  throw new Error(`Poster wall cannot fill ${columns} columns`);
};

const bandSlots = (band: number, columns: number): WallSlot[] => {
  const slots: WallSlot[] = [];
  let x = 0;
  for (const block of bandBlocks(band, columns)) {
    for (const s of block.slots) slots.push({ ...s, x: s.x + x, y: s.y + band * BAND_ROWS });
    x += block.width;
  }
  return slots.sort((a, b) => a.y - b.y || a.x - b.x);
};

/** Tail tracks: a large cover, then small covers to its right and on rows below. */
const tailSlots = (count: number, top: number, columns: number): WallSlot[] => {
  const slots: WallSlot[] = [];
  const withLarge = count >= 3 && columns >= LARGE + SMALL;
  if (withLarge) slots.push(slot(0, top, LARGE, LARGE));
  let x = withLarge ? LARGE : 0;
  let y = top;
  while (slots.length < count) {
    if (x + SMALL > columns) {
      y += SMALL;
      x = withLarge && y < top + LARGE ? LARGE : 0;
    }
    slots.push(slot(x, y, SMALL, SMALL));
    x += SMALL;
  }
  return slots;
};

/** Packs `count` tiles into `units` small-cover columns; slots are in layout cells, in list order. */
export function packWall(count: number, units: number): WallSlot[] {
  const columns = units * CELLS_PER_UNIT;
  const slots: WallSlot[] = [];
  for (let band = 0; slots.length < count; band++) {
    const next = bandSlots(band, columns);
    const remaining = count - slots.length;
    if (remaining < next.length) {
      slots.push(...tailSlots(remaining, band * BAND_ROWS, columns));
      break;
    }
    slots.push(...next);
  }
  return slots;
}
