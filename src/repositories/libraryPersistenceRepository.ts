import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { libraryStorage } from '../services/libraryStorage';
import type { LibraryIndexData } from '../services/libraryStorage';
import { logger } from '../services/logger';
import type { PersistenceBootstrap, StoreRead, UserDataSnapshot } from '../types/typedIpc';
import { libraryIndexSnapshotSchema } from '../shared/libraryIndexSchema';

export interface LibraryPersistenceBootstrapResult {
  desktop: boolean;
  libraryData: LibraryIndexData;
  settingsResult: PromiseSettledResult<Record<string, string>>;
  userDataResult: PromiseSettledResult<UserDataSnapshot>;
}

const unavailable = (message: string): PromiseRejectedResult => ({
  status: 'rejected',
  reason: new Error(message),
});

function toSettledResult<T>(read: StoreRead<T>): PromiseSettledResult<T> {
  return read.status === 'ready'
    ? { status: 'fulfilled', value: read.data }
    : unavailable(read.error);
}

function toLibraryData(read: StoreRead<unknown>): LibraryIndexData {
  if (read.status === 'error') {
    logger.warn('[LibraryPersistenceRepository] Failed to load library index:', read.error);
    return { songs: [], settings: {} };
  }
  const parsed = libraryIndexSnapshotSchema.safeParse(read.data);
  if (!parsed.success) {
    logger.warn('[LibraryPersistenceRepository] Ignoring invalid library index:', parsed.error.message);
    return { songs: [], settings: {} };
  }
  return read.data as LibraryIndexData;
}

function fromUnifiedBootstrap(bootstrap: PersistenceBootstrap): LibraryPersistenceBootstrapResult {
  return {
    desktop: true,
    libraryData: toLibraryData(bootstrap.libraryIndex),
    settingsResult: toSettledResult(bootstrap.settings),
    userDataResult: toSettledResult(bootstrap.userData),
  };
}

type PersistenceDesktopAPI = Awaited<ReturnType<typeof getDesktopAPIAsync>>;

async function loadLegacyDesktopBootstrap(
  apiResult?: PromiseSettledResult<PersistenceDesktopAPI>,
): Promise<LibraryPersistenceBootstrapResult> {
  const resolvedApi = apiResult ?? await Promise.resolve(getDesktopAPIAsync()).then(
    value => ({ status: 'fulfilled', value }) satisfies PromiseFulfilledResult<PersistenceDesktopAPI>,
    reason => ({ status: 'rejected', reason }) satisfies PromiseRejectedResult,
  );
  const libraryDataPromise = libraryStorage.loadLibrary();

  if (resolvedApi.status === 'rejected') {
    const libraryData = await libraryDataPromise;
    return {
      desktop: true,
      libraryData,
      settingsResult: { status: 'rejected', reason: resolvedApi.reason },
      userDataResult: { status: 'rejected', reason: resolvedApi.reason },
    };
  }

  const api = resolvedApi.value;
  const [libraryData, persistenceResults] = await Promise.all([
    libraryDataPromise,
    Promise.allSettled([
      api?.settingsGetAll
        ? api.settingsGetAll()
        : Promise.reject(new Error('Desktop settings API unavailable')),
      api?.userDataLoad
        ? api.userDataLoad()
        : Promise.reject(new Error('Desktop user-data API unavailable')),
    ]),
  ]);
  const [settingsResult, userDataResult] = persistenceResults;

  return {
    desktop: true,
    libraryData,
    settingsResult,
    userDataResult,
  };
}

class LibraryPersistenceRepository {
  async loadBootstrap(): Promise<LibraryPersistenceBootstrapResult> {
    if (!isDesktop()) {
      return {
        desktop: false,
        libraryData: await libraryStorage.loadLibrary(),
        settingsResult: unavailable('Desktop settings API unavailable in browser mode'),
        userDataResult: unavailable('Desktop user-data API unavailable in browser mode'),
      };
    }

    const apiResult = await Promise.resolve(getDesktopAPIAsync()).then(
      value => ({ status: 'fulfilled', value }) satisfies PromiseFulfilledResult<PersistenceDesktopAPI>,
      reason => ({ status: 'rejected', reason }) satisfies PromiseRejectedResult,
    );
    if (apiResult.status === 'rejected') {
      logger.warn('[LibraryPersistenceRepository] Desktop API unavailable; using cache-only recovery:', apiResult.reason);
      return loadLegacyDesktopBootstrap(apiResult);
    }
    const api = apiResult.value;
    if (api?.persistenceLoadBootstrap) {
      try {
        return fromUnifiedBootstrap(await api.persistenceLoadBootstrap());
      } catch (error) {
        // One-release compatibility with an updated renderer running against a
        // stale preload/main bundle that does not expose the aggregate channel.
        logger.warn('[LibraryPersistenceRepository] Unified bootstrap unavailable; using legacy reads:', error);
      }
    }

    return loadLegacyDesktopBootstrap(apiResult);
  }
}

export const libraryPersistenceRepository = new LibraryPersistenceRepository();
