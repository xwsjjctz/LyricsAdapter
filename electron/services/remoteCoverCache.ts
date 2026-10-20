import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { logger } from '../logger';

/** Directory under userData holding remote cover bytes. */
export const REMOTE_COVER_CACHE_DIR = 'remote-covers';
/** Past this the least recently used covers are removed. */
export const REMOTE_COVER_CACHE_BYTES = 200 * 1024 * 1024;
/** Eviction stops here, so a full cache is not swept again on every write. */
const EVICT_TO_RATIO = 0.8;
const SUFFIX = '.img';
const TEMPORARY_SUFFIX = '.tmp';

/** Downloads one cover; null when it is missing or not an image (never cached). */
export type FetchCover = (url: string) => Promise<Buffer | null>;

interface Entry { file: string; size: number; used: number }

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * Remote cover bytes by URL on disk, so covers shown by native surfaces (command
 * palette, playlist switcher, control bar) load without the network after a restart.
 * A cover URL names one image at one size (online CDNs carry the size in the URL),
 * so entries never go stale; space is bounded by evicting the least recently used.
 */
export class RemoteCoverCache {
  private readonly pending = new Map<string, Promise<Buffer | null>>();
  /** Bytes on disk, scanned on first write. */
  private usage: Promise<number> | null = null;
  /** Writes run one at a time, so the byte count stays exact. */
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly directory: string,
    private readonly fetchCover: FetchCover,
    private readonly maxBytes = REMOTE_COVER_CACHE_BYTES,
  ) {}

  /** The cover from disk, or downloaded and kept; concurrent requests share one download. */
  get(url: string): Promise<Buffer | null> {
    const existing = this.pending.get(url);
    if (existing) return existing;
    const request = this.load(url).finally(() => this.pending.delete(url));
    this.pending.set(url, request);
    return request;
  }

  /** How many covers are kept and the space they take. */
  async info(): Promise<{ entries: number; bytes: number }> {
    await this.writes;
    const entries = await this.scan();
    return { entries: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.size, 0) };
  }

  /** Removes every kept cover after pending writes; covers download again when next shown. */
  clear(): Promise<void> {
    const cleared = this.writes.then(async () => {
      await fs.rm(this.directory, { recursive: true, force: true });
      this.usage = Promise.resolve(0);
    });
    this.writes = cleared.catch(() => undefined);
    return cleared;
  }

  private file(url: string): string {
    return path.join(this.directory, `${createHash('sha256').update(url).digest('hex')}${SUFFIX}`);
  }

  private async load(url: string): Promise<Buffer | null> {
    const file = this.file(url);
    const cached = await this.read(file);
    if (cached) return cached;
    const data = await this.fetchCover(url);
    if (data?.byteLength) {
      // A cover that cannot be kept is still shown.
      const write = this.writes.then(() => this.store(file, data));
      this.writes = write.catch(() => undefined);
      await write.catch(error => logger.warn('[RemoteCoverCache] Could not keep cover:', error));
    }
    return data;
  }

  private async read(file: string): Promise<Buffer | null> {
    try {
      const data = await fs.readFile(file);
      if (!data.byteLength) return null;
      // The modification time records use, for eviction.
      const now = new Date();
      await fs.utimes(file, now, now).catch(() => undefined);
      return data;
    } catch (error) {
      if (!isNotFound(error)) logger.warn('[RemoteCoverCache] Could not read cover:', error);
      return null;
    }
  }

  private async store(file: string, data: Buffer): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    // Counted before the new cover lands, so the first scan does not include it.
    const before = await this.totalBytes();
    // Renamed into place, so a crash never leaves a partial cover behind.
    const temporary = `${file}.${randomUUID()}${TEMPORARY_SUFFIX}`;
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, file);
    const total = before + data.byteLength;
    this.usage = Promise.resolve(total);
    if (total > this.maxBytes) await this.evict();
  }

  private totalBytes(): Promise<number> {
    this.usage ??= this.scan().then(entries => entries.reduce((sum, entry) => sum + entry.size, 0));
    return this.usage;
  }

  private async scan(): Promise<Entry[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.directory);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const entries = await Promise.all(names.filter(name => name.endsWith(SUFFIX)).map(async name => {
      const file = path.join(this.directory, name);
      try {
        const stat = await fs.stat(file);
        return { file, size: stat.size, used: stat.mtimeMs };
      } catch {
        return null;
      }
    }));
    return entries.filter((entry): entry is Entry => entry !== null);
  }

  private async evict(): Promise<void> {
    const entries = (await this.scan()).sort((a, b) => a.used - b.used);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    const target = this.maxBytes * EVICT_TO_RATIO;
    for (const entry of entries) {
      if (total <= target) break;
      await fs.rm(entry.file, { force: true });
      total -= entry.size;
    }
    this.usage = Promise.resolve(total);
  }
}
