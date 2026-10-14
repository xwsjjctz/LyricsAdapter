import i18next from 'i18next';
import { appStorage } from './appStorage';
import { CookieStore, cookieManager, neteaseCookieManager, pluginCookieValidator } from './cookieManager';
import { getDesktopAPI, getDesktopAPIAsync } from './desktopAdapter';
import { logger } from './logger';
import { createMusicPluginProvider } from './musicPluginProvider';
import { getMusicPluginInfo, musicPluginState } from './musicPlugins';
import type { OnlineMusicProvider, OnlineSource } from '../shared/onlineMusic';

/**
 * Registry of music sources. Every enabled music plugin that can search is a
 * source; what the host offers for it (login, playlists, cookie handling)
 * follows its manifest. The two official plugins predate those declarations,
 * so their behaviour is pinned in one compatibility table below.
 */

/** How the settings page signs a user in to a source. */
export type MusicSourceLogin = 'qq-qr' | 'netease-qr' | 'cookie' | 'none';

interface LegacySource {
  login: MusicSourceLogin;
  requiresCookie: boolean;
  /** Settings keys the plugin's credentials are stored under (pre-plugin names). */
  secretKeys: string[];
  cookieKey: string;
  labelKey: string;
  songDetails: boolean;
  /** NetEase lyrics omit the title line that the player shows first. */
  prependsLyricsTitle: boolean;
  cookies: CookieStore;
}

const LEGACY_SOURCES: Record<string, LegacySource> = {
  qq: {
    login: 'qq-qr', requiresCookie: true, secretKeys: ['qq_music_cookie', 'qq_music_credential'], cookieKey: 'qq_music_cookie',
    labelKey: 'search.sourceQq', songDetails: false, prependsLyricsTitle: false, cookies: cookieManager,
  },
  netease: {
    login: 'netease-qr', requiresCookie: false, secretKeys: ['netease_cookie'], cookieKey: 'netease_cookie',
    labelKey: 'search.sourceNetease', songDetails: true, prependsLyricsTitle: true, cookies: neteaseCookieManager,
  },
};

const legacy = (id: OnlineSource): LegacySource | undefined => (Object.hasOwn(LEGACY_SOURCES, id) ? LEGACY_SOURCES[id] : undefined);

/** Main-process secret key for a plugin's cookie (see musicPluginHandlers' secretKey). */
const pluginCookieKey = (id: OnlineSource) => `music-plugin:${id}:secret:cookie`;

const cookieStores = new Map<OnlineSource, CookieStore>();
const providers = new Map<OnlineSource, OnlineMusicProvider>();

export function cookieStoreFor(id: OnlineSource): CookieStore {
  const known = legacy(id)?.cookies ?? cookieStores.get(id);
  if (known) return known;
  const store = new CookieStore({
    storageKey: pluginCookieKey(id),
    checkTimeKey: `music-plugin:${id}:cookie-last-check`,
    scope: id,
    validate: pluginCookieValidator(id),
  });
  cookieStores.set(id, store);
  return store;
}

export function sourceRequiresCookie(id: OnlineSource): boolean {
  return legacy(id)?.requiresCookie ?? getMusicPluginInfo(id)?.requiresCookie ?? false;
}

export function sourceHasCapability(id: OnlineSource, capability: 'playlists' | 'lyrics' | 'stream' | 'qr-login'): boolean {
  if (capability === 'playlists' && legacy(id)) return true;
  return getMusicPluginInfo(id)?.capabilities.includes(capability) ?? false;
}

export function sourceLogin(id: OnlineSource): MusicSourceLogin {
  return legacy(id)?.login ?? (sourceRequiresCookie(id) ? 'cookie' : 'none');
}

/** Display name: localized for the official sources, the plugin's own name otherwise. */
export function sourceLabel(id: OnlineSource): string {
  const known = legacy(id);
  return known ? i18next.t(known.labelKey) : getMusicPluginInfo(id)?.name ?? id;
}

export function sourcePrependsLyricsTitle(id: OnlineSource | undefined): boolean {
  return !!id && !!legacy(id)?.prependsLyricsTitle;
}

/** True when the source can be queried now (signed in, or no sign-in needed). */
export function sourceIsReady(id: OnlineSource): boolean {
  return !sourceRequiresCookie(id) || cookieStoreFor(id).hasCookie();
}

export function providerFor(id: OnlineSource): OnlineMusicProvider {
  let provider = providers.get(id);
  if (!provider) {
    provider = createMusicPluginProvider(id, {
      cookies: cookieStoreFor(id),
      requiresCookie: () => sourceRequiresCookie(id),
      songDetails: legacy(id)?.songDetails ?? false,
    });
    providers.set(id, provider);
  }
  return provider;
}

/** Reloads the cookie stores whose settings keys changed (all of them by default). */
export function reloadCookieStores(changed: (key: string) => boolean = () => true): void {
  const stores = [...Object.values(LEGACY_SOURCES).map(source => source.cookies), ...cookieStores.values()];
  for (const store of stores) if (store.storageKeys().some(changed)) store.reload();
}

/** Ids with a cookie store worth syncing: the official sources plus every installed plugin. */
function knownSourceIds(): OnlineSource[] {
  return [...new Set([...Object.keys(LEGACY_SOURCES), ...musicPluginState.getSnapshot().plugins.map(plugin => plugin.id)])];
}

/**
 * Push renderer cookies into the main-process `stream://` proxy, which only
 * clears its resolved-URL cache for the source. Omit `source` to sync all.
 */
export async function syncOnlineCookiesToMain(source?: OnlineSource): Promise<void> {
  const api = await getDesktopAPIAsync();
  if (!api?.setOnlineCookie) return;
  const ids = source === undefined ? knownSourceIds() : [source];
  await Promise.all(ids.map(async id => {
    const store = cookieStoreFor(id);
    await store.ensureLoaded();
    await api.setOnlineCookie!(id, store.getCookie());
  }));
}

/** Mirrors credentials a plugin rewrote in the main process (e.g. a cookie refresh) into the renderer. */
export function subscribeMusicPluginSecrets(): () => void {
  return getDesktopAPI()?.onMusicPluginSecretsChanged?.(id => {
    const api = getDesktopAPI();
    if (!api?.settingsGet) return;
    const read = api.settingsGet.bind(api);
    const keys = legacy(id)?.secretKeys ?? [pluginCookieKey(id)];
    const cookieKey = legacy(id)?.cookieKey ?? pluginCookieKey(id);
    void Promise.all(keys.map(async key => [key, await read(key) ?? ''] as const)).then(async entries => {
      const values = Object.fromEntries(entries);
      await appStorage.setMany(values);
      await cookieStoreFor(id).setCookie(values[cookieKey] ?? '');
    }).catch(error => logger.warn('[MusicSources] Failed to synchronize credentials:', error));
  }) ?? (() => {});
}
