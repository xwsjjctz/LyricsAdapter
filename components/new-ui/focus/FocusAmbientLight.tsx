import React from 'react';
import { toCoverThumb } from '../../../services/coverUrl';
import type { Track } from '../../../types';

interface FocusAmbientLightProps {
  track: Track | null;
  isPlaying: boolean;
}

const FocusAmbientLight: React.FC<FocusAmbientLightProps> = ({ track, isPlaying }) => {
  const style = track?.coverUrl
    ? ({ '--new-ux-focus-cover-image': `url("${toCoverThumb(track.coverUrl, 768)}")` } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={`new-ux-focus-ambient${isPlaying ? ' new-ux-focus-ambient--playing' : ' new-ux-focus-ambient--paused'}`}
      style={style}
      aria-hidden="true"
    >
      <div className="new-ux-focus-ambient__cover" />
      <div className="new-ux-focus-ambient__beam new-ux-focus-ambient__beam--a" />
      <div className="new-ux-focus-ambient__beam new-ux-focus-ambient__beam--b" />
      <div className="new-ux-focus-ambient__beam new-ux-focus-ambient__beam--c" />
    </div>
  );
};

export default FocusAmbientLight;
