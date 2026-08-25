const PLAYBACK_SHUTDOWN_EVENT = 'lyrics-adapter:shutdown-playback';

interface PlaybackShutdownEventDetail {
  waitUntil: (promise: Promise<unknown>) => void;
}

export const PLAYBACK_SHUTDOWN_FADE_MS = 80;

export function fadeOutAndPauseAudio(
  audio: HTMLAudioElement | null,
  durationMs = PLAYBACK_SHUTDOWN_FADE_MS,
): Promise<void> {
  if (!audio || audio.paused) return Promise.resolve();

  const initialVolume = audio.volume;
  if (initialVolume <= 0 || durationMs <= 0) {
    audio.volume = 0;
    audio.pause();
    return Promise.resolve();
  }

  const stepCount = Math.max(1, Math.ceil(durationMs / 10));
  const stepDuration = durationMs / stepCount;

  return new Promise(resolve => {
    let currentStep = 0;

    const applyNextStep = () => {
      currentStep += 1;
      const progress = Math.min(1, currentStep / stepCount);
      audio.volume = Math.max(0, initialVolume * (1 - progress));

      if (progress >= 1) {
        audio.volume = 0;
        audio.pause();
        resolve();
        return;
      }

      setTimeout(applyNextStep, stepDuration);
    };

    setTimeout(applyNextStep, stepDuration);
  });
}

export function requestPlaybackShutdown(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  const pendingStops: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent<PlaybackShutdownEventDetail>(PLAYBACK_SHUTDOWN_EVENT, {
    detail: {
      waitUntil: promise => pendingStops.push(promise),
    },
  }));

  if (pendingStops.length === 0) return Promise.resolve();

  return Promise.allSettled(pendingStops).then(() => undefined);
}

export function addPlaybackShutdownListener(stop: () => Promise<void>): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<PlaybackShutdownEventDetail>).detail;
    detail?.waitUntil(stop());
  };

  window.addEventListener(PLAYBACK_SHUTDOWN_EVENT, handler);
  return () => window.removeEventListener(PLAYBACK_SHUTDOWN_EVENT, handler);
}
