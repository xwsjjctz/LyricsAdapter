import type {
  IpcResult,
  PersistenceBootstrap,
  StoreRead,
  UserDataSnapshot,
} from '../../src/types/typedIpc';
import { doLoadLibraryIndex } from '../ipc/core/libraryCore';
import { settingsStore } from './settingsStore';
import { userDataStore } from './userDataStore';
import { libraryIndexSnapshotSchema } from '../../src/shared/libraryIndexSchema';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PersistenceRepositoryDependencies {
  loadSettings: () => Record<string, string>;
  loadUserData: () => UserDataSnapshot;
  loadLibraryIndex: () => Promise<IpcResult<unknown>>;
}

/**
 * Main-process read facade for application bootstrap.
 *
 * The three physical stores intentionally remain independent. A failure in one
 * source is represented in that source's StoreRead and does not reject or hide
 * the remaining data.
 */
export class PersistenceRepository {
  constructor(private readonly dependencies: PersistenceRepositoryDependencies) {}

  async loadBootstrap(): Promise<PersistenceBootstrap> {
    const settings = this.readSync(this.dependencies.loadSettings);
    const userData = this.readSync(this.dependencies.loadUserData);
    const libraryIndex = await this.readLibraryIndex();
    return { settings, userData, libraryIndex };
  }

  private readSync<T>(load: () => T): StoreRead<T> {
    try {
      return { status: 'ready', data: load() };
    } catch (error) {
      return { status: 'error', error: errorMessage(error) };
    }
  }

  private async readLibraryIndex(): Promise<StoreRead<unknown>> {
    try {
      const result = await this.dependencies.loadLibraryIndex();
      if (!result.ok) return { status: 'error', error: result.error };

      const parsed = libraryIndexSnapshotSchema.safeParse(result.data);
      return parsed.success
        ? { status: 'ready', data: result.data }
        : { status: 'error', error: `Invalid library index: ${parsed.error.message}` };
    } catch (error) {
      return { status: 'error', error: errorMessage(error) };
    }
  }
}

export const persistenceRepository = new PersistenceRepository({
  loadSettings: () => settingsStore.getAll(),
  loadUserData: () => userDataStore.load(),
  loadLibraryIndex: () => doLoadLibraryIndex(),
});
