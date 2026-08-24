import React from 'react';
import { toCoverThumb } from '../../services/coverUrl';

interface FocusCoverStageProps {
  coverUrl: string | undefined;
  isPlaying: boolean;
  scale?: number;
}

const FocusCoverStage: React.FC<FocusCoverStageProps> = ({ coverUrl, isPlaying, scale = 1 }) => (
  <div
    className="relative aspect-square w-[280px] lg:w-[340px] shadow-[0_30px_80px_rgba(0,0,0,0.5)] rounded-2xl overflow-hidden group"
    style={scale > 1 ? { width: `${340 * scale}px`, borderRadius: `${16 * scale}px` } : undefined}
  >
    <img
      src={toCoverThumb(coverUrl, 512 * scale)}
      className={`absolute inset-0 w-full h-full object-cover transition-transform duration-[6s] ${isPlaying ? 'scale-110' : 'scale-100'}`}
      alt="album cover"
    />
  </div>
);

export default FocusCoverStage;
