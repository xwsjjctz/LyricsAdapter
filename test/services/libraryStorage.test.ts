import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryStorage, type LibraryIndexData } from '@/services/libraryStorage';

const desktopMocks = vi.hoisted(() => ({
  getDesktopAPIAsync: vi.fn(),
  saveLibraryIndex: vi.fn(),
}));

vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPIAsync: desktopMocks.getDesktopAPIAsync,
}));

vi.mock('@/services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeLibrary(id: string): LibraryIndexData {
  return {
    songs: [{
      id,
      title: id,
      artist: 'Artist',
      album: 'Album',
      duration: 1,
    }],
    settings: {},
  };
}

describe('libraryStorage debounced saves', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    desktopMocks.saveLibraryIndex.mockReset();
    desktopMocks.saveLibraryIndex.mockResolvedValue({ success: true });
    desktopMocks.getDesktopAPIAsync.mockReset();
    desktopMocks.getDesktopAPIAsync.mockResolvedValue({
      saveLibraryIndex: desktopMocks.saveLibraryIndex,
    });
    libraryStorage.clearSaveTimer();
  });

  afterEach(() => {
    libraryStorage.clearSaveTimer();
    vi.useRealTimers();
  });

  it('flushes the latest pending debounced library immediately', async () => {
    const first = makeLibrary('first');
    const latest = makeLibrary('latest');

    libraryStorage.saveLibraryDebounced(first);
    libraryStorage.saveLibraryDebounced(latest);

    await expect(libraryStorage.flushPendingSave()).resolves.toBe(true);

    expect(desktopMocks.saveLibraryIndex).toHaveBeenCalledTimes(1);
    expect(desktopMocks.saveLibraryIndex).toHaveBeenCalledWith(latest);

    await vi.advanceTimersByTimeAsync(1000);
    expect(desktopMocks.saveLibraryIndex).toHaveBeenCalledTimes(1);
  });

  it('lets an explicit flush snapshot replace the pending save', async () => {
    const pending = makeLibrary('pending');
    const closingSnapshot = makeLibrary('closing');

    libraryStorage.saveLibraryDebounced(pending);
    await expect(libraryStorage.flushPendingSave(closingSnapshot)).resolves.toBe(true);

    expect(desktopMocks.saveLibraryIndex).toHaveBeenCalledTimes(1);
    expect(desktopMocks.saveLibraryIndex).toHaveBeenCalledWith(closingSnapshot);
  });

  it('runs the debounced save when not flushed', async () => {
    const library = makeLibrary('timer');

    libraryStorage.saveLibraryDebounced(library);
    await vi.advanceTimersByTimeAsync(1000);

    expect(desktopMocks.saveLibraryIndex).toHaveBeenCalledTimes(1);
    expect(desktopMocks.saveLibraryIndex).toHaveBeenCalledWith(library);
  });
});
