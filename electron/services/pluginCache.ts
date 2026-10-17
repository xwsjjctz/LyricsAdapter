import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../src/shared/plugin';

/** Long enough for a SHA-256 track id plus a short prefix or suffix. */
export const PLUGIN_CACHE_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/;
export const PLUGIN_CACHE_VALUE_LIMIT = 1_048_576;
const SUFFIX = '.json';

function checkKey(key: string): void {
  if (typeof key !== 'string' || !PLUGIN_CACHE_KEY.test(key) || key.includes('..')) throw new Error('Invalid plugin cache key');
}

/**
 * One plugin's cache: a JSON file per key in its data directory, or memory when the
 * host has no directory (tests and tooling). Writes replace files atomically, so a
 * crash leaves either the old or the new value.
 */
export class PluginCacheStore {
  private readonly memory = new Map<string, string>();
  constructor(private readonly directory?: string) {}

  private file(key: string): string { return path.join(this.directory!, `${key}${SUFFIX}`); }

  async get(key: string): Promise<JsonValue | undefined> {
    checkKey(key);
    let text: string | undefined;
    if (!this.directory) text = this.memory.get(key);
    else {
      try { text = await fs.readFile(this.file(key), 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    }
    if (text === undefined) return undefined;
    try { return JSON.parse(text) as JsonValue; } catch { await this.delete(key); return undefined; }
  }

  async set(key: string, value: JsonValue): Promise<void> {
    checkKey(key);
    const json = JSON.stringify(value);
    if (json === undefined || Buffer.byteLength(json) > PLUGIN_CACHE_VALUE_LIMIT) throw new Error('Plugin cache value exceeds 1 MiB or is not JSON');
    if (!this.directory) { this.memory.set(key, json); return; }
    await fs.mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, json, 'utf8');
      await fs.rename(temporary, this.file(key));
    } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
  }

  async delete(key: string): Promise<void> {
    checkKey(key);
    if (!this.directory) { this.memory.delete(key); return; }
    await fs.rm(this.file(key), { force: true });
  }

  async clear(): Promise<void> {
    if (!this.directory) { this.memory.clear(); return; }
    await clearPluginCacheDirectory(this.directory);
  }
}

/** Removes cache entries and abandoned temporary files, keeping the directory itself. */
export async function clearPluginCacheDirectory(directory: string): Promise<void> {
  let names: string[];
  try { names = await fs.readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  await Promise.all(names.filter(name => name.endsWith(SUFFIX) || name.endsWith('.tmp'))
    .map(name => fs.rm(path.join(directory, name), { force: true })));
}

export async function pluginCacheStats(directory: string): Promise<{ entries: number; bytes: number }> {
  let names: string[];
  try { names = await fs.readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: 0, bytes: 0 }; throw error; }
  const sizes = await Promise.all(names.filter(name => name.endsWith(SUFFIX))
    .map(name => fs.stat(path.join(directory, name)).then(stat => stat.size, () => 0)));
  return { entries: sizes.length, bytes: sizes.reduce((total, size) => total + size, 0) };
}
