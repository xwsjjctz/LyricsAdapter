import { useEffect, useState } from 'react';
import { cookieManager, neteaseCookieManager, sodaCookieManager } from '../services/cookieManager';
import { qqMusicApi } from '../services/qqMusicApi';
import { neteaseMusicApi } from '../services/neteaseMusicApi';
import { sodaMusicApi } from '../services/sodaMusicApi';
import { logger } from '../services/logger';
import { loadPlaylistCache, savePlaylistCache } from '../services/playlistCache';
import type { PlaylistInfo } from '../services/onlineMusicProvider';

/**
 * Fetch the user's third-party playlists with a
 * two-phase loading strategy:
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
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Phase 1: show cached playlists only for sources that currently have a
    // cookie. This prevents an old cache from making logged-out sources look
    // available in the sidebar while the fresh validation request is pending.
    const loadCachedForAuthenticatedSources = async () => {
      await Promise.all([
        cookieManager.ensureLoaded(),
        neteaseCookieManager.ensureLoaded(),
        sodaCookieManager.ensureLoaded(),
      ]);
      if (cancelled) return;

      const authenticatedSources = new Set<PlaylistInfo['source']>();
      if (cookieManager.hasCookie()) authenticatedSources.add('qq');
      if (neteaseCookieManager.hasCookie()) authenticatedSources.add('netease');
      if (sodaCookieManager.hasCookie()) authenticatedSources.add('soda');

      const cached = await loadPlaylistCache();
      if (cancelled || !cached) return;
      const fromCache: PlaylistInfo[] = [];
      if (cached.qq && authenticatedSources.has('qq')) {
        fromCache.push(...cached.qq.map(p => ({ ...p, source: 'qq' as const })));
      }
      if (cached.netease && authenticatedSources.has('netease')) {
        fromCache.push(...cached.netease.map(p => ({ ...p, source: 'netease' as const })));
      }
      if (cached.soda && authenticatedSources.has('soda')) {
        fromCache.push(...cached.soda.map(p => ({ ...p, source: 'soda' as const })));
      }
      if (fromCache.length > 0) {
        setPlaylists(fromCache);
        setLoading(false); // Show authenticated cache immediately
      }
    };

    void loadCachedForAuthenticatedSources();

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

      // Soda Music uses a manually supplied Cookie; upstream QR login is not
      // stable enough to expose here.
      try {
        await sodaCookieManager.ensureLoaded();
        if (sodaCookieManager.hasCookie()) {
          const status = await sodaCookieManager.validateCookie();
          if (status.valid) {
            const soda = await sodaMusicApi.getPlaylists();
            results.push(...soda.map(p => ({ ...p, source: 'soda' as const })));
          }
        }
      } catch (e) {
        logger.warn('[useOnlinePlaylists] Soda playlists failed:', e);
      }

      if (!cancelled) {
        setPlaylists(results);
        setLoading(false);

        // Update cache with fresh data
        const qqResults = results.filter(p => p.source === 'qq');
        const neteaseResults = results.filter(p => p.source === 'netease');
        const sodaResults = results.filter(p => p.source === 'soda');
        savePlaylistCache(
          qqResults.length > 0 ? qqResults : undefined,
          neteaseResults.length > 0 ? neteaseResults : undefined,
          sodaResults.length > 0 ? sodaResults : undefined,
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
