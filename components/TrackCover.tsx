import React, { useState, memo } from 'react';

interface TrackCoverProps {
  trackId: string;
  filePath?: string | undefined;
  fallbackUrl?: string | undefined;
  className?: string;
}

const PLACEHOLDER_SVG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%23222"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-size="14">♪</text></svg>';

export const TrackCover: React.FC<TrackCoverProps> = memo(({
  trackId: _trackId,
  filePath: _filePath,
  fallbackUrl,
  className = 'size-10 rounded-lg object-cover'
}) => {
  const [hasError, setHasError] = useState(false);

  const src = hasError || !fallbackUrl
    ? PLACEHOLDER_SVG
    : fallbackUrl;

  return (
    <img
      src={src}
      className={className}
      alt=""
      loading="lazy"
      onError={() => setHasError(true)}
    />
  );
}, (prevProps, nextProps) => {
  return prevProps.trackId === nextProps.trackId &&
         prevProps.filePath === nextProps.filePath &&
         prevProps.fallbackUrl === nextProps.fallbackUrl;
});

TrackCover.displayName = 'TrackCover';

export default TrackCover;
