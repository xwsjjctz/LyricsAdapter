// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { bundledPreloadModule, SANDBOXED_PRELOAD_ARGV } from './preloadSharedModules';
import type { PersistenceCloseCommitRequest } from '../../src/types/typedIpc';

interface ExposedApi {
  closeWindow: (alreadyFlushed?: boolean) => Promise<unknown>;
  onBeforeWindowClose: (callback: () => Promise<boolean> | boolean) => () => void;
  ipc: {
    persistence: {
      commitClose: (request: PersistenceCloseCommitRequest) => Promise<unknown>;
    };
  };
}

function executePreload(): {
  api: ExposedApi;
  invoke: ReturnType<typeof vi.fn>;
  response: object;
  on: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const preloadPath = path.resolve(process.cwd(), 'electron/preload.ts');
  const compiled = transpileModule(readFileSync(preloadPath, 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    fileName: preloadPath,
  }).outputText;
  const response = { ok: true, data: { fullyPersisted: true } };
  const invoke = vi.fn().mockResolvedValue(response);
  let exposed: ExposedApi | undefined;
  const electron = {
    contextBridge: {
      exposeInMainWorld: vi.fn((name: string, api: ExposedApi) => {
        if (name === 'electron') exposed = api;
      }),
    },
    ipcRenderer: {
      invoke,
      on: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn(),
    },
    webUtils: { getPathForFile: vi.fn() },
  };

  vm.runInNewContext(compiled, {
    module: { exports: {} },
    exports: {},
    require: (specifier: string) => {
      if (specifier === 'electron') return electron;
      const bundled = bundledPreloadModule(specifier);
      if (bundled) return bundled;
      throw new Error(`Unexpected preload dependency: ${specifier}`);
    },
    process: { platform: 'test', argv: SANDBOXED_PRELOAD_ARGV },
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
  return { api: exposed, invoke, response, on: electron.ipcRenderer.on, send: electron.ipcRenderer.send };
}

describe('preload close commit contract', () => {
  it('forwards the final snapshot unchanged to the typed channel', async () => {
    const { api, invoke, response } = executePreload();
    const request: PersistenceCloseCommitRequest = {
      libraryIndex: {
        songs: [{ id: 'track-1' }],
        settings: { activeSlotId: 'local' },
      },
      userData: {
        mode: 'write',
        tracks: [{ id: 'track-1', slotId: 'local' }],
      },
    };

    await expect(api.ipc.persistence.commitClose(request)).resolves.toBe(response);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('ipc:persistence:commitClose', request);
  });

  it('forwards the already-flushed close marker to the window handler', async () => {
    const { api, invoke, response } = executePreload();

    await expect(api.closeWindow(true)).resolves.toBe(response);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('window-close', true);
  });

  it('acknowledges the matching save request only after the renderer callback settles', async () => {
    const { api, on, send } = executePreload();
    let finish!: (saved: boolean) => void;
    api.onBeforeWindowClose(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const listener = on.mock.calls.find(([channel]) => channel === 'window-before-close-flush')?.[1] as
      (event: unknown, requestId: number) => Promise<void>;
    const pending = listener({}, 7);
    expect(send).not.toHaveBeenCalled();
    finish(true);
    await pending;
    expect(send).toHaveBeenCalledWith('window-before-close-flush-done', true, 7);
  });
});
