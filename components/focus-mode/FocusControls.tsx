import React from 'react';
import type { Track } from '../../types';
import type { ThemeColors } from '../../types/theme';

type PlaybackMode = 'order' | 'shuffle' | 'repeat-one';

interface FocusControlsProps {
  track: Track | null;
  colors: ThemeColors;
  isPlaying: boolean;
  isPlayerVisible: boolean;
  activeCurrentTime: number;
  progress: number;
  volume: number;
  playbackMode: PlaybackMode;
  playerRef: React.Ref<HTMLDivElement>;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onTogglePlaybackMode: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const formatTime = (seconds: number): string => {
  if (isNaN(seconds) || seconds === 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const playbackModeIcon: Record<PlaybackMode, string> = {
  order: 'repeat',
  shuffle: 'shuffle',
  'repeat-one': 'repeat_one',
};

const FocusControls: React.FC<FocusControlsProps> = ({
  track,
  colors,
  isPlaying,
  isPlayerVisible,
  activeCurrentTime,
  progress,
  volume,
  playbackMode,
  playerRef,
  onSeek,
  onTogglePlay,
  onSkipNext,
  onSkipPrev,
  onVolumeChange,
  onToggleMute,
  onTogglePlaybackMode,
  onMouseEnter,
  onMouseLeave,
}) => (
  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xl px-5">
    <div
      ref={playerRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="glass p-4 flex flex-col gap-3 relative z-20 transition-opacity duration-500"
      style={{
        opacity: isPlayerVisible ? 1 : 0,
        borderRadius: 'var(--theme-surface-radius)',
        border: `var(--theme-panel-border-width) solid ${colors.borderLight}`,
        backgroundColor: colors.backgroundDark,
        boxShadow: 'var(--theme-surface-shadow)',
      }}
    >
      <div className="w-full flex items-center gap-3">
        <span className="text-[10px] tabular-nums font-bold w-10 text-right" style={{ color: colors.textMuted }}>
          {formatTime(activeCurrentTime)}
        </span>
        <div
          className="flex-1 relative h-1 cursor-pointer group"
          style={{ backgroundColor: colors.borderLight, borderRadius: 'var(--theme-progress-radius)' }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const pct = x / rect.width;
            onSeek(pct * (track?.duration || 0));
          }}
        >
          <div
            className="absolute top-0 left-0 h-full transition-all duration-100"
            style={{ width: `${progress}%`, backgroundColor: colors.primary, boxShadow: `0 0 15px ${colors.glowColor}`, borderRadius: 'var(--theme-progress-radius)' }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 size-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `${progress}%`, marginLeft: '-4px', backgroundColor: colors.textPrimary, borderRadius: 'var(--theme-progress-radius)' }}
          />
        </div>
        <span className="text-[10px] tabular-nums font-bold w-10" style={{ color: colors.textMuted }}>
          {formatTime(track?.duration || 0)}
        </span>
      </div>

      <div className="flex items-center justify-between px-4">
        <div className="flex gap-4" style={{ color: colors.textMuted }}>
          <span
            className="material-symbols-outlined text-lg cursor-pointer transition-colors relative -left-[4px]"
            style={{ color: colors.textMuted }}
            onClick={onTogglePlaybackMode}
            onMouseEnter={event => { event.currentTarget.style.color = colors.textPrimary; }}
            onMouseLeave={event => { event.currentTarget.style.color = colors.textMuted; }}
          >
            {playbackModeIcon[playbackMode]}
          </span>
        </div>

        <div className="flex items-center gap-6 relative left-[30px]">
          <button
            type="button"
            onClick={onSkipPrev}
            className="transition-all hover:scale-110"
            style={{ color: colors.textSecondary }}
            onMouseEnter={event => { event.currentTarget.style.color = colors.textPrimary; }}
            onMouseLeave={event => { event.currentTarget.style.color = colors.textSecondary; }}
          >
            <span className="material-symbols-outlined text-2xl">skip_previous</span>
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            className="size-11 flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg"
            style={{ backgroundColor: colors.textPrimary, color: colors.backgroundDark, borderRadius: 'var(--theme-button-radius)' }}
          >
            <span className="material-symbols-outlined text-3xl">{isPlaying ? 'pause' : 'play_arrow'}</span>
          </button>
          <button
            type="button"
            onClick={onSkipNext}
            className="transition-all hover:scale-110"
            style={{ color: colors.textSecondary }}
            onMouseEnter={event => { event.currentTarget.style.color = colors.textPrimary; }}
            onMouseLeave={event => { event.currentTarget.style.color = colors.textSecondary; }}
          >
            <span className="material-symbols-outlined text-2xl">skip_next</span>
          </button>
        </div>

        <div className="flex justify-end gap-4 items-center" style={{ color: colors.textMuted }}>
          <span
            className="material-symbols-outlined text-lg cursor-pointer transition-colors"
            style={{ color: colors.textMuted }}
            onClick={onToggleMute}
            onMouseEnter={event => { event.currentTarget.style.color = colors.textPrimary; }}
            onMouseLeave={event => { event.currentTarget.style.color = colors.textMuted; }}
          >
            {volume === 0 ? 'volume_off' : 'volume_up'}
          </span>
          <div className="w-16 relative h-4 flex items-center group">
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
              className="w-full absolute z-10 opacity-0 cursor-pointer h-full"
            />
            <div className="w-full h-1 overflow-hidden" style={{ backgroundColor: colors.borderLight, borderRadius: 'var(--theme-progress-radius)' }}>
              <div className="h-full" style={{ width: `${volume * 100}%`, backgroundColor: colors.textSecondary }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default FocusControls;
