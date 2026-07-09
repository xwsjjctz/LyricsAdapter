import React from 'react';
import type { Track } from '../../types';
import {
  MiniPlayerCover,
  MiniPlayerMeta,
  MiniProgress,
  MiniTransportControls,
  MiniVolume,
} from './player/MiniPlayerParts';

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

type PlaybackMode = 'order' | 'shuffle' | 'repeat-one';

interface FloatingPlayerPanelProps {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  playbackMode: PlaybackMode;
  transitionRef?: React.RefObject<HTMLDivElement>;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onTogglePlaybackMode: () => void;
  onToggleFocus: () => void;
}

const FloatingPlayerPanel: React.FC<FloatingPlayerPanelProps> = ({
  track,
  isPlaying,
  currentTime,
  volume,
  playbackMode,
  transitionRef,
  onTogglePlay,
  onSkipNext,
  onSkipPrev,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onTogglePlaybackMode,
  onToggleFocus,
}) => {
  const duration = Math.max(track?.duration ?? 0, 0);
  const seekValue = duration > 0 ? clamp(currentTime, 0, duration) : 0;
  const progress = duration > 0 ? (seekValue / duration) * 100 : 0;

  return (
    <div ref={transitionRef} className="new-ux-player">
      <div className="new-ux-player__body">
        <button
          type="button"
          className="new-ux-button-reset new-ux-player__track"
          onClick={track ? onToggleFocus : undefined}
          aria-label="Open focus mode"
        >
          <MiniPlayerCover track={track} />
          <MiniPlayerMeta track={track} />
        </button>
        <MiniProgress track={track} duration={duration} seekValue={seekValue} progress={progress} onSeek={onSeek} />
      </div>
      <div className="new-ux-player__controls">
        <MiniTransportControls
          track={track}
          isPlaying={isPlaying}
          onTogglePlay={onTogglePlay}
          onSkipNext={onSkipNext}
          onSkipPrev={onSkipPrev}
        />
        <MiniVolume
          volume={volume}
          playbackMode={playbackMode}
          onVolumeChange={onVolumeChange}
          onToggleMute={onToggleMute}
          onTogglePlaybackMode={onTogglePlaybackMode}
        />
      </div>
    </div>
  );
};

export default FloatingPlayerPanel;
