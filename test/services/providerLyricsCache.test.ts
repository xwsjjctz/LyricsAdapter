import { describe, expect, it, vi } from 'vitest';
import {
  ProviderLyricsCache,
  ProviderLyricsQueueFullError,
} from '@/services/providerLyricsCache';
import type { OnlineLyricsResult } from '@/services/onlineMusicProvider';

const lyrics = (text: string): OnlineLyricsResult => ({ lyrics: text });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('ProviderLyricsCache', () => {
  it('evicts the least recently used entry across all providers', async () => {
    const cache = new ProviderLyricsCache({ maxEntries: 2 });
    const loadA = vi.fn(async () => lyrics('a'));
    const loadB = vi.fn(async () => lyrics('b'));
    const loadC = vi.fn(async () => lyrics('c'));

    await cache.getOrLoad('qq', 'a', loadA);
    await cache.getOrLoad('netease', 'b', loadB);
    await cache.getOrLoad('qq', 'a', loadA);
    await cache.getOrLoad('qq', 'c', loadC);
    await cache.getOrLoad('netease', 'b', loadB);

    expect(loadA).toHaveBeenCalledTimes(1);
    expect(loadB).toHaveBeenCalledTimes(2);
    expect(loadC).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight request with concurrent consumers', async () => {
    const cache = new ProviderLyricsCache();
    const pending = deferred<OnlineLyricsResult | null>();
    const loader = vi.fn(() => pending.promise);

    const first = cache.getOrLoad('qq', 'same-song', loader);
    const second = cache.getOrLoad('qq', 'same-song', loader);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);

    pending.resolve(lyrics('shared'));
    await expect(first).resolves.toEqual(lyrics('shared'));
    await expect(second).resolves.toEqual(lyrics('shared'));
  });

  it('bounds active and queued loads while prioritizing the newest window', async () => {
    const cache = new ProviderLyricsCache({ maxConcurrent: 2, maxPending: 2 });
    const pending = new Map(['a', 'b', 'c', 'd', 'e'].map(key => [
      key,
      deferred<OnlineLyricsResult | null>(),
    ]));
    const loaders = new Map([...pending].map(([key, request]) => [
      key,
      vi.fn(() => request.promise),
    ]));
    const load = (key: string) => cache.getOrLoad('qq', key, loaders.get(key)!);

    const first = load('a');
    const second = load('b');
    const thirdOutcome = load('c').catch(error => error as Error);
    const fourth = load('d');
    const fifth = load('e');
    await Promise.resolve();
    expect(loaders.get('a')).toHaveBeenCalledTimes(1);
    expect(loaders.get('b')).toHaveBeenCalledTimes(1);
    expect(loaders.get('c')).not.toHaveBeenCalled();
    expect(loaders.get('d')).not.toHaveBeenCalled();
    expect(loaders.get('e')).not.toHaveBeenCalled();
    await expect(thirdOutcome).resolves.toBeInstanceOf(ProviderLyricsQueueFullError);

    pending.get('a')!.resolve(lyrics('a'));
    await first;
    await Promise.resolve();
    await Promise.resolve();
    expect(loaders.get('e')).toHaveBeenCalledTimes(1);

    pending.get('b')!.resolve(lyrics('b'));
    await second;
    await Promise.resolve();
    await Promise.resolve();
    expect(loaders.get('d')).toHaveBeenCalledTimes(1);

    pending.get('d')!.resolve(lyrics('d'));
    pending.get('e')!.resolve(lyrics('e'));
    await expect(fourth).resolves.toEqual(lyrics('d'));
    await expect(fifth).resolves.toEqual(lyrics('e'));
  });

  it('retries after a rejected request instead of caching the failure', async () => {
    const cache = new ProviderLyricsCache();
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(lyrics('recovered'));

    await expect(cache.getOrLoad('netease', 'retry', loader)).rejects.toThrow('temporary failure');
    await expect(cache.getOrLoad('netease', 'retry', loader)).resolves.toEqual(lyrics('recovered'));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('expires a no-lyrics result so transient empty responses can recover', async () => {
    let now = 1_000;
    const cache = new ProviderLyricsCache({ negativeTtlMs: 60_000, now: () => now });
    const loader = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(lyrics('available later'));

    await expect(cache.getOrLoad('netease', 'eventual', loader)).resolves.toBeNull();
    now += 59_999;
    await expect(cache.getOrLoad('netease', 'eventual', loader)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);

    now += 1;
    await expect(cache.getOrLoad('netease', 'eventual', loader)).resolves.toEqual(lyrics('available later'));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keeps identical song ids isolated by provider', async () => {
    const cache = new ProviderLyricsCache();
    const loadQQ = vi.fn(async () => lyrics('qq lyrics'));
    const loadNetEase = vi.fn(async () => lyrics('netease lyrics'));

    await expect(cache.getOrLoad('qq', 'same-id', loadQQ)).resolves.toEqual(lyrics('qq lyrics'));
    await expect(cache.getOrLoad('netease', 'same-id', loadNetEase)).resolves.toEqual(lyrics('netease lyrics'));
    await expect(cache.getOrLoad('qq', 'same-id', loadQQ)).resolves.toEqual(lyrics('qq lyrics'));
    await expect(cache.getOrLoad('netease', 'same-id', loadNetEase)).resolves.toEqual(lyrics('netease lyrics'));
    expect(loadQQ).toHaveBeenCalledTimes(1);
    expect(loadNetEase).toHaveBeenCalledTimes(1);
  });

  it('expires line-only fallbacks but retains complete word-timed lyrics', async () => {
    let now = 1_000;
    const cache = new ProviderLyricsCache({ partialTtlMs: 300_000, now: () => now });
    const loadPartial = vi.fn()
      .mockResolvedValueOnce(lyrics('line only'))
      .mockResolvedValueOnce({ lyrics: 'line', wordLyrics: 'word timing', wordLyricsFormat: 'qrc' });

    await cache.getOrLoad('qq', 'upgrade', loadPartial);
    now += 300_000;
    await expect(cache.getOrLoad('qq', 'upgrade', loadPartial)).resolves.toMatchObject({
      wordLyrics: 'word timing',
    });
    now += 300_000;
    await cache.getOrLoad('qq', 'upgrade', loadPartial);
    expect(loadPartial).toHaveBeenCalledTimes(2);
  });
});
