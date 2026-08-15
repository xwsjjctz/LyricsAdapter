import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

function cacheKey(coverPath: string): string {
  return createHash('sha256')
    .update(fs.realpathSync.native(coverPath))
    .digest('hex')
    .slice(0, 24);
}

describe('startup cover cleanup', () => {
  const originalArgv = [...process.argv];
  let temporaryDirectory = '';

  afterEach(() => {
    process.argv = [...originalArgv];
    vi.restoreAllMocks();
    vi.resetModules();
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('keeps active derivatives and removes orphan and interrupted cache files', async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-adapter-cleanup-'));
    const coverDirectory = path.join(temporaryDirectory, 'covers');
    const cacheDirectory = path.join(coverDirectory, '.thumbnails');
    fs.mkdirSync(cacheDirectory, { recursive: true });

    const activeCover = path.join(coverDirectory, 'active-track.jpg');
    const orphanCover = path.join(coverDirectory, 'orphan-track.jpg');
    fs.writeFileSync(activeCover, 'active');
    fs.writeFileSync(orphanCover, 'orphan');
    const activeThumbnail = path.join(cacheDirectory, `${cacheKey(activeCover)}-128.jpg`);
    const orphanThumbnail = path.join(cacheDirectory, `${cacheKey(orphanCover)}-128.jpg`);
    fs.writeFileSync(activeThumbnail, 'active thumbnail');
    fs.writeFileSync(orphanThumbnail, 'orphan thumbnail');
    const interrupted = path.join(cacheDirectory, 'active-128.jpg.tmp-old');
    fs.writeFileSync(interrupted, 'partial');
    const staleTime = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(interrupted, staleTime, staleTime);

    process.argv = ['electron', 'cleanup.js', temporaryDirectory, JSON.stringify(['active-track'])];
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    }) as typeof process.exit);

    await expect(import('../../electron/cleanup')).rejects.toThrow('process.exit:0');

    expect(fs.existsSync(activeCover)).toBe(true);
    expect(fs.existsSync(activeThumbnail)).toBe(true);
    expect(fs.existsSync(orphanCover)).toBe(false);
    expect(fs.existsSync(orphanThumbnail)).toBe(false);
    expect(fs.existsSync(interrupted)).toBe(false);
  });

  it('preserves source covers but still prunes orphan derivatives when the active list is empty', async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-adapter-cleanup-'));
    const coverDirectory = path.join(temporaryDirectory, 'covers');
    const cacheDirectory = path.join(coverDirectory, '.thumbnails');
    fs.mkdirSync(cacheDirectory, { recursive: true });

    const preservedCover = path.join(coverDirectory, 'preserved-track.jpg');
    const removedCover = path.join(coverDirectory, 'removed-track.jpg');
    fs.writeFileSync(preservedCover, 'preserved');
    fs.writeFileSync(removedCover, 'removed');
    const preservedThumbnail = path.join(cacheDirectory, `${cacheKey(preservedCover)}-128.jpg`);
    const orphanThumbnail = path.join(cacheDirectory, `${cacheKey(removedCover)}-128.jpg`);
    fs.writeFileSync(preservedThumbnail, 'preserved thumbnail');
    fs.writeFileSync(orphanThumbnail, 'orphan thumbnail');
    fs.unlinkSync(removedCover);

    process.argv = ['electron', 'cleanup.js', temporaryDirectory, '[]'];
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    }) as typeof process.exit);

    await expect(import('../../electron/cleanup')).rejects.toThrow('process.exit:0');

    expect(fs.existsSync(preservedCover)).toBe(true);
    expect(fs.existsSync(preservedThumbnail)).toBe(true);
    expect(fs.existsSync(orphanThumbnail)).toBe(false);
  });
});
