import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ setOnlineCookie: vi.fn(async (_id: string, _cookie: string) => undefined) }));

vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => null,
  getDesktopAPIAsync: async () => ({ setOnlineCookie: mocks.setOnlineCookie }),
  isDesktop: () => false,
}));
vi.mock('@/services/appStorage', () => ({
  appStorage: { init: async () => undefined, getItem: () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));
vi.mock('@/services/indexedDBStorage', () => ({
  indexedDBStorage: { initialize: async () => undefined, getSetting: async () => null, deleteSetting: async () => undefined },
}));

import { cookieManager, neteaseCookieManager } from '@/services/cookieManager';
import { musicPluginState } from '@/services/musicPlugins';
import {
  cookieStoreFor,
  providerFor,
  sourceHasCapability,
  sourceIsReady,
  sourceLabel,
  sourceLogin,
  sourcePrependsLyricsTitle,
  sourceRequiresCookie,
  syncOnlineCookiesToMain,
} from '@/services/musicSources';

const plugin = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: `${id} music`, version: '1.0.0', apiVersion: 1, main: 'index.cjs', requiresCookie: false,
  capabilities: ['search'], enabled: true, origin: 'installed' as const, ...extra,
});

beforeEach(() => {
  mocks.setOnlineCookie.mockClear();
  musicPluginState.setState({
    loaded: true,
    error: '',
    plugins: [plugin('qq'), plugin('netease'), plugin('indie', { requiresCookie: true, capabilities: ['search', 'playlists'] }), plugin('free')],
  });
});

describe('music source registry', () => {
  it('keeps the official sources on their legacy login, cookie keys and behaviour', () => {
    expect(cookieStoreFor('qq')).toBe(cookieManager);
    expect(cookieStoreFor('netease')).toBe(neteaseCookieManager);
    expect(sourceLogin('qq')).toBe('qq-qr');
    expect(sourceLogin('netease')).toBe('netease-qr');
    expect(sourceRequiresCookie('qq')).toBe(true);
    expect(sourceHasCapability('netease', 'playlists')).toBe(true);
    expect(sourcePrependsLyricsTitle('netease')).toBe(true);
    expect(sourcePrependsLyricsTitle('qq')).toBe(false);
    expect(providerFor('netease').getSongDetails).toBeTypeOf('function');
  });

  it('derives a third-party source from its manifest', () => {
    const store = cookieStoreFor('indie');
    expect(store.storageKeys()).toEqual(['music-plugin:indie:secret:cookie', 'music-plugin:indie:cookie-last-check']);
    expect(cookieStoreFor('indie')).toBe(store);
    expect(sourceLogin('indie')).toBe('cookie');
    expect(sourceLogin('free')).toBe('none');
    expect(sourceHasCapability('indie', 'playlists')).toBe(true);
    expect(sourceHasCapability('free', 'playlists')).toBe(false);
    expect(sourceLabel('indie')).toBe('indie music');
    expect(sourceIsReady('free')).toBe(true);
    expect(sourceIsReady('indie')).toBe(false);
    expect(providerFor('indie')).toBe(providerFor('indie'));
    expect(providerFor('indie').getSongDetails).toBeUndefined();
  });

  it('syncs every known source cookie to the main process, or just the one asked for', async () => {
    await syncOnlineCookiesToMain();
    expect(mocks.setOnlineCookie.mock.calls.map(([id]) => id).sort()).toEqual(['free', 'indie', 'netease', 'qq']);
    mocks.setOnlineCookie.mockClear();
    await syncOnlineCookiesToMain('indie');
    expect(mocks.setOnlineCookie).toHaveBeenCalledOnce();
    expect(mocks.setOnlineCookie).toHaveBeenCalledWith('indie', '');
  });
});
