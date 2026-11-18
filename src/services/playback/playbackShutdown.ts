const PLAYBACK_SHUTDOWN_EVENT = 'lyrics-adapter:shutdown-playback';

interface PlaybackShutdownEventDetail {
  waitUntil: (promise: Promise<unknown>) => void;
}

export const PLAYBACK_SHUTDOWN_SETTLE_MS = 80;

/**
 * Stop the media pipeline synchronously, then keep the renderer alive briefly
 * so the platform audio backend can observe the pause before Chromium tears it
 * down. In particular, the pause must not depend on renderer timers: macOS may
 * throttle them as soon as Cmd+Q starts application shutdown.
 */
export function pauseAudioBeforeShutdown(
  audio: HTMLAudioElement | null,
  settleMs = PLAYBACK_SHUTDOWN_SETTLE_MS,
): Promise<void> {
  if (!audio) return Promise.resolve();

  // Calling pause even when `paused` currently reads true also cancels a
  // pending play() promise before it can activate the output device.
  audio.pause();
  audio.volume = 0;

  if (settleMs <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, settleMs));
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
