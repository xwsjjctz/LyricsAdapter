import React from 'react';
import { toCoverThumb } from '../../services/coverUrl';
import type { Track } from '../../types';
import { i18n } from '../../services/i18n';

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

interface FloatingPlayerPanelProps {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onSeek: (time: number) => void;
  onToggleFocus: () => void;
}

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
};

const FloatingPlayerPanel: React.FC<FloatingPlayerPanelProps> = ({
  track,
  isPlaying,
  currentTime,
  onTogglePlay,
  onSkipNext,
  onSkipPrev,
  onSeek,
  onToggleFocus,
}) => {
  const duration = Math.max(track?.duration ?? 0, 0);
  const seekValue = duration > 0 ? clamp(currentTime, 0, duration) : 0;
  const progress = duration > 0 ? (seekValue / duration) * 100 : 0;
  const progressStyle = { '--player-progress': `${progress}%` } as React.CSSProperties;

  return (
    <div className="new-ux-player">
      <div className="new-ux-player__body">
        <button
          type="button"
          className="new-ux-button-reset new-ux-player__track"
          onClick={track ? onToggleFocus : undefined}
          aria-label="Open focus mode"
        >
          <div className="new-ux-player__cover">
            {track?.coverUrl ? (
              <img src={toCoverThumb(track.coverUrl, 128)} alt="" />
            ) : (
              <span className="material-symbols-outlined flex size-full items-center justify-center text-[24px]">music_note</span>
            )}
          </div>
          <div className="min-w-0 text-left">
            <div className="new-ux-player__title">{track?.title ?? i18n.t('controls.noTrackSelected')}</div>
            <div className="new-ux-player__artist">{track ? `${track.artist} · ${track.album}` : i18n.t('mainPlayer.importTracks')}</div>
          </div>
        </button>
        <div className="new-ux-player__timeline">
          <span>{formatTime(seekValue)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={seekValue}
            disabled={!track || duration <= 0}
            style={progressStyle}
            onChange={(event) => onSeek(Number(event.currentTarget.value))}
            aria-label="Seek"
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div className="new-ux-player__controls">
        <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onSkipPrev} disabled={!track}>
          <span className="material-symbols-outlined text-[24px]">skip_previous</span>
        </button>
        <button type="button" className="new-ux-button-reset new-ux-icon-button new-ux-icon-button--primary" onClick={onTogglePlay} disabled={!track}>
          <span className="material-symbols-outlined text-[26px] fill-icon">{isPlaying ? 'pause' : 'play_arrow'}</span>
        </button>
        <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onSkipNext} disabled={!track}>
          <span className="material-symbols-outlined text-[24px]">skip_next</span>
        </button>
      </div>
    </div>
  );
};

export default FloatingPlayerPanel;
