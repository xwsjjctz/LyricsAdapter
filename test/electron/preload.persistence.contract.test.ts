// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';

interface ExposedPersistenceApi {
  ipc: {
    settings: {
      get: (key: string) => Promise<unknown>;
      getAll: () => Promise<unknown>;
      set: (key: string, value: string) => Promise<unknown>;
      setMany: (entries: Record<string, string>) => Promise<unknown>;
      delete: (key: string) => Promise<unknown>;
      replaceAll: (entries: Record<string, string>) => Promise<unknown>;
    };
    userData: {
      load: () => Promise<unknown>;
      save: (data: unknown) => Promise<unknown>;
      saveTracks: (tracks: unknown[]) => Promise<unknown>;
      saveLibraryState: (tracks: unknown[], playback: Record<string, string>) => Promise<unknown>;
      getFilePath: () => Promise<unknown>;
    };
    persistence: {
      loadBootstrap: () => Promise<unknown>;
    };
    systemLyrics: {
      update: (state: unknown) => Promise<unknown>;
      onAction: (callback: (action: string) => void) => () => void;
    };
  };
}

function executePreload(): {
  api: ExposedPersistenceApi;
  invoke: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  response: { ok: true; data: { contract: string } };
} {
  const preloadPath = path.resolve(process.cwd(), 'electron/preload.ts');
  const compiled = transpileModule(readFileSync(preloadPath, 'utf8'), {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
    },
    fileName: preloadPath,
  }).outputText;

  const response = { ok: true as const, data: { contract: 'typed-ipc-result' } };
  const invoke = vi.fn().mockResolvedValue(response);
  const on = vi.fn();
  const removeListener = vi.fn();
  let exposed: ExposedPersistenceApi | undefined;
  const electron = {
    contextBridge: {
      exposeInMainWorld: vi.fn((name: string, api: ExposedPersistenceApi) => {
        if (name === 'electron') exposed = api;
      }),
    },
    ipcRenderer: {
      invoke,
      on,
      removeListener,
      send: vi.fn(),
    },
    webUtils: {
      getPathForFile: vi.fn(),
    },
  };
  const module = { exports: {} };

  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (specifier: string) => {
      if (specifier === 'electron') return electron;
      throw new Error(`Unexpected preload dependency: ${specifier}`);
    },
    process: { platform: 'test' },
    console,
    Buffer,
    ArrayBuffer,
    Map,
    Promise,
    URL,
    setTimeout,
    clearTimeout,
  }, { filename: preloadPath });

  if (!exposed) throw new Error('Preload did not expose window.electron');
  return { api: exposed, invoke, on, removeListener, response };
}

describe('preload persistence typed IPC contract', () => {
  it('routes nested settings methods to typed channels with envelope payloads', async () => {
    const { api, invoke, response } = executePreload();
    const entries = { 'app-theme': 'default-dark', qq_music_cookie: 'secret' };

    await expect(api.ipc.settings.get('app-theme')).resolves.toBe(response);
    await expect(api.ipc.settings.getAll()).resolves.toBe(response);
    await expect(api.ipc.settings.set('app-theme', 'default-light')).resolves.toBe(response);
    await expect(api.ipc.settings.setMany(entries)).resolves.toBe(response);
    await expect(api.ipc.settings.delete('app-theme')).resolves.toBe(response);
    await expect(api.ipc.settings.replaceAll(entries)).resolves.toBe(response);

    expect(invoke).toHaveBeenNthCalledWith(1, 'ipc:settings:get', { key: 'app-theme' });
    expect(invoke).toHaveBeenNthCalledWith(2, 'ipc:settings:getAll');
    expect(invoke).toHaveBeenNthCalledWith(3, 'ipc:settings:set', {
      key: 'app-theme',
      value: 'default-light',
    });
    expect(invoke).toHaveBeenNthCalledWith(4, 'ipc:settings:setMany', { entries });
    expect(invoke).toHaveBeenNthCalledWith(5, 'ipc:settings:delete', { key: 'app-theme' });
    expect(invoke).toHaveBeenNthCalledWith(6, 'ipc:settings:replaceAll', { entries });
  });

  it('routes nested userData methods to typed channels with envelope payloads', async () => {
    const { api, invoke, response } = executePreload();
    const tracks = [{ id: 'track-1', slotId: 'local' }];
    const snapshot = {
      schemaVersion: 1,
      libraryInitialized: true,
      tracks,
      settings: { 'app-language': 'zh' },
      playback: { _json: '{}' },
    };

    await expect(api.ipc.userData.load()).resolves.toBe(response);
    await expect(api.ipc.userData.save(snapshot)).resolves.toBe(response);
    await expect(api.ipc.userData.saveTracks(tracks)).resolves.toBe(response);
    await expect(api.ipc.userData.saveLibraryState(tracks, snapshot.playback)).resolves.toBe(response);
    await expect(api.ipc.userData.getFilePath()).resolves.toBe(response);

    expect(invoke).toHaveBeenNthCalledWith(1, 'ipc:userData:load');
    expect(invoke).toHaveBeenNthCalledWith(2, 'ipc:userData:save', { data: snapshot });
    expect(invoke).toHaveBeenNthCalledWith(3, 'ipc:userData:saveTracks', { tracks });
    expect(invoke).toHaveBeenNthCalledWith(4, 'ipc:userData:saveLibraryState', {
      tracks,
      playback: snapshot.playback,
    });
    expect(invoke).toHaveBeenNthCalledWith(5, 'ipc:userData:getFilePath');
  });

  it('routes the aggregate persistence bootstrap through the typed channel', async () => {
    const { api, invoke, response } = executePreload();

    await expect(api.ipc.persistence.loadBootstrap()).resolves.toBe(response);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('ipc:persistence:loadBootstrap');
  });

  it('routes system lyrics state and native actions through the typed bridge', async () => {
    const { api, invoke, on, removeListener, response } = executePreload();
    const state = {
      trackId: 'track-1', coverUrl: 'cover://track-1.jpg', title: 'Title', artist: 'Artist',
      line: 'Current line', lineCursor: 3, lineProgress: 3, nextLine: 'Next line', isPlaying: true,
    };

    await expect(api.ipc.systemLyrics.update(state)).resolves.toBe(response);
    expect(invoke).toHaveBeenCalledWith('ipc:systemLyrics:update', state);

    const callback = vi.fn();
    const unsubscribe = api.ipc.systemLyrics.onAction(callback);
    const handler = on.mock.calls.find(call => call[0] === 'system-lyrics-action')?.[1] as (
      event: unknown,
      action: string,
    ) => void;
    handler({}, 'next');
    expect(callback).toHaveBeenCalledWith('next');

    handler({}, 'not-an-action');
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith('system-lyrics-action', handler);
  });
});
