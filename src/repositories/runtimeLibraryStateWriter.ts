import { appStorage } from '../services/appStorage';
import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { LatestWriteQueue } from '../services/latestWriteQueue';
import type { buildMinimalTracks } from '../services/librarySerializer';
import { logger } from '../services/logger';

type MinimalTracks = ReturnType<typeof buildMinimalTracks>;

/**
 * Runtime (non-close) persistence of library membership and playback. The
 * platform difference lives here so the library hooks stay platform-neutral:
 *
 * - Desktop: membership and playback share one serial SQLite queue, so a
 *   lightweight progress write can never be overwritten by an older snapshot.
 *   The awaited native close handshake triggers the final commit.
 * - Browser: membership is kept in the library index (IndexedDB) and playback
 *   in AppStorage; `beforeunload` is the best-effort close trigger.
 */
export interface RuntimeLibraryStateWriter {
  /** Schedules membership + playback. `userDataWritable` is false while desktop recovery blocks SQLite writes. */
  saveLibrary(tracks: MinimalTracks, playbackJson: string, userDataWritable: boolean): void;
  savePlayback(playbackJson: string): Promise<void>;
  /** Waits for queued writes before the final close snapshot is captured. */
  drain(): Promise<void>;
  cancel(): void;
  /** Registers the platform's close trigger for the final commit; returns the remover. */
  onUnload(flush: () => void): () => void;
}

type QueuedWrite =
  | { kind: 'library'; tracks: MinimalTracks; playback: Record<string, string> }
  | { kind: 'playback'; playbackJson: string };

function createDesktopWriter(): RuntimeLibraryStateWriter {
  const queue = new LatestWriteQueue<QueuedWrite>(
    async snapshot => {
      if (snapshot.kind === 'playback') {
        await appStorage.setItem('playback', snapshot.playbackJson);
        return;
      }
      const api = await getDesktopAPIAsync();
      if (!api?.userDataSaveLibraryState) throw new Error('Desktop user-state API is unavailable');
      await api.userDataSaveLibraryState(snapshot.tracks, snapshot.playback);
    },
    1000,
    error => logger.warn('[RuntimeLibraryState] Failed to persist runtime user state:', error),
  );
  return {
    saveLibrary(tracks, playbackJson, userDataWritable) {
      // Never write playback outside the SQLite transaction on desktop.
      if (userDataWritable) queue.schedule({ kind: 'library', tracks, playback: { _json: playbackJson } });
    },
    savePlayback: playbackJson => queue.enqueue({ kind: 'playback', playbackJson }),
    drain: () => queue.drain(),
    cancel: () => queue.cancel(),
    onUnload: () => () => {},
  };
}

function createBrowserWriter(): RuntimeLibraryStateWriter {
  const savePlayback = (playbackJson: string) => appStorage.setItem('playback', playbackJson);
  return {
    saveLibrary(_tracks, playbackJson) {
      savePlayback(playbackJson).catch(() => {});
    },
    savePlayback,
    drain: async () => {},
    cancel: () => {},
    onUnload(flush) {
      const handler = () => flush();
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    },
  };
}

export function createRuntimeLibraryStateWriter(): RuntimeLibraryStateWriter {
  return isDesktop() ? createDesktopWriter() : createBrowserWriter();
}
