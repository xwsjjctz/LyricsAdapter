import React from 'react';
import type { Track } from '../../types';

interface FocusTrackMetaProps {
  track: Track | null;
  textPrimary: string;
  textMuted: string;
}

const FocusTrackMeta: React.FC<FocusTrackMetaProps> = ({ track, textPrimary, textMuted }) => (
  <div className="mt-5 lg:mt-7 text-center w-full max-w-[340px]">
    <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight mb-2 line-clamp-2 drop-shadow-2xl" style={{ color: textPrimary }}>
      {track?.title}
    </h1>
    <p className="text-base lg:text-lg font-semibold truncate opacity-80" style={{ color: textPrimary }}>
      {track?.artist}
    </p>
    <p className="text-xs lg:text-sm font-medium truncate mt-1" style={{ color: textMuted }}>
      {track?.album}
    </p>
  </div>
);

export default FocusTrackMeta;
