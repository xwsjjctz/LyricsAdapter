import { afterEach, describe, expect, it, vi } from 'vitest';
import { pauseAudioBeforeShutdown } from '@/services/playbackShutdown';

describe('pauseAudioBeforeShutdown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mutes and pauses synchronously before waiting for the audio backend to settle', async () => {
    vi.useFakeTimers();
    let paused = false;
    const pause = vi.fn(() => { paused = true; });
    const audio = {
      get paused() { return paused; },
      volume: 0.8,
      pause,
    } as unknown as HTMLAudioElement;

    let settled = false;
    const shutdown = pauseAudioBeforeShutdown(audio, 80).then(() => { settled = true; });

    expect(audio.volume).toBe(0);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(80);
    await shutdown;

    expect(settled).toBe(true);
  });
});
