// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PersistenceRepository } from '../../electron/services/persistenceRepository';
import type { UserDataSnapshot } from '../../src/types/typedIpc';

// Importing the class also creates the production singleton. Keep that module
// initialization hermetic: these dependencies are irrelevant to injected-port
// contract tests and must never touch the developer's real ~/.la data.
vi.mock('../../electron/services/settingsStore', () => ({
  settingsStore: { getAll: vi.fn(() => ({})) },
}));
vi.mock('../../electron/services/userDataStore', () => ({
  userDataStore: { load: vi.fn() },
}));
vi.mock('../../electron/ipc/core/libraryCore', () => ({
  doLoadLibraryIndex: vi.fn(async () => ({ ok: true, data: { songs: [], settings: {} } })),
}));

const settings = { 'app-theme': 'default-dark' };
const initializedEmptyUserData: UserDataSnapshot = {
  schemaVersion: 1,
  libraryInitialized: true,
  tracks: [],
  settings: {},
  playback: {},
};
const libraryIndex = {
  songs: [{ id: 'stale-cache-track' }],
  settings: { activeSlotId: 'local' },
};

function createRepository(overrides: Partial<{
  loadSettings: () => Record<string, string>;
  loadUserData: () => UserDataSnapshot;
  loadLibraryIndex: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
}> = {}) {
  const dependencies = {
    loadSettings: vi.fn(() => settings),
    loadUserData: vi.fn(() => initializedEmptyUserData),
    loadLibraryIndex: vi.fn(async () => ({ ok: true as const, data: libraryIndex })),
    ...overrides,
  };
  return { repository: new PersistenceRepository(dependencies), dependencies };
}

describe('main PersistenceRepository bootstrap contract', () => {
  it('returns all three successful physical sources without cloning or merging them', async () => {
    const { repository, dependencies } = createRepository();

    const result = await repository.loadBootstrap();

    expect(result.settings).toEqual({ status: 'ready', data: settings });
    expect(result.userData).toEqual({ status: 'ready', data: initializedEmptyUserData });
    expect(result.libraryIndex).toEqual({ status: 'ready', data: libraryIndex });
    if (result.settings.status === 'ready') expect(result.settings.data).toBe(settings);
    if (result.userData.status === 'ready') expect(result.userData.data).toBe(initializedEmptyUserData);
    if (result.libraryIndex.status === 'ready') expect(result.libraryIndex.data).toBe(libraryIndex);
    expect(dependencies.loadSettings).toHaveBeenCalledTimes(1);
    expect(dependencies.loadUserData).toHaveBeenCalledTimes(1);
    expect(dependencies.loadLibraryIndex).toHaveBeenCalledTimes(1);
  });

  it('keeps initialized-empty user data separate from a non-empty library cache', async () => {
    const { repository } = createRepository();

    const result = await repository.loadBootstrap();

    expect(result.userData).toEqual({ status: 'ready', data: initializedEmptyUserData });
    expect(result.libraryIndex).toEqual({ status: 'ready', data: libraryIndex });
    expect(result.userData.status === 'ready' && result.userData.data.tracks).toEqual([]);
  });

  it.each([
    {
      source: 'settings',
      overrides: { loadSettings: () => { throw new Error('settings corrupt'); } },
      expected: { status: 'error', error: 'settings corrupt' },
    },
    {
      source: 'userData',
      overrides: { loadUserData: () => { throw new Error('users corrupt'); } },
      expected: { status: 'error', error: 'users corrupt' },
    },
    {
      source: 'libraryIndex',
      overrides: { loadLibraryIndex: async () => ({ ok: false as const, error: 'cache corrupt' }) },
      expected: { status: 'error', error: 'cache corrupt' },
    },
    {
      source: 'libraryIndex',
      overrides: { loadLibraryIndex: async () => { throw new Error('cache unavailable'); } },
      expected: { status: 'error', error: 'cache unavailable' },
    },
  ])('isolates a $source read failure without hiding the other sources', async ({ source, overrides, expected }) => {
    const { repository } = createRepository(overrides);

    const result = await repository.loadBootstrap();

    expect(result[source as keyof typeof result]).toEqual(expected);
    if (source !== 'settings') expect(result.settings).toEqual({ status: 'ready', data: settings });
    if (source !== 'userData') expect(result.userData).toEqual({ status: 'ready', data: initializedEmptyUserData });
    if (source !== 'libraryIndex') expect(result.libraryIndex).toEqual({ status: 'ready', data: libraryIndex });
  });

  it('classifies semantic-invalid JSON as a cache-only failure', async () => {
    const { repository } = createRepository({
      loadLibraryIndex: async () => ({ ok: true, data: null }),
    });

    const result = await repository.loadBootstrap();

    expect(result.libraryIndex).toMatchObject({ status: 'error' });
    expect(result.settings).toEqual({ status: 'ready', data: settings });
    expect(result.userData).toEqual({ status: 'ready', data: initializedEmptyUserData });
  });
});
