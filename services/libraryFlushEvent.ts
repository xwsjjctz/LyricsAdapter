export const LIBRARY_FLUSH_EVENT = 'lyrics-adapter:flush-library';

interface LibraryFlushEventDetail {
  waitUntil: (promise: Promise<unknown>) => void;
}

export function requestLibraryFlush(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(true);

  const pendingFlushes: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent<LibraryFlushEventDetail>(LIBRARY_FLUSH_EVENT, {
    detail: {
      waitUntil: (promise) => pendingFlushes.push(promise),
    },
  }));

  if (pendingFlushes.length === 0) return Promise.resolve(true);

  return Promise.allSettled(pendingFlushes).then(results =>
    results.every(result => result.status === 'fulfilled' && result.value !== false)
  );
}

export function addLibraryFlushListener(flush: () => Promise<boolean>): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<LibraryFlushEventDetail>).detail;
    detail?.waitUntil(flush());
  };

  window.addEventListener(LIBRARY_FLUSH_EVENT, handler);
  return () => window.removeEventListener(LIBRARY_FLUSH_EVENT, handler);
}
