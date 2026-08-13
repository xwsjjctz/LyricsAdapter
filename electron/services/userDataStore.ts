/** Compatibility façade over the SQLite user-state repository. */
import { logger } from '../logger';
import { USER_DATA_SCHEMA_VERSION } from '../../src/shared/persistencePolicy';
import { userStateRepository } from './userStateRepository';

export interface UserTrackRecord {
  id: string;
  slotId?: 'local' | 'cloud' | 'online' | 'playlist' | undefined;
  filePath?: string | undefined;
  webdavPath?: string | undefined;
  fileName?: string | undefined;
  fileSize?: number | undefined;
  lastModified?: number | undefined;
  source?: string | undefined;
  addedAt?: string | undefined;
  playCount?: number | undefined;
  lastPlayed?: string | null | undefined;
  songmid?: string | undefined;
  available?: boolean | undefined;
  [key: string]: unknown;
}

export interface UserDataFile {
  schemaVersion: typeof USER_DATA_SCHEMA_VERSION;
  libraryInitialized: boolean;
  tracks: UserTrackRecord[];
  settings: Record<string, string>;
  playback: Record<string, string>;
}

export class UserDataStore {
  load(): UserDataFile {
    return userStateRepository.loadUserData() as UserDataFile;
  }

  save(data: UserDataFile): boolean {
    return this.persist(() => userStateRepository.saveUserData(data));
  }

  saveTracks(tracks: UserTrackRecord[]): boolean {
    return this.persist(() => userStateRepository.saveTracks(tracks));
  }

  saveLibraryState(
    tracks: UserTrackRecord[],
    playback: Record<string, string>,
  ): boolean {
    return this.persist(() => userStateRepository.commitLibraryState(tracks, playback));
  }

  saveSettings(settings: Record<string, string>): boolean {
    return this.persist(() => userStateRepository.saveSettings(settings));
  }

  savePlayback(playback: Record<string, string>): boolean {
    return this.persist(() => userStateRepository.setPlayback(playback));
  }

  getFilePath(): string {
    return userStateRepository.databasePath;
  }

  /** Main initialization now performs the one-time legacy migration. */
  migrateFromLegacy(): void {
    userStateRepository.initialize();
  }

  private persist(operation: () => void): boolean {
    try {
      operation();
      return true;
    } catch (error) {
      logger.error('[UserDataStore] Failed to persist user data:', error);
      return false;
    }
  }
}

export const userDataStore = new UserDataStore();
