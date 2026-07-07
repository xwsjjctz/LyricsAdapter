export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface TypedElectronIPC {
  file: {
    selectAudio: () => Promise<IpcResult<{ canceled: boolean; filePaths: string[] }>>;
    readAudio: (filePath: string) => Promise<IpcResult<{ data: ArrayBuffer }>>;
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
  };
  download: {
    audio: (payload: { url: string; cookieString: string }) => Promise<IpcResult<{ data: ArrayBuffer }>>;
  };
}
