import type {
  IpcResult,
  PersistenceCloseCommitRequest,
  PersistenceCloseCommitResult,
  PersistenceWriteOutcome,
} from '../../src/types/typedIpc';
import { doSaveLibraryIndex } from '../ipc/core/libraryCore';
import { settingsStore } from './settingsStore';
import { userDataStore, type UserTrackRecord } from './userDataStore';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const saved = (): PersistenceWriteOutcome => ({ status: 'saved' });
const failed = (error: unknown): PersistenceWriteOutcome => ({
  status: 'error',
  error: errorMessage(error),
});

export interface PersistenceCommitDependencies {
  savePlayback: (playbackJson: string) => boolean;
  saveUserLibraryState: (
    tracks: UserTrackRecord[],
    playback: Record<string, string>,
  ) => boolean;
  saveLibraryIndex: (libraryIndex: unknown) => Promise<IpcResult<void>>;
}

/**
 * Main-process use-case for the final close snapshot.
 *
 * User-owned settings, membership and playback are committed in one SQLite
 * transaction. The replaceable library index is written last and remains an
 * independent cache, so a cache failure never rolls back authoritative state.
 */
export class PersistenceCommitService {
  private inFlight: Promise<PersistenceCloseCommitResult> | null = null;

  constructor(private readonly dependencies: PersistenceCommitDependencies) {}

  commitClose(request: PersistenceCloseCommitRequest): Promise<PersistenceCloseCommitResult> {
    // A close attempt has one final commit. Concurrent callers share it even if
    // they captured different renderer snapshots.
    if (this.inFlight) return this.inFlight;

    const commit = this.runCommit(request).finally(() => {
      if (this.inFlight === commit) this.inFlight = null;
    });
    this.inFlight = commit;
    return commit;
  }

  private async runCommit(
    request: PersistenceCloseCommitRequest,
  ): Promise<PersistenceCloseCommitResult> {
    const settingsValue = (
      request.libraryIndex as { settings?: unknown }
    ).settings;
    const playbackJson = JSON.stringify(settingsValue);

    let settings: PersistenceWriteOutcome;
    let userData: PersistenceWriteOutcome;
    if (request.userData.mode === 'skip') {
      // Preserve the fail-closed compatibility path: do not touch membership,
      // but still attempt the standalone playback update as older builds did.
      try {
        settings = this.dependencies.savePlayback(playbackJson)
          ? saved()
          : failed('Failed to persist playback settings');
      } catch (error) {
        settings = failed(error);
      }
      userData = { status: 'skipped', reason: 'User-data writes disabled for this close attempt' };
    } else {
      try {
        const committed = this.dependencies.saveUserLibraryState(
          request.userData.tracks as UserTrackRecord[],
          { _json: playbackJson },
        );
        const outcome = committed
          ? saved()
          : failed('Failed to persist authoritative user state');
        settings = outcome;
        userData = outcome;
      } catch (error) {
        const outcome = failed(error);
        settings = outcome;
        userData = outcome;
      }
    }

    let libraryIndex: PersistenceWriteOutcome;
    try {
      const result = await this.dependencies.saveLibraryIndex(request.libraryIndex);
      libraryIndex = result.ok ? saved() : failed(result.error);
    } catch (error) {
      libraryIndex = failed(error);
    }

    const outcomes = [settings, userData, libraryIndex];
    return {
      fullyPersisted: outcomes.every(outcome => outcome.status === 'saved'),
      settings,
      userData,
      libraryIndex,
    };
  }
}

export const persistenceCommitService = new PersistenceCommitService({
  savePlayback: playbackJson => settingsStore.set('playback', playbackJson),
  saveUserLibraryState: (tracks, playback) => (
    userDataStore.saveLibraryState(tracks, playback)
  ),
  saveLibraryIndex: libraryIndex => doSaveLibraryIndex(libraryIndex),
});
