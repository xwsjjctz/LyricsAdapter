export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface UserDataSnapshot {
  schemaVersion: 1;
  libraryInitialized: boolean;
  tracks: unknown[];
  settings: Record<string, string>;
  playback: Record<string, string>;
}

/** Read status for one physical persistence source during application bootstrap. */
export type StoreRead<T> =
  | { status: 'ready'; data: T }
  | { status: 'error'; error: string };

/**
 * Independent read results for the three stores used to restore the library.
 * One damaged source must not hide the other two from the renderer.
 */
export interface PersistenceBootstrap {
  settings: StoreRead<Record<string, string>>;
  userData: StoreRead<UserDataSnapshot>;
  libraryIndex: StoreRead<unknown>;
}

export interface TypedElectronIPC {
  file: {
    selectAudio: () => Promise<IpcResult<{ canceled: boolean; filePaths: string[] }>>;
    readAudio: (filePath: string) => Promise<IpcResult<{ data: ArrayBuffer }>>;
    allowAudioPath: (filePath: string) => Promise<IpcResult<void>>;
  };
  library: {
    loadIndex: () => Promise<IpcResult<unknown>>;
    saveIndex: (library: unknown) => Promise<IpcResult<void>>;
  };
  webdav: {
    propfind: (payload: { url: string; authHeader: string; depth: string }) => Promise<IpcResult<{ xml: string }>>;
    getRange: (payload: { url: string; authHeader: string; start: number; end: number }) => Promise<IpcResult<{ data: ArrayBuffer }>>;
    put: (payload: { url: string; authHeader: string; data: ArrayBuffer; contentType: string }) => Promise<IpcResult<void>>;
    delete: (payload: { url: string; authHeader: string }) => Promise<IpcResult<void>>;
    getRedirect: (payload: { url: string; authHeader: string }) => Promise<IpcResult<{ redirectUrl?: string; status: number }>>;
    mkcol: (payload: { url: string; authHeader: string }) => Promise<IpcResult<{ status: number }>>;
  };
  download: {
    audio: (payload: { url: string; cookieString: string }) => Promise<IpcResult<{ data: ArrayBuffer }>>;
  };
  settings: {
    get: (key: string) => Promise<IpcResult<string | undefined>>;
    getAll: () => Promise<IpcResult<Record<string, string>>>;
    set: (key: string, value: string) => Promise<IpcResult<void>>;
    setMany: (entries: Record<string, string>) => Promise<IpcResult<void>>;
    delete: (key: string) => Promise<IpcResult<void>>;
    replaceAll: (entries: Record<string, string>) => Promise<IpcResult<void>>;
  };
  userData: {
    load: () => Promise<IpcResult<UserDataSnapshot>>;
    save: (data: UserDataSnapshot) => Promise<IpcResult<void>>;
    saveTracks: (tracks: unknown[]) => Promise<IpcResult<void>>;
    saveLibraryState: (tracks: unknown[], playback: Record<string, string>) => Promise<IpcResult<void>>;
    getFilePath: () => Promise<IpcResult<string>>;
  };
  persistence: {
    loadBootstrap: () => Promise<IpcResult<PersistenceBootstrap>>;
  };
}
