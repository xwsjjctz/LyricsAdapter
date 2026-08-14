import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, payload?: unknown) => unknown;

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
    },
    loadBootstrap: vi.fn(),
    commitClose: vi.fn(),
  };
});

vi.mock('electron', () => ({ ipcMain: mocks.ipcMain }));
vi.mock('../../../electron/services/persistenceRepository', () => ({
  persistenceRepository: { loadBootstrap: mocks.loadBootstrap },
}));
vi.mock('../../../electron/services/persistenceCommitService', () => ({
  persistenceCommitService: { commitClose: mocks.commitClose },
}));
vi.mock('../../../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerPersistenceHandlers } from '../../../electron/ipc/persistenceHandlers';

function invoke(channel: string, payload?: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler: ${channel}`);
  return Promise.resolve(handler({}, payload));
}

describe('persistence close commit handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    registerPersistenceHandlers();
  });

  it('rejects an invalid snapshot without invoking the use-case', async () => {
    await expect(invoke('ipc:persistence:commitClose', {
      libraryIndex: { songs: null, settings: {} },
      userData: { mode: 'write', tracks: [{ slotId: 'local' }] },
    })).resolves.toMatchObject({ ok: false });
    expect(mocks.commitClose).not.toHaveBeenCalled();
  });

  it('keeps a partial commit inside an outer ok result', async () => {
    const partial = {
      fullyPersisted: false,
      settings: { status: 'saved' as const },
      userData: { status: 'error' as const, error: 'users unavailable' },
      libraryIndex: { status: 'saved' as const },
    };
    mocks.commitClose.mockResolvedValue(partial);
    const payload = {
      libraryIndex: { songs: [{ id: 'track-1' }], settings: { volume: 0.5 } },
      userData: { mode: 'write', tracks: [{ id: 'track-1', slotId: 'local' }] },
    };

    await expect(invoke('ipc:persistence:commitClose', payload)).resolves.toEqual({
      ok: true,
      data: partial,
    });
    expect(mocks.commitClose).toHaveBeenCalledWith(payload);
  });

  it('accepts the explicit user-data skip mode', async () => {
    mocks.commitClose.mockResolvedValue({
      fullyPersisted: false,
      settings: { status: 'saved' },
      userData: { status: 'skipped', reason: 'disabled' },
      libraryIndex: { status: 'saved' },
    });
    const payload = {
      libraryIndex: { songs: [], settings: {} },
      userData: { mode: 'skip' },
    };

    await expect(invoke('ipc:persistence:commitClose', payload)).resolves.toMatchObject({
      ok: true,
      data: { userData: { status: 'skipped' } },
    });
  });
});
