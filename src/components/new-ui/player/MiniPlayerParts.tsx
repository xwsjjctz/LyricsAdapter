import React from 'react';
import { useTranslation } from 'react-i18next';
import { toCoverThumb } from '../../../services/coverUrl';
import type { Track } from '../../../types';

type PlaybackMode = 'order' | 'shuffle' | 'repeat-one';

interface MiniPlayerCoverProps {
  track: Track | null;
}

interface MiniPlayerMetaProps {
  track: Track | null;
}

interface MiniProgressProps {
  track: Track | null;
  duration: number;
  seekValue: number;
  progress: number;
  onSeek: (time: number) => void;
}

interface MiniTransportControlsProps {
  track: Track | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
}

interface MiniVolumeProps {
  volume: number;
  playbackMode: PlaybackMode;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onTogglePlaybackMode: () => void;
}

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
};

const playbackModeIcon: Record<PlaybackMode, string> = {
  order: 'repeat',
  shuffle: 'shuffle',
  'repeat-one': 'repeat_one',
};

const playbackModeLabel: Record<PlaybackMode, string> = {
  order: '顺序播放',
  shuffle: '随机播放',
  'repeat-one': '单曲循环',
};

export const MiniPlayerCover: React.FC<MiniPlayerCoverProps> = ({ track }) => (
  <div className="new-ux-player__cover" data-focus-transition="cover">
    {track?.coverUrl ? (
      <img src={toCoverThumb(track.coverUrl, 128)} alt="" />
    ) : (
      <span className="material-symbols-outlined flex size-full items-center justify-center text-[24px]">music_note</span>
    )}
  </div>
);

export const MiniPlayerMeta: React.FC<MiniPlayerMetaProps> = ({ track }) => {
  const { t } = useTranslation();
  return (
  <div className="new-ux-player__meta">
    <div className="new-ux-player__title" data-focus-transition="title">
      {track?.title ?? t('controls.noTrackSelected')}
    </div>
    <div className="new-ux-player__artist" data-focus-transition="artist">
      {track?.artist ?? t('mainPlayer.importTracks')}
    </div>
    {track && (
      <div className="new-ux-player__album" data-focus-transition="album">
        {track.album}
      </div>
    )}
  </div>
);
};

export const MiniProgress: React.FC<MiniProgressProps> = ({
  track,
  duration,
  seekValue,
  progress,
  onSeek,
}) => {
  const progressStyle = { '--player-progress': `${progress}%` } as React.CSSProperties;

  return (
    <div className="new-ux-player__timeline" data-focus-transition="progress">
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
  );
};

export const MiniTransportControls: React.FC<MiniTransportControlsProps> = ({
  track,
  isPlaying,
  onTogglePlay,
  onSkipNext,
  onSkipPrev,
}) => (
  <div className="new-ux-player__transport">
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
);

export const MiniVolume: React.FC<MiniVolumeProps> = ({
  volume,
  playbackMode,
  onVolumeChange,
  onToggleMute,
  onTogglePlaybackMode,
}) => {
  const volumeIcon = volume <= 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up';
  const volumeStyle = { '--player-volume': `${Math.round(volume * 100)}%` } as React.CSSProperties;

  return (
    <div className="new-ux-player__aux">
      <button
        type="button"
        className="new-ux-button-reset new-ux-icon-button new-ux-icon-button--compact"
        onClick={onTogglePlaybackMode}
        aria-label={playbackModeLabel[playbackMode]}
      >
        <span className="material-symbols-outlined text-[20px]">{playbackModeIcon[playbackMode]}</span>
      </button>
      <div className="new-ux-player__volume">
        <button
          type="button"
          className="new-ux-button-reset new-ux-icon-button new-ux-icon-button--compact"
          onClick={onToggleMute}
          aria-label="Toggle mute"
        >
          <span className="material-symbols-outlined text-[20px]">{volumeIcon}</span>
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          style={volumeStyle}
          onChange={(event) => onVolumeChange(Number(event.currentTarget.value))}
          aria-label="Volume"
        />
      </div>
    </div>
  );
};
