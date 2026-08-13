import type {
  IpcResult,
  PersistenceCloseCommitRequest,
  PersistenceCloseCommitResult,
  PersistenceWriteOutcome,
} from '../../src/types/typedIpc';
import { filterPublicSettings } from '../../src/shared/persistencePolicy';
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
  loadSettings: () => Record<string, string>;
  saveUserLibraryState: (
    tracks: UserTrackRecord[],
    playback: Record<string, string>,
    settings?: Record<string, string>,
  ) => boolean;
  saveLibraryIndex: (libraryIndex: unknown) => Promise<IpcResult<void>>;
}

/**
 * Main-process use-case for the final close snapshot.
 *
 * Physical stores are intentionally not transactional with each other. Each
 * write is atomic on its own, every source is attempted in order, and callers
 * receive all outcomes so a partial commit is never hidden by the IPC envelope.
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
    try {
      settings = this.dependencies.savePlayback(playbackJson)
        ? saved()
        : failed('Failed to persist playback settings');
    } catch (error) {
      settings = failed(error);
    }

    let userData: PersistenceWriteOutcome;
    if (request.userData.mode === 'skip') {
      userData = { status: 'skipped', reason: 'User-data writes disabled for this close attempt' };
    } else {
      // A damaged settings source must not prevent membership/playback from
      // reaching users.json. Omitting settings preserves the existing snapshot.
      let publicSettings: Record<string, string> | undefined;
      try {
        publicSettings = filterPublicSettings(this.dependencies.loadSettings());
      } catch {
        publicSettings = undefined;
      }

      try {
        userData = this.dependencies.saveUserLibraryState(
          request.userData.tracks as UserTrackRecord[],
          { _json: playbackJson },
          publicSettings,
        )
          ? saved()
          : failed('Failed to persist user library state');
      } catch (error) {
        userData = failed(error);
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
  loadSettings: () => settingsStore.getAll(),
  saveUserLibraryState: (tracks, playback, settings) => (
    userDataStore.saveLibraryState(tracks, playback, settings)
  ),
  saveLibraryIndex: libraryIndex => doSaveLibraryIndex(libraryIndex),
});
