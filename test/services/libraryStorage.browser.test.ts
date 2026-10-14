import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveLibrary: vi.fn(async () => true),
  loadLibrary: vi.fn(async () => ({ songs: [{ id: 'saved' }], settings: {} })),
}));

vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPIAsync: async () => null }));
vi.mock('@/services/indexedDBStorage', () => ({ indexedDBStorage: mocks }));

import { libraryStorage } from '@/services/libraryStorage';

describe('libraryStorage in browser mode', () => {
  it('reads and writes the library index through IndexedDB', async () => {
    const library = { songs: [], settings: {} };
    await expect(libraryStorage.saveLibrary(library)).resolves.toBe(true);
    expect(mocks.saveLibrary).toHaveBeenCalledWith(library);
    await expect(libraryStorage.loadLibrary()).resolves.toEqual({ songs: [{ id: 'saved' }], settings: {} });
  });
});
