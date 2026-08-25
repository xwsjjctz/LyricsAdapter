import { afterEach, describe, expect, it, vi } from 'vitest';
import { fadeOutAndPauseAudio } from '@/services/playbackShutdown';

describe('fadeOutAndPauseAudio', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reaches silence before pausing the media pipeline', async () => {
    vi.useFakeTimers();
    let paused = false;
    const pause = vi.fn(() => { paused = true; });
    const audio = {
      get paused() { return paused; },
      volume: 0.8,
      pause,
    } as unknown as HTMLAudioElement;

    const shutdown = fadeOutAndPauseAudio(audio, 80);
    vi.advanceTimersByTime(40);
    expect(audio.volume).toBeGreaterThan(0);
    expect(pause).not.toHaveBeenCalled();

    vi.advanceTimersByTime(40);
    await shutdown;

    expect(audio.volume).toBe(0);
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
