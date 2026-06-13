import { useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '../types';
import { QQMusicSong, qqMusicApi } from '../services/qqMusicApi';
import { logger } from '../services/logger';

const QQ_DEBOUNCE_MS = 300;

export interface UseQQSearchOptions {
  query: string;
  localTracks: Track[];
  cloudTracks: Track[];
  /** Whether the search UI is currently active (expanded / open). When false, QQ search is skipped. */
  active: boolean;
  maxResults?: number;
}

export interface QQSearchResult {
  filteredLocal: Track[];
  filteredCloud: Track[];
  qqResults: QQMusicSong[];
  qqLoading: boolean;
}

/**
 * Shared search/filter logic for SearchBox and GlobalSearch.
 * UI state (focus, selected index, quality dropdown) is owned by the caller.
 */
export function useQQSearch({
  query,
  localTracks,
  cloudTracks,
  active,
  maxResults = 8,
}: UseQQSearchOptions): QQSearchResult {
  const [qqResults, setQqResults] = useState<QQMusicSong[]>([]);
  const [qqLoading, setQqLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const q = query.trim().toLowerCase();
  const filteredLocal = useMemo(() => {
    if (!q) return [];
    return localTracks
      .filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q))
      .slice(0, maxResults);
  }, [localTracks, q, maxResults]);

  const filteredCloud = useMemo(() => {
    if (!q) return [];
    return cloudTracks
      .filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q))
      .slice(0, maxResults);
  }, [cloudTracks, q, maxResults]);

  useEffect(() => {
    if (!query.trim() || !active) {
      setQqResults([]);
      setQqLoading(false);
      return;
    }
    setQqLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await qqMusicApi.searchMusic(query.trim(), maxResults);
        setQqResults(results);
      } catch (err) {
        logger.warn('[useQQSearch] QQ Music search failed:', err);
        setQqResults([]);
      } finally {
        setQqLoading(false);
      }
    }, QQ_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, active, maxResults]);

  return { filteredLocal, filteredCloud, qqResults, qqLoading };
}
