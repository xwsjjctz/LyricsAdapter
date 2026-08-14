// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { PersistenceCloseCommitRequest } from '../../src/types/typedIpc';

interface ExposedApi {
  closeWindow: (alreadyFlushed?: boolean) => Promise<unknown>;
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
  return { api: exposed, invoke, response };
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
});
