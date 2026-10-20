// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteCoverCache } from '../../../electron/services/remoteCoverCache';

let directory: string;
beforeEach(async () => { directory = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'la-remote-covers-')), 'remote-covers'); });
afterEach(async () => { await fs.rm(path.dirname(directory), { recursive: true, force: true }); });

const cover = (text: string) => Buffer.from(text);
const files = async () => (await fs.readdir(directory).catch(() => [] as string[])).filter(name => name.endsWith('.img'));

describe('RemoteCoverCache', () => {
  it('downloads a cover once and serves it from disk after a restart', async () => {
    const fetchCover = vi.fn(async (url: string) => cover(`bytes of ${url}`));
    const first = new RemoteCoverCache(directory, fetchCover);
    expect(await first.get('https://cdn.example/a?param=192y192')).toEqual(cover('bytes of https://cdn.example/a?param=192y192'));
    expect(await first.get('https://cdn.example/a?param=192y192')).toEqual(cover('bytes of https://cdn.example/a?param=192y192'));
    expect(fetchCover).toHaveBeenCalledTimes(1);

    // A new instance stands for the next launch: no network for the same cover.
    const offline = vi.fn(async () => { throw new Error('offline'); });
    const relaunched = new RemoteCoverCache(directory, offline);
    expect(await relaunched.get('https://cdn.example/a?param=192y192')).toEqual(cover('bytes of https://cdn.example/a?param=192y192'));
    expect(offline).not.toHaveBeenCalled();
  });

  it('keeps each size of a cover apart, since the size is part of the URL', async () => {
    const fetchCover = vi.fn(async (url: string) => cover(url));
    const cache = new RemoteCoverCache(directory, fetchCover);
    await cache.get('https://cdn.example/a?param=128y128');
    await cache.get('https://cdn.example/a?param=512y512');
    expect(fetchCover).toHaveBeenCalledTimes(2);
    expect(await files()).toHaveLength(2);
  });

  it('shares one download between concurrent requests', async () => {
    let finish!: (data: Buffer) => void;
    const fetchCover = vi.fn(() => new Promise<Buffer | null>(resolve => { finish = resolve; }));
    const cache = new RemoteCoverCache(directory, fetchCover);
    const requests = [cache.get('https://cdn.example/a'), cache.get('https://cdn.example/a')];
    await vi.waitFor(() => expect(fetchCover).toHaveBeenCalledTimes(1));
    finish(cover('a'));
    expect(await Promise.all(requests)).toEqual([cover('a'), cover('a')]);
  });

  it('keeps nothing when a cover is missing or the download fails, so it is tried again', async () => {
    const fetchCover = vi.fn<(url: string) => Promise<Buffer | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(cover('a'));
    const cache = new RemoteCoverCache(directory, fetchCover);
    expect(await cache.get('https://cdn.example/a')).toBeNull();
    await expect(cache.get('https://cdn.example/a')).rejects.toThrow('timeout');
    expect(await files()).toHaveLength(0);
    expect(await cache.get('https://cdn.example/a')).toEqual(cover('a'));
    expect(fetchCover).toHaveBeenCalledTimes(3);
  });

  it('removes the least recently used covers once past its size limit', async () => {
    const fetchCover = vi.fn(async (url: string) => Buffer.alloc(100, url.at(-1)));
    const cache = new RemoteCoverCache(directory, fetchCover, 350);
    await cache.get('https://cdn.example/a');
    await cache.get('https://cdn.example/b');
    await cache.get('https://cdn.example/c');
    // Mark "a" oldest and "b" newest, then reading "b" keeps it in use.
    const all = await files();
    const ages = await Promise.all(all.map(async name => [name, (await fs.stat(path.join(directory, name))).mtimeMs] as const));
    const byAge = [...ages].sort((x, y) => x[1] - y[1]);
    const past = new Date(Date.now() - 60_000);
    for (const [name] of byAge) await fs.utimes(path.join(directory, name), past, past);
    await cache.get('https://cdn.example/b');

    await cache.get('https://cdn.example/d');
    // 400 bytes > 350: evicted down to at most 280, keeping the recently read and the new cover.
    expect(await files()).toHaveLength(2);
    fetchCover.mockClear();
    await cache.get('https://cdn.example/b');
    await cache.get('https://cdn.example/d');
    expect(fetchCover).not.toHaveBeenCalled();
  });
});
