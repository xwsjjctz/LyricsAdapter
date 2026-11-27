import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Track } from '../../types';

interface FocusTrackMetaProps {
  track: Track | null;
  textPrimary: string;
  textMuted: string;
  scale?: number;
}

const FocusTrackMeta: React.FC<FocusTrackMetaProps> = ({ track, textPrimary, textMuted, scale = 1 }) => {
  const { t } = useTranslation();
  const title = track ? track.title : 'LyricsAdapter';
  const artist = track ? track.artist : t('focusMode.emptySubtitle');

  return (
    <div
      className="focus-track-meta mt-5 lg:mt-7 text-center w-full max-w-[340px]"
      style={scale > 1 ? { marginTop: `${28 * scale}px`, maxWidth: `${340 * scale}px` } : undefined}
    >
      <h1
        className="text-2xl lg:text-3xl font-extrabold tracking-tight mb-2 line-clamp-2 drop-shadow-2xl"
        style={{ color: textPrimary, ...(scale > 1 ? { fontSize: `${30 * scale}px`, lineHeight: 1.2, marginBottom: `${8 * scale}px` } : {}) }}
      >
        {title}
      </h1>
      <p
        className="text-base lg:text-lg font-semibold truncate opacity-80"
        style={{ color: textPrimary, ...(scale > 1 ? { fontSize: `${18 * scale}px`, lineHeight: 1.55 } : {}) }}
      >
        {artist}
      </p>
      {track?.album && (
        <p
          className="text-xs lg:text-sm font-medium truncate mt-1"
          style={{ color: textMuted, ...(scale > 1 ? { fontSize: `${14 * scale}px`, lineHeight: 1.43, marginTop: `${4 * scale}px` } : {}) }}
        >
          {track.album}
        </p>
      )}
    </div>
  );
};

export default FocusTrackMeta;
