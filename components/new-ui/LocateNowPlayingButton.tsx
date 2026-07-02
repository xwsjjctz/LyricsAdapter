import React from 'react';
import { toCoverThumb } from '../../services/coverUrl';
import type { Track } from '../../types';

interface LocateNowPlayingButtonProps {
  track: Track;
  onLocate: () => void;
}

const LocateNowPlayingButton: React.FC<LocateNowPlayingButtonProps> = ({ track, onLocate }) => {
  return (
    <button
      type="button"
      className="new-ux-button-reset new-ux-locate-button"
      onClick={onLocate}
      title="Locate now playing"
      aria-label="Locate now playing"
    >
      <span className="new-ux-locate-button__cover">
        {track.coverUrl ? (
          <img src={toCoverThumb(track.coverUrl, 96)} alt="" />
        ) : (
          <span className="material-symbols-outlined text-[20px]">music_note</span>
        )}
      </span>
      <span className="material-symbols-outlined text-[20px]">gps_fixed</span>
    </button>
  );
};

export default LocateNowPlayingButton;
