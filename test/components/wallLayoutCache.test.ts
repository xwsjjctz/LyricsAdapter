import { describe, expect, it, vi } from 'vitest';

const packer = vi.hoisted(() => ({ packWall: vi.fn() }));

vi.mock('@/components/wall/wallPacker', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/wall/wallPacker')>();
  packer.packWall.mockImplementation(actual.packWall);
  return { ...actual, packWall: packer.packWall };
});

import { computeWallLayout, wallColumnsFor } from '@/components/wall/wallLayout';

describe('computeWallLayout slot cache', () => {
  it('packs once per (count, columns) while a drag only changes the pixel width', () => {
    expect(wallColumnsFor(1180)).toBe(wallColumnsFor(1260));

    const narrow = computeWallLayout({ count: 300, width: 1180, gap: 8 });
    for (let width = 1181; width <= 1260; width++) computeWallLayout({ count: 300, width, gap: 8 });
    const wide = computeWallLayout({ count: 300, width: 1260, gap: 8 });

    expect(packer.packWall).toHaveBeenCalledTimes(1);
    expect(wide.tiles.map(({ cols, rows, index }) => [index, cols, rows]))
      .toEqual(narrow.tiles.map(({ cols, rows, index }) => [index, cols, rows]));
    expect(wide.height).toBeGreaterThan(narrow.height);
  });

  it('packs again when the track count or column count changes', () => {
    packer.packWall.mockClear();

    computeWallLayout({ count: 301, width: 1200, gap: 8 });
    computeWallLayout({ count: 301, width: 1600, gap: 8 });

    expect(packer.packWall).toHaveBeenCalledTimes(2);
  });
});
