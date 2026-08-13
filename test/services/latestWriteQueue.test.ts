import { describe, expect, it, vi } from 'vitest';
import { LatestWriteQueue } from '@/services/latestWriteQueue';

describe('LatestWriteQueue', () => {
  it('collapses scheduled snapshots to the latest value', async () => {
    vi.useFakeTimers();
    const writer = vi.fn(async () => {});
    const queue = new LatestWriteQueue(writer, 1000);

    queue.schedule('old');
    queue.schedule('latest');
    await vi.advanceTimersByTimeAsync(1000);

    expect(writer).toHaveBeenCalledOnce();
    expect(writer).toHaveBeenCalledWith('latest');
    vi.useRealTimers();
  });

  it('serializes writes and drains a value queued during an active write', async () => {
    let release!: () => void;
    const firstGate = new Promise<void>(resolve => { release = resolve; });
    const calls: string[] = [];
    const writer = vi.fn(async (value: string) => {
      calls.push(`start:${value}`);
      if (value === 'first') await firstGate;
      calls.push(`end:${value}`);
    });
    const queue = new LatestWriteQueue(writer, 0);

    queue.schedule('first');
    const draining = queue.drain();
    await Promise.resolve();
    queue.schedule('second');
    release();
    await draining;

    expect(calls).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('puts an immediate write after an older pending snapshot and before future schedules', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const writer = vi.fn(async (value: string) => { calls.push(value); });
    const queue = new LatestWriteQueue(writer, 1000);

    queue.schedule('older-full-snapshot');
    const immediate = queue.enqueue('newer-playback');
    queue.schedule('future-full-snapshot');

    await immediate;
    expect(calls).toEqual(['older-full-snapshot', 'newer-playback']);

    await vi.advanceTimersByTimeAsync(1000);
    await queue.drain();
    expect(calls).toEqual([
      'older-full-snapshot',
      'newer-playback',
      'future-full-snapshot',
    ]);
    vi.useRealTimers();
  });

  it('continues with later writes after a background failure', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const writer = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);
    const queue = new LatestWriteQueue<string>(writer, 100, onError);

    queue.schedule('first');
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    queue.schedule('second');
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();

    expect(onError).toHaveBeenCalledOnce();
    expect(writer).toHaveBeenNthCalledWith(2, 'second');
    vi.useRealTimers();
  });
});
