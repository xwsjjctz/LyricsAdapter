import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  createFromPath: vi.fn(),
  resize: vi.fn(),
  getPath: vi.fn(),
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: electronMocks.getPath,
    whenReady: vi.fn(() => Promise.resolve()),
  },
  nativeImage: { createFromPath: electronMocks.createFromPath },
  protocol: { handle: electronMocks.handle },
}));

import {
  ensureCoverThumbnailCache,
  invalidateCoverThumbnails,
  pruneOrphanCoverThumbnails,
  registerCoverProtocol,
} from '../../../electron/protocols/coverProtocol';

describe('cover thumbnail disk cache', () => {
  let temporaryDirectory = '';
  let coverDirectory = '';
  let coverPath = '';

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-adapter-cover-'));
    coverDirectory = path.join(temporaryDirectory, 'covers');
    fs.mkdirSync(coverDirectory);
    coverPath = path.join(coverDirectory, 'track.jpg');
    fs.writeFileSync(coverPath, 'source image placeholder');
    electronMocks.getPath.mockReturnValue(temporaryDirectory);

    electronMocks.resize.mockImplementation(({ width, height }: { width: number; height: number }) => ({
      toJPEG: () => Buffer.from(`${width}x${height}`),
    }));
    electronMocks.createFromPath.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 4000, height: 3000 }),
      resize: electronMocks.resize,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('decodes the original once and persists the FocusMode size pair', () => {
    const first = ensureCoverThumbnailCache(coverPath, 256);
    const second = ensureCoverThumbnailCache(coverPath, 512);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(electronMocks.createFromPath).toHaveBeenCalledTimes(1);
    expect(electronMocks.resize).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(first!)).toBe(true);
    expect(fs.existsSync(second!)).toBe(true);
    expect(fs.readdirSync(path.dirname(first!)).every(file => file.endsWith('.jpg'))).toBe(true);
  });

  it('invalidates every derived size when a cover changes', () => {
    const thumbnail = ensureCoverThumbnailCache(coverPath, 128);
    expect(thumbnail).not.toBeNull();

    invalidateCoverThumbnails(coverPath);

    expect(fs.existsSync(thumbnail!)).toBe(false);
    expect(fs.existsSync(coverPath)).toBe(true);
  });

  it('snaps arbitrary requests to the bounded disk-cache size set', () => {
    const thumbnail = ensureCoverThumbnailCache(coverPath, 129);

    expect(thumbnail).toMatch(/-256\.jpg$/);
    expect(electronMocks.resize).toHaveBeenCalledWith(expect.objectContaining({ width: 256 }));
    expect(fs.readdirSync(path.dirname(thumbnail!)).some(file => file.includes('-129.'))).toBe(false);
  });

  it('prunes interrupted writes and thumbnails whose source disappeared', () => {
    const activeThumbnail = ensureCoverThumbnailCache(coverPath, 128)!;
    const orphanCover = path.join(coverDirectory, 'orphan.jpg');
    fs.writeFileSync(orphanCover, 'orphan source');
    const orphanThumbnail = ensureCoverThumbnailCache(orphanCover, 128)!;
    fs.unlinkSync(orphanCover);
    const interrupted = path.join(path.dirname(activeThumbnail), 'active-128.jpg.tmp-old');
    fs.writeFileSync(interrupted, 'partial');
    const staleTime = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(interrupted, staleTime, staleTime);

    const removed = pruneOrphanCoverThumbnails(coverDirectory);

    expect(removed).toBe(2);
    expect(fs.existsSync(activeThumbnail)).toBe(true);
    expect(fs.existsSync(orphanThumbnail)).toBe(false);
  });

  async function registeredHandler(): Promise<(request: { url: string }) => Promise<Response>> {
    registerCoverProtocol();
    await Promise.resolve();
    const handler = [...electronMocks.handle.mock.calls].reverse().find(([scheme]) => scheme === 'cover')?.[1] as
      ((request: { url: string }) => Promise<Response>) | undefined;
    expect(handler).toBeTypeOf('function');
    return handler!;
  }

  it('serves only flat in-directory paths and versions immutable responses', async () => {
    const handler = await registeredHandler();

    const escaped = await handler({ url: 'cover://../covers-backup/escape.jpg?size=128' });
    expect(escaped.status).toBe(403);

    const missing = await handler({ url: 'cover://absent.jpg?size=128' });
    expect(missing.status).toBe(404);

    const versioned = await handler({ url: 'cover://track.jpg/?v=0123456789abcdef&size=129' });
    expect(versioned.status).toBe(200);
    expect(versioned.headers.get('content-type')).toBe('image/jpeg');
    expect(versioned.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const legacy = await handler({ url: 'cover://track.jpg?size=128' });
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get('cache-control')).toBe('no-store');
  });

  it('shares one decode between concurrent requests and then serves the disk cache', async () => {
    const handler = await registeredHandler();

    const responses = await Promise.all([
      handler({ url: 'cover://track.jpg?size=128' }),
      handler({ url: 'cover://track.jpg?size=128' }),
    ]);
    const cached = await handler({ url: 'cover://track.jpg?size=128' });

    expect(electronMocks.createFromPath).toHaveBeenCalledTimes(1);
    for (const response of [...responses, cached]) {
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('128x96');
    }
  });

  it('remembers sources that already fit instead of decoding them on every request', async () => {
    electronMocks.createFromPath.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 100, height: 100 }),
      resize: electronMocks.resize,
    });
    const handler = await registeredHandler();

    const first = await handler({ url: 'cover://track.jpg?size=128' });
    const second = await handler({ url: 'cover://track.jpg?size=128' });

    expect(electronMocks.createFromPath).toHaveBeenCalledTimes(1);
    expect(electronMocks.resize).not.toHaveBeenCalled();
    expect(await first.text()).toBe('source image placeholder');
    expect(await second.text()).toBe('source image placeholder');
  });
});
