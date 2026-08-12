// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = () => unknown;

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
    },
    loadBootstrap: vi.fn(),
  };
});

vi.mock('electron', () => ({ ipcMain: mocks.ipcMain }));
vi.mock('../../../electron/services/persistenceRepository', () => ({
  persistenceRepository: { loadBootstrap: mocks.loadBootstrap },
}));
vi.mock('../../../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerPersistenceHandlers } from '../../../electron/ipc/persistenceHandlers';

describe('persistence repository IPC handler contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
  });

  it('returns the independent three-source snapshot in one typed envelope', async () => {
    const bootstrap = {
      settings: { status: 'ready', data: { 'app-theme': 'default-dark' } },
      userData: {
        status: 'ready',
        data: { schemaVersion: 1, libraryInitialized: true, tracks: [], settings: {}, playback: {} },
      },
      libraryIndex: { status: 'error', error: 'cache corrupt' },
    };
    mocks.loadBootstrap.mockResolvedValue(bootstrap);
    registerPersistenceHandlers();

    const handler = mocks.handlers.get('ipc:persistence:loadBootstrap');
    expect(handler).toBeDefined();
    await expect(handler!()).resolves.toEqual({ ok: true, data: bootstrap });
  });

  it('uses the outer IpcResult failure only for an unexpected facade-level rejection', async () => {
    mocks.loadBootstrap.mockRejectedValue(new Error('facade crashed'));
    registerPersistenceHandlers();

    const handler = mocks.handlers.get('ipc:persistence:loadBootstrap');
    await expect(handler!()).resolves.toEqual({ ok: false, error: 'facade crashed' });
  });
});
