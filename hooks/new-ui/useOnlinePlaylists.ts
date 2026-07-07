import { useEffect, useState } from 'react';
import { cookieManager, neteaseCookieManager } from '../../services/cookieManager';
import { qqMusicApi } from '../../services/qqMusicApi';
import { neteaseMusicApi } from '../../services/neteaseMusicApi';
import { logger } from '../../services/logger';
import { loadPlaylistCache, savePlaylistCache } from '../../services/playlistCache';
import type { PlaylistInfo } from '../../services/onlineMusicProvider';

/**
 * Fetch the user's third-party (QQ Music / NetEase) playlists with a
 * two-phase loading strategy:
 *
 *   Phase 1 (sync-like): Load cached playlists from IndexedDB and return
 *   them immediately so the card wall renders instantly on startup.
 *
 *   Phase 2 (background): Validate cookies per source. Valid → fetch fresh
 *   from API and update cache. Invalid → keep cached data, skip the source.
 *
 * The `loading` flag is true only while Phase 2 is running. Once fresh
 * data arrives (or all sources fail), it flips to false.
 */
export function useOnlinePlaylists(): { playlists: PlaylistInfo[]; loading: boolean } {
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Phase 1: instant cache load
    loadPlaylistCache().then(cached => {
      if (cancelled || !cached) return;
      const fromCache: PlaylistInfo[] = [];
      if (cached.qq) fromCache.push(...cached.qq.map(p => ({ ...p, source: 'qq' as const })));
      if (cached.netease) fromCache.push(...cached.netease.map(p => ({ ...p, source: 'netease' as const })));
      if (fromCache.length > 0) {
        setPlaylists(fromCache);
        setLoading(false); // Show cache immediately
      }
    });

    // Phase 2: validate cookies + fetch fresh
    const fetchFresh = async () => {
      const results: PlaylistInfo[] = [];

      // QQ Music
      try {
        await cookieManager.ensureLoaded();
        if (cookieManager.hasCookie()) {
          const status = await cookieManager.validateCookie();
          if (status.valid) {
            const qq = await qqMusicApi.getPlaylists();
            results.push(...qq.map(p => ({ ...p, source: 'qq' as const })));
          }
        }
      } catch (e) {
        logger.warn('[useOnlinePlaylists] QQ playlists failed:', e);
      }

      // NetEase
      try {
        await neteaseCookieManager.ensureLoaded();
        if (neteaseCookieManager.hasCookie()) {
          const status = await neteaseCookieManager.validateCookie();
          if (status.valid) {
            const netease = await neteaseMusicApi.getPlaylists();
            results.push(...netease.map(p => ({ ...p, source: 'netease' as const })));
          }
        }
      } catch (e) {
        logger.warn('[useOnlinePlaylists] NetEase playlists failed:', e);
      }

      if (!cancelled) {
        setPlaylists(results);
        setLoading(false);

        // Update cache with fresh data
        const qqResults = results.filter(p => p.source === 'qq');
        const neteaseResults = results.filter(p => p.source === 'netease');
        savePlaylistCache(
          qqResults.length > 0 ? qqResults : undefined,
          neteaseResults.length > 0 ? neteaseResults : undefined,
        );
      }
    };

    fetchFresh();

    return () => {
      cancelled = true;
    };
  }, []);

  return { playlists, loading };
}
