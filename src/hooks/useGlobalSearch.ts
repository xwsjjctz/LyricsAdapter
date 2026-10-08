import { useEffect, useMemo, useState } from 'react';
import { cookieManager } from '../services/cookieManager';
import { logger } from '../services/logger';
import { neteaseMusicApi } from '../services/neteaseMusicApi';
import type { OnlineSong, OnlineSource } from '../services/onlineMusicProvider';
import { qqMusicApi } from '../services/qqMusicApi';
import { settingsManager } from '../services/settingsManager';
import { useMusicPlugins } from '../stores/musicPluginStore';
import { useSettingValue } from '../components/settings/hooks/useSettingValue';
import { searchTracks, type TrackSearchResult } from '../services/trackSearch';
import type { Track } from '../types';

export const ONLINE_SEARCH_DEBOUNCE_MS = 500;
const readOnlineEnabled = () => settingsManager.getQqMusicEnabled();

export interface OnlineSearchHit {
  source: OnlineSource;
  song: OnlineSong;
}

export interface GlobalSearchOptions {
  query: string;
  /** Online requests only run while the results are visible. */
  active: boolean;
  localTracks: Track[];
  cloudTracks: Track[];
  /** Max local/cloud items returned per group; totals are always complete. */
  libraryLimit?: number;
  /** Max online songs requested from each provider. */
  onlineLimit: number;
}

export interface GlobalSearchResults {
  local: TrackSearchResult;
  cloud: TrackSearchResult;
  online: OnlineSearchHit[];
  onlineLoading: boolean;
  onlineEnabled: boolean;
}

/** Library matching plus debounced QQ/NetEase search; stale responses are dropped. */
export function useGlobalSearch({
  query,
  active,
  localTracks,
  cloudTracks,
  libraryLimit,
  onlineLimit,
}: GlobalSearchOptions): GlobalSearchResults {
  const [online, setOnline] = useState<OnlineSearchHit[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const { sources } = useMusicPlugins();
  const hasQQ = sources.includes('qq');
  const hasNetEase = sources.includes('netease');
  const onlineEnabled = useSettingValue(readOnlineEnabled) && (hasQQ || hasNetEase);
  const trimmed = query.trim();

  const local = useMemo(
    () => (trimmed ? searchTracks(localTracks, trimmed, libraryLimit) : { items: [], total: 0 }),
    [localTracks, trimmed, libraryLimit],
  );
  const cloud = useMemo(
    () => (trimmed ? searchTracks(cloudTracks, trimmed, libraryLimit) : { items: [], total: 0 }),
    [cloudTracks, trimmed, libraryLimit],
  );

  useEffect(() => {
    if (!trimmed || !active || !onlineEnabled) {
      setOnline([]);
      setOnlineLoading(false);
      return;
    }

    let isCurrentSearch = true;
    setOnline([]);
    setOnlineLoading(true);
    const debounceTimer = setTimeout(async () => {
      const [qqResult, neteaseResult] = await Promise.allSettled([
        hasQQ && cookieManager.hasCookie() ? qqMusicApi.searchMusic(trimmed, onlineLimit) : Promise.resolve([] as OnlineSong[]),
        hasNetEase ? neteaseMusicApi.searchMusic(trimmed, onlineLimit) : Promise.resolve([] as OnlineSong[]),
      ]);
      if (!isCurrentSearch) return;

      if (qqResult.status === 'rejected') logger.warn('[GlobalSearch] QQ search failed:', qqResult.reason);
      if (neteaseResult.status === 'rejected') logger.warn('[GlobalSearch] NetEase search failed:', neteaseResult.reason);

      const qqSongs = qqResult.status === 'fulfilled' ? qqResult.value : [];
      const neteaseSongs = neteaseResult.status === 'fulfilled' ? neteaseResult.value : [];
      setOnline([
        ...qqSongs.map(song => ({ source: 'qq' as const, song })),
        ...neteaseSongs.map(song => ({ source: 'netease' as const, song })),
      ]);
      setOnlineLoading(false);
    }, ONLINE_SEARCH_DEBOUNCE_MS);

    return () => {
      isCurrentSearch = false;
      clearTimeout(debounceTimer);
    };
  }, [trimmed, active, onlineEnabled, onlineLimit, hasQQ, hasNetEase]);

  return { local, cloud, online, onlineLoading, onlineEnabled };
}
