import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  requestLibraryFlush: vi.fn(),
  requestPlaybackShutdown: vi.fn(),
}));

vi.mock('@/services/libraryFlushEvent', () => ({
  requestLibraryFlush: mocks.requestLibraryFlush,
}));
vi.mock('@/services/playbackShutdown', () => ({
  requestPlaybackShutdown: mocks.requestPlaybackShutdown,
}));

import { useWindowControls } from '@/hooks/useWindowControls';

describe('useWindowControls close handshake', () => {
  beforeEach(() => {
    mocks.requestLibraryFlush.mockReset();
    mocks.requestLibraryFlush.mockResolvedValue(true);
    mocks.requestPlaybackShutdown.mockReset();
    mocks.requestPlaybackShutdown.mockResolvedValue(undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electron');
  });

  it('marks the native close as already flushed after the renderer commit succeeds', async () => {
    const closeWindow = vi.fn();
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        closeWindow,
        isMaximized: vi.fn().mockResolvedValue(false),
        isFullScreen: vi.fn().mockResolvedValue(false),
        onFullScreenChange: vi.fn().mockReturnValue(() => {}),
      },
    });
    const { result } = renderHook(() => useWindowControls());

    act(() => result.current.close());

    await waitFor(() => expect(closeWindow).toHaveBeenCalledWith(true));
    expect(mocks.requestLibraryFlush).toHaveBeenCalledTimes(1);
    expect(mocks.requestPlaybackShutdown).toHaveBeenCalledTimes(1);
  });

  it('keeps the title-bar window open when the renderer commit reports failure', async () => {
    mocks.requestLibraryFlush.mockResolvedValue(false);
    const closeWindow = vi.fn();
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        closeWindow,
        isMaximized: vi.fn().mockResolvedValue(false),
        isFullScreen: vi.fn().mockResolvedValue(false),
        onFullScreenChange: vi.fn().mockReturnValue(() => {}),
      },
    });
    const { result } = renderHook(() => useWindowControls());

    act(() => result.current.close());
    await waitFor(() => expect(mocks.requestLibraryFlush).toHaveBeenCalledTimes(1));

    expect(closeWindow).not.toHaveBeenCalled();
    expect(mocks.requestPlaybackShutdown).not.toHaveBeenCalled();
  });
});
