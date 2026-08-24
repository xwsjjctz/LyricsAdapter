import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = { qqLoggedIn: false, neteaseLoggedIn: false };
  const qqListeners = new Set<() => void>();
  const neteaseListeners = new Set<() => void>();
  return {
    state,
    qqListeners,
    neteaseListeners,
    qqValidate: vi.fn(async () => ({ valid: true })),
    neteaseValidate: vi.fn(async () => ({ valid: true })),
    getQQPlaylists: vi.fn(),
    getNetEasePlaylists: vi.fn(),
    loadPlaylistCache: vi.fn(),
    savePlaylistCache: vi.fn(),
  };
});

vi.mock('@/services/cookieManager', () => ({
  cookieManager: {
    ensureLoaded: vi.fn(async () => undefined),
    hasCookie: () => mocks.state.qqLoggedIn,
    validateCookie: mocks.qqValidate,
    subscribe: (listener: () => void) => {
      mocks.qqListeners.add(listener);
      return () => mocks.qqListeners.delete(listener);
    },
  },
  neteaseCookieManager: {
    ensureLoaded: vi.fn(async () => undefined),
    hasCookie: () => mocks.state.neteaseLoggedIn,
    validateCookie: mocks.neteaseValidate,
    subscribe: (listener: () => void) => {
      mocks.neteaseListeners.add(listener);
      return () => mocks.neteaseListeners.delete(listener);
    },
  },
}));

vi.mock('@/services/qqMusicApi', () => ({
  qqMusicApi: { getPlaylists: mocks.getQQPlaylists },
}));

vi.mock('@/services/neteaseMusicApi', () => ({
  neteaseMusicApi: { getPlaylists: mocks.getNetEasePlaylists },
}));

vi.mock('@/services/playlistCache', () => ({
  loadPlaylistCache: mocks.loadPlaylistCache,
  savePlaylistCache: mocks.savePlaylistCache,
}));

vi.mock('@/services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useOnlinePlaylists } from '@/hooks/useOnlinePlaylists';

describe('useOnlinePlaylists', () => {
  beforeEach(() => {
    mocks.state.qqLoggedIn = false;
    mocks.state.neteaseLoggedIn = false;
    mocks.qqListeners.clear();
    mocks.neteaseListeners.clear();
    mocks.qqValidate.mockClear();
    mocks.neteaseValidate.mockClear();
    mocks.getQQPlaylists.mockReset();
    mocks.getNetEasePlaylists.mockReset();
    mocks.loadPlaylistCache.mockReset();
    mocks.loadPlaylistCache.mockResolvedValue(null);
    mocks.savePlaylistCache.mockReset();
    mocks.savePlaylistCache.mockResolvedValue(undefined);
  });

  it('refreshes Sidebar playlists when a provider login changes', async () => {
    const qqPlaylist = { id: 'qq-list', name: 'QQ Playlist', songCount: 3 };
    mocks.getQQPlaylists.mockResolvedValue([qqPlaylist]);
    const { result } = renderHook(() => useOnlinePlaylists());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.playlists).toEqual([]);

    mocks.state.qqLoggedIn = true;
    act(() => mocks.qqListeners.forEach(listener => listener()));

    await waitFor(() => expect(result.current.playlists).toEqual([
      { ...qqPlaylist, source: 'qq' },
    ]));
    expect(mocks.qqValidate).toHaveBeenCalledTimes(1);
    expect(mocks.getQQPlaylists).toHaveBeenCalledTimes(1);

    mocks.state.qqLoggedIn = false;
    act(() => mocks.qqListeners.forEach(listener => listener()));

    await waitFor(() => expect(result.current.playlists).toEqual([]));
  });
});
