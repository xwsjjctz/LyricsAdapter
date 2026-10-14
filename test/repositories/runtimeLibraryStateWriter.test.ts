import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  desktop: false,
  setItem: vi.fn(async () => undefined),
  saveLibraryState: vi.fn(async () => undefined),
}));

vi.mock('@/services/desktopAdapter', () => ({
  isDesktop: () => mocks.desktop,
  getDesktopAPIAsync: async () => (mocks.desktop ? { userDataSaveLibraryState: mocks.saveLibraryState } : null),
}));
vi.mock('@/services/appStorage', () => ({ appStorage: { setItem: mocks.setItem } }));

import { createRuntimeLibraryStateWriter } from '@/repositories/runtimeLibraryStateWriter';

afterEach(() => { vi.clearAllMocks(); mocks.desktop = false; });

describe('runtime library state writer', () => {
  it('keeps browser playback in AppStorage and flushes on beforeunload', async () => {
    const writer = createRuntimeLibraryStateWriter();
    writer.saveLibrary([], '{"v":1}', false);
    await writer.savePlayback('{"v":2}');
    expect(mocks.setItem).toHaveBeenNthCalledWith(1, 'playback', '{"v":1}');
    expect(mocks.setItem).toHaveBeenNthCalledWith(2, 'playback', '{"v":2}');

    const flush = vi.fn();
    const remove = writer.onUnload(flush);
    window.dispatchEvent(new Event('beforeunload'));
    remove();
    window.dispatchEvent(new Event('beforeunload'));
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('writes desktop membership and playback in one SQLite call, and only when writable', async () => {
    mocks.desktop = true;
    const writer = createRuntimeLibraryStateWriter();
    writer.saveLibrary([], '{"v":1}', false);
    await writer.drain();
    expect(mocks.saveLibraryState).not.toHaveBeenCalled();
    writer.saveLibrary([], '{"v":2}', true);
    await writer.drain();
    expect(mocks.saveLibraryState).toHaveBeenCalledWith([], { _json: '{"v":2}' });
    expect(mocks.setItem).not.toHaveBeenCalled();
    const flush = vi.fn();
    writer.onUnload(flush)();
    window.dispatchEvent(new Event('beforeunload'));
    expect(flush).not.toHaveBeenCalled();
  });
});
