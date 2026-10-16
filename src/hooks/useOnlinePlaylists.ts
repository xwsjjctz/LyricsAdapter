import { useEffect, useState } from 'react';
import { logger } from '../services/logger';
import { loadPlaylistCache, savePlaylistCache } from '../services/playlistCache';
import type { OnlineSource, PlaylistInfo } from '../services/onlineMusicProvider';
import { cookieStoreFor, providerFor, sourceHasCapability } from '../services/musicSources';
import { useMusicPlugins } from '../stores/musicPluginStore';
import { settingsManager } from '../services/settingsManager';
import { useSettingValue } from './useSettingValue';

const readOnlineEnabled = () => settingsManager.getQqMusicEnabled();

/**
 * Fetch the user's playlists from every signed-in source that offers them,
 * with a two-phase loading strategy:
 *
 *   Phase 1 (sync-like): Load cached playlists from IndexedDB and return
 *   them immediately so the sidebar renders useful content on startup.
 *
 *   Phase 2 (background): Validate cookies per source. Valid → fetch fresh
 *   from API and update cache. Invalid → keep cached data, skip the source.
 *
 * The `loading` flag is true only while Phase 2 is running. Once fresh
 * data arrives (or all sources fail), it flips to false.
 */
export function useOnlinePlaylists(): { playlists: PlaylistInfo[]; loading: boolean } {
  const { sources } = useMusicPlugins();
  const onlineEnabled = useSettingValue(readOnlineEnabled);
  const playlistSources = onlineEnabled ? sources.filter(source => sourceHasCapability(source, 'playlists')) : [];
  // Stable while the set of sources is unchanged.
  const sourceKey = playlistSources.join('|');
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [cookieRevision, setCookieRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setCookieRevision(revision => revision + 1);
    const unsubscribes = sourceKey ? sourceKey.split('|').map(source => cookieStoreFor(source).subscribe(refresh)) : [];
    return () => unsubscribes.forEach(unsubscribe => unsubscribe());
  }, [sourceKey]);

  useEffect(() => {
    const active: OnlineSource[] = sourceKey ? sourceKey.split('|') : [];
    if (active.length === 0) {
      setPlaylists([]); setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    // Phase 1: show cached playlists only for sources that currently have a
    // cookie. This prevents an old cache from making logged-out sources look
    // available in the sidebar while the fresh validation request is pending.
    const loadCachedForAuthenticatedSources = async () => {
      await Promise.all(active.map(source => cookieStoreFor(source).ensureLoaded()));
      if (cancelled) return;
      const authenticated = active.filter(source => cookieStoreFor(source).hasCookie());
      const cached = await loadPlaylistCache();
      if (cancelled || !cached) return;
      const fromCache = authenticated.flatMap(source => (cached.sources[source] ?? []).map(p => ({ ...p, source })));
      if (fromCache.length > 0) {
        setPlaylists(fromCache);
        setLoading(false); // Show authenticated cache immediately
      }
    };

    void loadCachedForAuthenticatedSources();

    // Phase 2: validate cookies + fetch fresh
    const fetchFresh = async () => {
      const fresh: Record<OnlineSource, PlaylistInfo[]> = {};
      for (const source of active) {
        try {
          const cookies = cookieStoreFor(source);
          await cookies.ensureLoaded();
          if (cancelled || !cookies.hasCookie()) continue;
          if (!(await cookies.validateCookie()).valid) continue;
          const lists = await providerFor(source).getPlaylists();
          if (lists.length > 0) fresh[source] = lists.map(p => ({ ...p, source }));
        } catch (e) {
          logger.warn(`[useOnlinePlaylists] ${source} playlists failed:`, e);
        }
      }

      if (!cancelled) {
        setPlaylists(Object.values(fresh).flat());
        setLoading(false);
        void savePlaylistCache(fresh);
      }
    };

    void fetchFresh();

    return () => {
      cancelled = true;
    };
  }, [cookieRevision, sourceKey]);

  return { playlists: playlists.filter(playlist => playlistSources.includes(playlist.source)), loading };
}
