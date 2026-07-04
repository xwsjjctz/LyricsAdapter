import React from 'react';
import type { Track } from '../../types';

interface LocateNowPlayingButtonProps {
  /** Kept for call-site compatibility; the cover is intentionally not shown
   *  because the control bar already displays it. */
  track: Track;
  onLocate: () => void;
}

const LocateNowPlayingButton: React.FC<LocateNowPlayingButtonProps> = ({ onLocate }) => (
  <button
    type="button"
    className="new-ux-button-reset new-ux-icon-button new-ux-locate-button"
    onClick={onLocate}
    title="Locate now playing"
    aria-label="Locate now playing"
  >
    <span className="material-symbols-outlined text-[20px]">gps_fixed</span>
  </button>
);

export default LocateNowPlayingButton;
