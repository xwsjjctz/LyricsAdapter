import { appStorage } from '../services/appStorage';
import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { libraryStorage, type LibraryIndexData } from '../services/libraryStorage';
import { logger } from '../services/logger';
import type { UserTrackRecord } from '../services/librarySerializer';
import type { PersistenceCloseCommitRequest } from '../types/typedIpc';

export interface LibraryCloseSnapshot {
  libraryIndex: LibraryIndexData;
  userTracks: UserTrackRecord[];
  userDataWritable: boolean;
}

type CloseDesktopAPI = Awaited<ReturnType<typeof getDesktopAPIAsync>>;

function toCommitRequest(snapshot: LibraryCloseSnapshot): PersistenceCloseCommitRequest {
  return {
    libraryIndex: snapshot.libraryIndex,
    userData: snapshot.userDataWritable
      ? { mode: 'write', tracks: snapshot.userTracks }
      : { mode: 'skip' },
  };
}

async function commitLegacy(
  snapshot: LibraryCloseSnapshot,
  desktop: boolean,
  api: CloseDesktopAPI,
): Promise<boolean> {
  const playbackJson = JSON.stringify(snapshot.libraryIndex.settings);
  let playbackSaved = true;
  let userDataSaved = true;

  try {
    await appStorage.setItem('playback', playbackJson);
  } catch (error) {
    playbackSaved = false;
    logger.warn('[LibraryClosePersistenceRepository] Failed to flush playback settings:', error);
  }

  if (desktop && snapshot.userDataWritable) {
    try {
      if (!api?.userDataSaveLibraryState) {
        throw new Error('User-data state API unavailable');
      }
      await api.userDataSaveLibraryState(
        snapshot.userTracks,
        { _json: playbackJson },
      );
    } catch (error) {
      userDataSaved = false;
      logger.warn('[LibraryClosePersistenceRepository] Failed to flush user data:', error);
    }
  } else if (desktop) {
    // Preserve the existing close contract: recovery mode may persist the
    // replaceable stores, but closing remains blocked until users.json is safe.
    userDataSaved = false;
  }

  const libraryIndexSaved = await libraryStorage.flushPendingSave(snapshot.libraryIndex);
  return playbackSaved && userDataSaved && libraryIndexSaved;
}

class LibraryClosePersistenceRepository {
  async commit(snapshot: LibraryCloseSnapshot): Promise<boolean> {
    const desktop = isDesktop();
    let api: CloseDesktopAPI = null;

    if (desktop) {
      try {
        api = await getDesktopAPIAsync();
        if (api?.persistenceCommitClose) {
          try {
            const result = await api.persistenceCommitClose(toCommitRequest(snapshot));
            // A normal partial result is authoritative. Falling back here could
            // hide its per-store failure and turn one close into two commits.
            if (!result.fullyPersisted) {
              logger.warn('[LibraryClosePersistenceRepository] Final close commit was partial:', result);
            }
            return result.fullyPersisted;
          } catch (error) {
            // One-release compatibility for a new renderer paired with a stale
            // preload/main, and recovery from an outer IPC handler rejection.
            logger.warn(
              '[LibraryClosePersistenceRepository] Unified close commit unavailable; using legacy writes:',
              error,
            );
          }
        }
      } catch (error) {
        logger.warn(
          '[LibraryClosePersistenceRepository] Desktop API unavailable; using legacy writes:',
          error,
        );
      }
    }

    return commitLegacy(snapshot, desktop, api);
  }
}

export const libraryClosePersistenceRepository = new LibraryClosePersistenceRepository();
