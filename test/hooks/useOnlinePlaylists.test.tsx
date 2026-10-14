import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { musicPluginStore } from '@/stores/musicPluginStore';
import { settingsManager } from '@/services/settingsManager';

const mocks = vi.hoisted(() => {
  const loggedIn = new Map<string, boolean>();
  const listeners = new Map<string, Set<() => void>>();
  const validate = new Map<string, ReturnType<typeof vi.fn>>();
  const getPlaylists = new Map<string, ReturnType<typeof vi.fn>>();
  const forSource = <T,>(map: Map<string, T>, id: string, create: () => T) => {
    if (!map.has(id)) map.set(id, create());
    return map.get(id)!;
  };
  return {
    loggedIn,
    listeners,
    validateFor: (id: string) => forSource(validate, id, () => vi.fn(async () => ({ valid: true }))),
    playlistsFor: (id: string) => forSource(getPlaylists, id, () => vi.fn(async (): Promise<unknown[]> => [])),
    listenersFor: (id: string) => forSource(listeners, id, () => new Set<() => void>()),
    playlistSources: new Set(['qq', 'netease']),
    loadPlaylistCache: vi.fn(),
    savePlaylistCache: vi.fn(),
    reset() { loggedIn.clear(); listeners.clear(); validate.clear(); getPlaylists.clear(); },
  };
});

vi.mock('@/services/musicSources', () => ({
  cookieStoreFor: (id: string) => ({
    ensureLoaded: async () => undefined,
    hasCookie: () => mocks.loggedIn.get(id) ?? false,
    validateCookie: mocks.validateFor(id),
    subscribe: (listener: () => void) => {
      mocks.listenersFor(id).add(listener);
      return () => mocks.listenersFor(id).delete(listener);
    },
  }),
  providerFor: (id: string) => ({ getPlaylists: mocks.playlistsFor(id) }),
  sourceHasCapability: (id: string, capability: string) => capability === 'playlists' && mocks.playlistSources.has(id),
}));

vi.mock('@/services/playlistCache', () => ({
  loadPlaylistCache: mocks.loadPlaylistCache,
  savePlaylistCache: mocks.savePlaylistCache,
}));

vi.mock('@/services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useOnlinePlaylists } from '@/hooks/useOnlinePlaylists';

const plugin = (id: string) => ({
  id, name: id, version: '1.0.0', apiVersion: 1, main: 'index.cjs', requiresCookie: false, capabilities: ['search'], enabled: true, origin: 'installed' as const,
});
const notify = (id: string) => act(() => mocks.listenersFor(id).forEach(listener => listener()));

describe('useOnlinePlaylists', () => {
  beforeEach(() => {
    vi.spyOn(settingsManager, 'getQqMusicEnabled').mockReturnValue(true);
    musicPluginStore.setState({ loaded: true, error: '', plugins: ['qq', 'netease'].map(plugin) });
    mocks.reset();
    mocks.playlistSources = new Set(['qq', 'netease']);
    mocks.loadPlaylistCache.mockReset();
    mocks.loadPlaylistCache.mockResolvedValue(null);
    mocks.savePlaylistCache.mockReset();
    mocks.savePlaylistCache.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('makes no provider calls without plugins even when saved login credentials exist', async () => {
    musicPluginStore.setState({ plugins: [] });
    mocks.loggedIn.set('qq', true);
    mocks.loggedIn.set('netease', true);
    const { result } = renderHook(() => useOnlinePlaylists());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.playlists).toEqual([]);
    expect(mocks.validateFor('qq')).not.toHaveBeenCalled();
    expect(mocks.validateFor('netease')).not.toHaveBeenCalled();
  });

  it('does not request a disabled provider and hides cached data when a plugin is removed', async () => {
    const [qq, netease] = musicPluginStore.getSnapshot().plugins;
    musicPluginStore.setState({ plugins: [{ ...qq!, enabled: false }, netease!] });
    mocks.loggedIn.set('qq', true);
    mocks.loggedIn.set('netease', true);
    mocks.playlistsFor('netease').mockResolvedValue([{ id: 'net-list', name: 'Net list', songCount: 1 }]);
    const { result } = renderHook(() => useOnlinePlaylists());
    await waitFor(() => expect(result.current.playlists).toHaveLength(1));
    expect(mocks.validateFor('qq')).not.toHaveBeenCalled();
    act(() => musicPluginStore.setState({ plugins: [] }));
    expect(result.current.playlists).toEqual([]);
  });

  it('refreshes playlists when a provider login changes', async () => {
    const qqPlaylist = { id: 'qq-list', name: 'QQ Playlist', songCount: 3 };
    mocks.playlistsFor('qq').mockResolvedValue([qqPlaylist]);
    const { result } = renderHook(() => useOnlinePlaylists());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.playlists).toEqual([]);

    mocks.loggedIn.set('qq', true);
    notify('qq');

    await waitFor(() => expect(result.current.playlists).toEqual([{ ...qqPlaylist, source: 'qq' }]));
    expect(mocks.validateFor('qq')).toHaveBeenCalledTimes(1);
    expect(mocks.playlistsFor('qq')).toHaveBeenCalledTimes(1);
    expect(mocks.savePlaylistCache).toHaveBeenLastCalledWith({ qq: [{ ...qqPlaylist, source: 'qq' }] });

    mocks.loggedIn.set('qq', false);
    notify('qq');

    await waitFor(() => expect(result.current.playlists).toEqual([]));
  });

  it('lists playlists from a third-party source that declares the capability', async () => {
    musicPluginStore.setState({ plugins: [plugin('indie'), plugin('search-only')] });
    mocks.playlistSources = new Set(['indie']);
    mocks.loggedIn.set('indie', true);
    mocks.loggedIn.set('search-only', true);
    mocks.playlistsFor('indie').mockResolvedValue([{ id: 'p', name: 'Indie list', songCount: 2 }]);
    const { result } = renderHook(() => useOnlinePlaylists());

    await waitFor(() => expect(result.current.playlists).toEqual([{ id: 'p', name: 'Indie list', songCount: 2, source: 'indie' }]));
    expect(mocks.playlistsFor('search-only')).not.toHaveBeenCalled();
  });
});
