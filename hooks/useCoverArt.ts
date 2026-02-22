/**
 * Cover Art Hook
 * Manages cover art loading and caching for tracks
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { coverArtService } from '../services/coverArtService';
import { logger } from '../services/logger';

interface UseCoverArtOptions {
  trackId: string;
  filePath?: string;
  fallbackUrl?: string;
}

interface UseCoverArtResult {
  coverUrl: string;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useCoverArt({ trackId, filePath, fallbackUrl }: UseCoverArtOptions): UseCoverArtResult {
  const [coverUrl, setCoverUrl] = useState<string>(fallbackUrl || getPlaceholderUrl());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const loadCover = useCallback(async () => {
    if (!trackId) return;

    setIsLoading(true);
    setError(null);

    try {
      const url = await coverArtService.getCoverUrl({
        id: trackId,
        filePath,
        coverUrl: fallbackUrl
      });

      if (mountedRef.current) {
        setCoverUrl(url);
      }
    } catch (err) {
      logger.warn(`[useCoverArt] Failed to load cover for ${trackId}:`, err);
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        // Keep fallback URL on error
        if (fallbackUrl) {
          setCoverUrl(fallbackUrl);
        }
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [trackId, filePath, fallbackUrl]);

  useEffect(() => {
    mountedRef.current = true;
    loadCover();

    return () => {
      mountedRef.current = false;
    };
  }, [loadCover]);

  return {
    coverUrl,
    isLoading,
    error,
    refresh: loadCover
  };
}

/**
 * Hook for managing multiple track covers (batch loading)
 */
interface UseCoverArtBatchOptions {
  tracks: Array<{
    id: string;
    filePath?: string;
    coverUrl?: string;
  }>;
  preloadCount?: number; // Number of visible items to preload
}

interface UseCoverArtBatchResult {
  getCoverUrl: (trackId: string) => string;
  isLoading: boolean;
  preloadCovers: (trackIds: string[]) => Promise<void>;
}

export function useCoverArtBatch({ tracks, preloadCount = 20 }: UseCoverArtBatchOptions): UseCoverArtBatchResult {
  const [coverUrls, setCoverUrls] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const loadedTracksRef = useRef<Set<string>>(new Set());

  // Load initial covers
  useEffect(() => {
    const loadInitialCovers = async () => {
      if (tracks.length === 0) return;

      setIsLoading(true);

      try {
        // Load first batch of covers
        const tracksToLoad = tracks.slice(0, preloadCount);
        const newUrls = new Map<string, string>();

        await Promise.all(
          tracksToLoad.map(async (track) => {
            if (loadedTracksRef.current.has(track.id)) return;

            try {
              const url = await coverArtService.getCoverUrl({
                id: track.id,
                filePath: track.filePath,
                coverUrl: track.coverUrl
              });

              newUrls.set(track.id, url);
              loadedTracksRef.current.add(track.id);
            } catch (error) {
              // Use fallback on error
              if (track.coverUrl) {
                newUrls.set(track.id, track.coverUrl);
              }
            }
          })
        );

        setCoverUrls(prev => {
          const merged = new Map(prev);
          newUrls.forEach((url, id) => merged.set(id, url));
          return merged;
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialCovers();
  }, [tracks, preloadCount]);

  const getCoverUrl = useCallback((trackId: string): string => {
    return coverUrls.get(trackId) || getPlaceholderUrl();
  }, [coverUrls]);

  const preloadCovers = useCallback(async (trackIds: string[]): Promise<void> => {
    const tracksToLoad = tracks.filter(t => trackIds.includes(t.id) && !loadedTracksRef.current.has(t.id));

    if (tracksToLoad.length === 0) return;

    await Promise.all(
      tracksToLoad.map(async (track) => {
        try {
          const url = await coverArtService.getCoverUrl({
            id: track.id,
            filePath: track.filePath,
            coverUrl: track.coverUrl
          });

          setCoverUrls(prev => {
            const newMap = new Map(prev);
            newMap.set(track.id, url);
            return newMap;
          });
          loadedTracksRef.current.add(track.id);
        } catch (error) {
          // Silently fail for preloading
        }
      })
    );
  }, [tracks]);

  return {
    getCoverUrl,
    isLoading,
    preloadCovers
  };
}

function getPlaceholderUrl(): string {
  return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%23222"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-size="10">♪</text></svg>';
}
