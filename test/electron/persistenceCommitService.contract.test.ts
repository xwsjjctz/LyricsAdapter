import { describe, expect, it, vi } from 'vitest';
import type {
  IpcResult,
  PersistenceCloseCommitRequest,
} from '../../src/types/typedIpc';

vi.mock('../../electron/services/settingsStore', () => ({
  settingsStore: { set: vi.fn(), getAll: vi.fn() },
}));
vi.mock('../../electron/services/userDataStore', () => ({
  userDataStore: { saveLibraryState: vi.fn() },
}));
vi.mock('../../electron/ipc/core/libraryCore', () => ({
  doSaveLibraryIndex: vi.fn(),
}));

import {
  PersistenceCommitService,
  type PersistenceCommitDependencies,
} from '../../electron/services/persistenceCommitService';

function request(
  id = 'track-1',
  userData: PersistenceCloseCommitRequest['userData'] = {
    mode: 'write',
    tracks: [{ id, slotId: 'local' }],
  },
): PersistenceCloseCommitRequest {
  return {
    libraryIndex: {
      songs: [{ id }],
      settings: { activeSlotId: 'local', volume: 0.4 },
    },
    userData,
  };
}

function dependencies(
  overrides: Partial<PersistenceCommitDependencies> = {},
): PersistenceCommitDependencies {
  return {
    savePlayback: vi.fn(() => true),
    loadSettings: vi.fn(() => ({ 'app-theme': 'dark', __la_settings_migration_version: '1' })),
    saveUserLibraryState: vi.fn(() => true),
    saveLibraryIndex: vi.fn(async (): Promise<IpcResult<void>> => ({ ok: true, data: undefined })),
    ...overrides,
  };
}

describe('PersistenceCommitService close commit', () => {
  it('writes settings, users, then cache with one serialized playback snapshot', async () => {
    const order: string[] = [];
    const savePlayback = vi.fn((playbackJson: string) => {
      order.push('settings');
      expect(playbackJson).toBe('{"activeSlotId":"local","volume":0.4}');
      return true;
    });
    const loadSettings = vi.fn(() => {
      order.push('settings-read');
      return { 'app-theme': 'dark', __la_settings_migration_version: '1' };
    });
    const saveUserLibraryState = vi.fn((_tracks, playback, settings) => {
      order.push('users');
      expect(playback).toEqual({ _json: '{"activeSlotId":"local","volume":0.4}' });
      expect(settings).toEqual({ 'app-theme': 'dark' });
      return true;
    });
    const saveLibraryIndex = vi.fn(async () => {
      order.push('cache');
      return { ok: true as const, data: undefined };
    });
    const service = new PersistenceCommitService(dependencies({
      savePlayback,
      loadSettings,
      saveUserLibraryState,
      saveLibraryIndex,
    }));

    await expect(service.commitClose(request())).resolves.toEqual({
      fullyPersisted: true,
      settings: { status: 'saved' },
      userData: { status: 'saved' },
      libraryIndex: { status: 'saved' },
    });
    expect(order).toEqual(['settings', 'settings-read', 'users', 'cache']);
  });

  it('attempts every physical source and reports all partial failures', async () => {
    const order: string[] = [];
    const service = new PersistenceCommitService(dependencies({
      savePlayback: vi.fn(() => {
        order.push('settings');
        return false;
      }),
      loadSettings: vi.fn(() => {
        order.push('settings-read');
        return {};
      }),
      saveUserLibraryState: vi.fn(() => {
        order.push('users');
        throw new Error('users disk full');
      }),
      saveLibraryIndex: vi.fn(async () => {
        order.push('cache');
        return { ok: false as const, error: 'cache denied' };
      }),
    }));

    await expect(service.commitClose(request())).resolves.toEqual({
      fullyPersisted: false,
      settings: { status: 'error', error: 'Failed to persist playback settings' },
      userData: { status: 'error', error: 'users disk full' },
      libraryIndex: { status: 'error', error: 'cache denied' },
    });
    expect(order).toEqual(['settings', 'settings-read', 'users', 'cache']);
  });

  it('still saves users while preserving their settings when settings loading fails', async () => {
    const saveUserLibraryState = vi.fn(() => true);
    const service = new PersistenceCommitService(dependencies({
      loadSettings: vi.fn(() => {
        throw new Error('settings unreadable');
      }),
      saveUserLibraryState,
    }));

    const result = await service.commitClose(request());

    expect(result.userData).toEqual({ status: 'saved' });
    expect(saveUserLibraryState).toHaveBeenCalledWith(
      [{ id: 'track-1', slotId: 'local' }],
      { _json: '{"activeSlotId":"local","volume":0.4}' },
      undefined,
    );
  });

  it('honors fail-closed user-data skip while still saving settings and cache', async () => {
    const deps = dependencies();
    const service = new PersistenceCommitService(deps);

    await expect(service.commitClose(request('track-1', { mode: 'skip' }))).resolves.toEqual({
      fullyPersisted: false,
      settings: { status: 'saved' },
      userData: {
        status: 'skipped',
        reason: 'User-data writes disabled for this close attempt',
      },
      libraryIndex: { status: 'saved' },
    });
    expect(deps.loadSettings).not.toHaveBeenCalled();
    expect(deps.saveUserLibraryState).not.toHaveBeenCalled();
  });

  it('shares one in-flight close attempt even when concurrent payloads differ', async () => {
    let release!: (value: IpcResult<void>) => void;
    const cacheGate = new Promise<IpcResult<void>>(resolve => { release = resolve; });
    const deps = dependencies({
      saveLibraryIndex: vi.fn(() => cacheGate),
    });
    const service = new PersistenceCommitService(deps);

    const first = service.commitClose(request('first'));
    const second = service.commitClose(request('second'));

    expect(second).toBe(first);
    expect(deps.savePlayback).toHaveBeenCalledTimes(1);
    expect(deps.saveUserLibraryState).toHaveBeenCalledTimes(1);
    expect(deps.saveLibraryIndex).toHaveBeenCalledTimes(1);
    expect(deps.saveLibraryIndex).toHaveBeenCalledWith(request('first').libraryIndex);

    release({ ok: true, data: undefined });
    await expect(first).resolves.toMatchObject({ fullyPersisted: true });

    await service.commitClose(request('after-settlement'));
    expect(deps.saveLibraryIndex).toHaveBeenCalledTimes(2);
  });
});
