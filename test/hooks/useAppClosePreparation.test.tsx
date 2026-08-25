import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getDesktopAPIAsync: vi.fn(),
  requestLibraryFlush: vi.fn(),
  requestPlaybackShutdown: vi.fn(),
  removeCloseListener: vi.fn(),
}));

vi.mock('@/services/desktopAdapter', () => ({
  isDesktop: () => true,
  getDesktopAPIAsync: mocks.getDesktopAPIAsync,
}));
vi.mock('@/services/libraryFlushEvent', () => ({
  requestLibraryFlush: mocks.requestLibraryFlush,
}));
vi.mock('@/services/playbackShutdown', () => ({
  requestPlaybackShutdown: mocks.requestPlaybackShutdown,
}));
vi.mock('@/services/logger', () => ({
  logger: { warn: vi.fn() },
}));

import { useAppClosePreparation } from '@/hooks/useAppClosePreparation';

describe('useAppClosePreparation', () => {
  beforeEach(() => {
    mocks.getDesktopAPIAsync.mockReset();
    mocks.requestLibraryFlush.mockReset();
    mocks.requestPlaybackShutdown.mockReset();
    mocks.removeCloseListener.mockReset();
  });

  it('waits for persistence and playback shutdown before acknowledging native close', async () => {
    let closePreparation: (() => Promise<boolean>) | undefined;
    mocks.getDesktopAPIAsync.mockResolvedValue({
      onBeforeWindowClose: vi.fn((callback: () => Promise<boolean>) => {
        closePreparation = callback;
        return mocks.removeCloseListener;
      }),
    });
    mocks.requestLibraryFlush.mockResolvedValue(true);
    mocks.requestPlaybackShutdown.mockResolvedValue(undefined);

    const { unmount } = renderHook(() => useAppClosePreparation());
    await waitFor(() => expect(closePreparation).toBeTypeOf('function'));

    await expect(closePreparation!()).resolves.toBe(true);
    expect(mocks.requestLibraryFlush).toHaveBeenCalledTimes(1);
    expect(mocks.requestPlaybackShutdown).toHaveBeenCalledTimes(1);

    unmount();
    expect(mocks.removeCloseListener).toHaveBeenCalledTimes(1);
  });
});
