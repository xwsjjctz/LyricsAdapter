import { afterEach, describe, expect, it, vi } from 'vitest';
import { addLibraryFlushListener, requestLibraryFlush } from '@/services/libraryFlushEvent';

describe('libraryFlushEvent', () => {
  const cleanup: Array<() => void> = [];

  afterEach(() => {
    while (cleanup.length > 0) {
      cleanup.pop()?.();
    }
  });

  it('waits for registered flush promises', async () => {
    const flush = vi.fn().mockResolvedValue(true);
    cleanup.push(addLibraryFlushListener(flush));

    await expect(requestLibraryFlush()).resolves.toBe(true);

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('returns false when a registered flush fails', async () => {
    cleanup.push(addLibraryFlushListener(() => Promise.resolve(false)));

    await expect(requestLibraryFlush()).resolves.toBe(false);
  });

  it('returns true when no listener is registered', async () => {
    await expect(requestLibraryFlush()).resolves.toBe(true);
  });
});
