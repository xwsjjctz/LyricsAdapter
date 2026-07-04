import { useEffect, useState } from 'react';
import { cookieManager, neteaseCookieManager } from '../../services/cookieManager';
import { qqMusicApi } from '../../services/qqMusicApi';
import { neteaseMusicApi } from '../../services/neteaseMusicApi';
import { logger } from '../../services/logger';
import type { PlaylistInfo } from '../../services/onlineMusicProvider';

/**
 * Fetch the user's third-party (QQ Music / NetEase) playlists once on mount, for
 * logged-in sources only. Mirrors the legacy PlaylistsView mount fetch. Returns
 * the flat list plus a loading flag so callers can show a placeholder.
 */
export function useOnlinePlaylists(): { playlists: PlaylistInfo[]; loading: boolean } {
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const results: PlaylistInfo[] = [];
      try {
        if (cookieManager.hasCookie()) {
          const qq = await qqMusicApi.getPlaylists();
          results.push(...qq.map(p => ({ ...p, source: 'qq' as const })));
        }
      } catch (e) {
        logger.warn('[useOnlinePlaylists] QQ playlists failed:', e);
      }
      try {
        if (neteaseCookieManager.hasCookie()) {
          const netease = await neteaseMusicApi.getPlaylists();
          results.push(...netease.map(p => ({ ...p, source: 'netease' as const })));
        }
      } catch (e) {
        logger.warn('[useOnlinePlaylists] NetEase playlists failed:', e);
      }
      if (!cancelled) {
        setPlaylists(results);
        setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { playlists, loading };
}
