/**
 * Track Cover Component
 * Displays cover art for a track, loading from:
 * 1. IndexedDB cache (if available)
 * 2. Audio file metadata (if filePath is provided)
 * 3. Fallback URL or placeholder
 */

import React, { useState, useEffect, useRef, memo } from 'react';
import { coverArtService } from '../services/coverArtService';
import { logger } from '../services/logger';

interface TrackCoverProps {
  trackId: string;
  filePath?: string;
  fallbackUrl?: string;
  className?: string;
}

const PLACEHOLDER_SVG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%23222"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-size="14">♪</text></svg>';

export const TrackCover: React.FC<TrackCoverProps> = memo(({
  trackId,
  filePath,
  fallbackUrl,
  className = 'size-10 rounded-lg object-cover'
}) => {
  const [coverUrl, setCoverUrl] = useState<string>(PLACEHOLDER_SVG);
  const [isLoaded, setIsLoaded] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const loadCover = async () => {
      if (loadingRef.current) return;
      loadingRef.current = true;

      try {
        const url = await coverArtService.getCoverUrl({
          id: trackId,
          filePath,
          coverUrl: fallbackUrl
        });

        if (mounted) {
          setCoverUrl(url);
          setIsLoaded(true);
        }
      } catch (error) {
        logger.warn(`[TrackCover] Failed to load cover for ${trackId}:`, error);
        if (mounted && fallbackUrl) {
          setCoverUrl(fallbackUrl);
          setIsLoaded(true);
        }
      } finally {
        loadingRef.current = false;
      }
    };

    loadCover();

    return () => {
      mounted = false;
    };
  }, [trackId, filePath, fallbackUrl]);

  return (
    <img
      src={coverUrl}
      className={`${className} ${isLoaded ? 'opacity-100' : 'opacity-50'} transition-opacity duration-200`}
      alt=""
      loading="lazy"
    />
  );
}, (prevProps, nextProps) => {
  // Only re-render if trackId or filePath changes
  return prevProps.trackId === nextProps.trackId && 
         prevProps.filePath === nextProps.filePath &&
         prevProps.fallbackUrl === nextProps.fallbackUrl;
});

TrackCover.displayName = 'TrackCover';

export default TrackCover;
