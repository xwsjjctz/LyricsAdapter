import type { OnlineLyricsResult, OnlineSource } from './onlineMusicProvider';

export const PROVIDER_LYRICS_CACHE_LIMIT = 12;
export const PROVIDER_LYRICS_NEGATIVE_TTL_MS = 60_000;
export const PROVIDER_LYRICS_PARTIAL_TTL_MS = 5 * 60_000;
export const PROVIDER_LYRICS_MAX_CONCURRENT = 4;
export const PROVIDER_LYRICS_MAX_PENDING = 12;

interface CacheEntry {
  value: OnlineLyricsResult | null;
  expiresAt?: number;
}

interface ProviderLyricsCacheOptions {
  maxEntries?: number;
  negativeTtlMs?: number;
  partialTtlMs?: number;
  maxConcurrent?: number;
  maxPending?: number;
  now?: () => number;
}

interface PendingLoad {
  key: string;
  loader: () => Promise<OnlineLyricsResult | null>;
  promise: Promise<OnlineLyricsResult | null>;
  resolve: (value: OnlineLyricsResult | null) => void;
  reject: (reason: unknown) => void;
}

export class ProviderLyricsQueueFullError extends Error {
  constructor() {
    super('Provider lyrics request queue is full');
    this.name = 'ProviderLyricsQueueFullError';
  }
}

/**
 * Small cross-provider LRU for raw QRC/YRC/LRC payloads.
 *
 * Track objects deliberately retain parsed lyrics for only the active
 * three-song window. This cache makes short backtracking instant without
 * allowing provider responses to accumulate for the lifetime of the app;
 * line-only fallbacks expire so a later QRC/YRC upgrade remains possible.
 */
export class ProviderLyricsCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<OnlineLyricsResult | null>>();
  private readonly pendingLoads: PendingLoad[] = [];
  private readonly maxEntries: number;
  private readonly negativeTtlMs: number;
  private readonly partialTtlMs: number;
  private readonly maxConcurrent: number;
  private readonly maxPending: number;
  private readonly now: () => number;
  private activeLoads = 0;

  constructor(options: ProviderLyricsCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? PROVIDER_LYRICS_CACHE_LIMIT);
    this.negativeTtlMs = Math.max(0, options.negativeTtlMs ?? PROVIDER_LYRICS_NEGATIVE_TTL_MS);
    this.partialTtlMs = Math.max(0, options.partialTtlMs ?? PROVIDER_LYRICS_PARTIAL_TTL_MS);
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? PROVIDER_LYRICS_MAX_CONCURRENT);
    this.maxPending = Math.max(0, options.maxPending ?? PROVIDER_LYRICS_MAX_PENDING);
    this.now = options.now ?? Date.now;
  }

  getOrLoad(
    source: OnlineSource,
    songmid: string,
    loader: () => Promise<OnlineLyricsResult | null>,
  ): Promise<OnlineLyricsResult | null> {
    const key = `${source}:${songmid}`;
    const cached = this.read(key);
    if (cached.found) return Promise.resolve(cached.value);

    const existingRequest = this.inFlight.get(key);
    if (existingRequest) return existingRequest;

    let resolve!: (value: OnlineLyricsResult | null) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<OnlineLyricsResult | null>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const task: PendingLoad = { key, loader, promise, resolve, reject };
    this.inFlight.set(key, promise);

    if (this.activeLoads < this.maxConcurrent) {
      this.start(task);
    } else if (this.maxPending === 0) {
      this.drop(task);
    } else {
      if (this.pendingLoads.length >= this.maxPending) {
        const oldest = this.pendingLoads.shift();
        if (oldest) this.drop(oldest);
      }
      this.pendingLoads.push(task);
    }
    return promise;
  }

  private start(task: PendingLoad): void {
    this.activeLoads += 1;
    void Promise.resolve()
      .then(task.loader)
      .then(
        (value) => {
          this.write(task.key, value);
          this.finish(task);
          task.resolve(value);
        },
        (error: unknown) => {
          this.finish(task);
          task.reject(error);
        },
      );
  }

  private finish(task: PendingLoad): void {
    if (this.inFlight.get(task.key) === task.promise) this.inFlight.delete(task.key);
    this.activeLoads -= 1;
    this.startNext();
  }

  private startNext(): void {
    while (this.activeLoads < this.maxConcurrent && this.pendingLoads.length > 0) {
      // Newest requests are most likely to belong to the current FocusMode
      // window. Older queued prefetches still run once interaction settles.
      const next = this.pendingLoads.pop();
      if (next) this.start(next);
    }
  }

  private drop(task: PendingLoad): void {
    if (this.inFlight.get(task.key) === task.promise) this.inFlight.delete(task.key);
    task.reject(new ProviderLyricsQueueFullError());
  }

  private read(key: string): { found: true; value: OnlineLyricsResult | null } | { found: false } {
    const entry = this.entries.get(key);
    if (!entry) return { found: false };

    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return { found: false };
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return { found: true, value: entry.value };
  }

  private write(key: string, value: OnlineLyricsResult | null): void {
    let entry: CacheEntry;
    if (value === null) {
      entry = { value, expiresAt: this.now() + this.negativeTtlMs };
    } else if (!value.wordLyrics) {
      // A provider may temporarily fall back from QRC/YRC to line-only LRC.
      // Keep that fallback warm briefly, then allow a karaoke upgrade retry.
      entry = { value, expiresAt: this.now() + this.partialTtlMs };
    } else {
      entry = { value };
    }
    this.entries.delete(key);
    this.entries.set(key, entry);

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }
}

export const providerLyricsCache = new ProviderLyricsCache();
