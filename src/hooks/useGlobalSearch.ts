import { useEffect, useMemo, useRef, useState } from 'react';
import { logger } from '../services/logger';
import type { OnlineSong, OnlineSource } from '../services/onlineMusicProvider';
import { providerFor, sourceIsReady } from '../services/musicSources';
import { settingsManager } from '../services/settingsManager';
import { useMusicPlugins } from '../stores/musicPluginStore';
import { useSettingValue } from './useSettingValue';
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
  /** A provider filled its limit, so asking for a higher limit may return more. */
  onlineHasMore: boolean;
}

/** Library matching plus debounced search across every enabled music source; stale responses are dropped. */
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
  const [onlineHasMore, setOnlineHasMore] = useState(false);
  const shownQuery = useRef('');
  const { sources } = useMusicPlugins();
  const onlineEnabled = useSettingValue(readOnlineEnabled) && sources.length > 0;
  // Stable across renders while the source list is unchanged.
  const sourceKey = sources.join('|');
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
      shownQuery.current = '';
      setOnline([]);
      setOnlineLoading(false);
      setOnlineHasMore(false);
      return;
    }

    let isCurrentSearch = true;
    // Raising the limit for the same query keeps the rows already shown; the
    // provider API has no offset, so "more" re-requests a longer first page.
    const extending = shownQuery.current === trimmed;
    if (!extending) { shownQuery.current = ''; setOnline([]); setOnlineHasMore(false); }
    setOnlineLoading(true);
    const debounceTimer = setTimeout(async () => {
      // Sources that need a sign-in are only searched once signed in.
      const searched = sourceKey.split('|').filter(sourceIsReady);
      const results = await Promise.allSettled(searched.map(source => providerFor(source).searchMusic(trimmed, onlineLimit)));
      if (!isCurrentSearch) return;

      const songsBySource = results.map((result, index) => {
        if (result.status === 'fulfilled') return result.value;
        logger.warn(`[GlobalSearch] ${searched[index]} search failed:`, result.reason);
        return [] as OnlineSong[];
      });
      setOnline(songsBySource.flatMap((songs, index) => songs.map(song => ({ source: searched[index]!, song }))));
      setOnlineHasMore(songsBySource.some(songs => songs.length >= onlineLimit));
      setOnlineLoading(false);
      shownQuery.current = trimmed;
    }, extending ? 0 : ONLINE_SEARCH_DEBOUNCE_MS);

    return () => {
      isCurrentSearch = false;
      clearTimeout(debounceTimer);
    };
  }, [trimmed, active, onlineEnabled, onlineLimit, sourceKey]);

  return { local, cloud, online, onlineLoading, onlineEnabled, onlineHasMore };
}
