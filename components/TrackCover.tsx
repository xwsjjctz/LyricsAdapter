import React, { useState, useRef, useEffect, memo } from 'react';

interface TrackCoverProps {
  trackId: string;
  filePath?: string | undefined;
  fallbackUrl?: string | undefined;
  className?: string;
}

const PLACEHOLDER_SVG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%23222"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-size="14">♪</text></svg>';
const RETRY_DELAYS = [2000, 4000, 8000];

export const TrackCover: React.FC<TrackCoverProps> = memo(({
  trackId: _trackId,
  filePath: _filePath,
  fallbackUrl,
  className = 'size-10 rounded-lg object-cover'
}) => {
  const [hasError, setHasError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const retryIndexRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset when URL changes
  useEffect(() => {
    setHasError(false);
    setRetryKey(0);
    retryIndexRef.current = 0;
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [fallbackUrl]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  const handleError = () => {
    // For cover:// URLs, retry a few times in case lazy migration is still in progress
    if (fallbackUrl?.startsWith('cover://') && retryIndexRef.current < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[retryIndexRef.current]!;
      retryIndexRef.current++;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setHasError(false);
        setRetryKey(k => k + 1);
      }, delay);
    } else {
      setHasError(true);
    }
  };

  if (hasError || !fallbackUrl) {
    return <img src={PLACEHOLDER_SVG} className={className} alt="" />;
  }

  return (
    <img
      key={retryKey}
      src={fallbackUrl}
      className={className}
      alt=""
      loading="lazy"
      onError={handleError}
    />
  );
}, (prevProps, nextProps) => {
  return prevProps.trackId === nextProps.trackId &&
         prevProps.filePath === nextProps.filePath &&
         prevProps.fallbackUrl === nextProps.fallbackUrl;
});

TrackCover.displayName = 'TrackCover';

export default TrackCover;
