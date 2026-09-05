import React, { memo } from 'react';
import { Track } from '../types';
import { useTranslation } from 'react-i18next';
import { toCoverThumb } from '../services/coverUrl';
import { useGlassUI } from '../hooks/useGlassUI';
import OverflowMarquee from './OverflowMarquee';
import '../styles/playerSliders.css';

interface ControlsProps {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  onTogglePlaybackMode: () => void;
  onToggleFocus: () => void;
  isFocusMode: boolean;
  floating?: boolean;
}

// Move formatTime outside component to avoid re-creation
const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};


// Preserve native range keys without changing application shortcuts elsewhere.
const preserveSliderKeys = (event: React.KeyboardEvent<HTMLInputElement>): void => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
    event.stopPropagation();
  }
};

const Controls: React.FC<ControlsProps> = memo(({
  track, isPlaying, currentTime, volume,
  onTogglePlay, onSkipNext, onSkipPrev, onSeek, onVolumeChange, onToggleMute,
  playbackMode, onTogglePlaybackMode, onToggleFocus, isFocusMode,
  floating = false
}) => {
  const { t } = useTranslation();
  const glassUI = useGlassUI();

  const duration = track && Number.isFinite(track.duration) ? Math.max(0, track.duration) : 0;
  const displayCurrentTime = Number.isFinite(currentTime) ? Math.min(duration, Math.max(0, currentTime)) : 0;
  const progress = duration > 0 ? (displayCurrentTime / duration) * 100 : 0;

  return (
    <div
      className={floating
        ? `mx-2 mb-2 h-20 flex items-center justify-between px-4 z-40 transition-transform duration-500 ${isFocusMode ? 'translate-y-32' : 'translate-y-0'}`
        : `h-24 glass glass-soft border-t px-6 flex items-center justify-between z-40 transition-transform duration-500 ${glassUI ? 'frosted-bar absolute bottom-0 left-0 right-0' : ''} ${isFocusMode ? 'translate-y-32' : 'translate-y-0'}`
      }
      style={floating ? {
        backgroundColor: 'var(--theme-control-panel-bg-floating)',
        borderTop: 'var(--theme-panel-border-width) solid var(--theme-control-panel-border)',
        borderRight: 'var(--theme-panel-border-width) solid var(--theme-control-panel-border)',
        borderBottom: 'var(--theme-panel-border-width) solid var(--theme-control-panel-border)',
        borderRadius: 'var(--theme-surface-radius)',
        boxShadow: 'var(--theme-control-panel-shadow)',
      } : {
        borderColor: 'var(--theme-control-panel-border)',
        borderTopWidth: 'var(--theme-panel-border-width)',
        backgroundColor: glassUI ? 'var(--theme-control-panel-bg-glass-strong)' : 'var(--theme-control-panel-bg-glass)',
        boxShadow: 'var(--theme-control-panel-shadow)',
      }}
    >
      {/* Current Track Info - Clickable for Focus Mode */}
      <div className="flex items-center gap-4 w-1/4 min-w-[200px]">
        {track ? (
          <div
            onClick={onToggleFocus}
            className="flex items-center gap-4 cursor-pointer group"
          >
            <div className="relative size-14 overflow-hidden shadow-lg group-hover:scale-105 transition-transform" style={{ borderRadius: 'var(--theme-media-radius)' }}>
              <img src={toCoverThumb(track.coverUrl, 128)} className="size-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: '20px' }}>open_in_full</span>
              </div>
            </div>
            <div className="w-[130px] min-w-0 flex flex-col justify-center overflow-hidden">
              <div className="text-sm group-hover:text-primary transition-colors" style={{ color: 'var(--theme-text-primary)', fontWeight: 'var(--theme-text-heading-weight)' }}>
                <OverflowMarquee text={track.title} />
              </div>
              <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                <OverflowMarquee text={track.artist} />
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm italic" style={{ color: 'var(--theme-text-muted)' }}>{t('controls.noTrackSelected')}</div>
        )}
      </div>

      {/* Main Controls - Horizontal Layout */}
      <div className="flex items-center gap-6 flex-1">
        {/* Play Controls */}
        <div className="flex items-center gap-4">
          <button onClick={onSkipPrev} disabled={!track} className="size-9 flex items-center justify-center transition-colors disabled:opacity-20" style={{ color: 'var(--theme-control-icon-fg)', borderRadius: 'var(--theme-button-radius)' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-control-icon-fg-hover)'; e.currentTarget.style.backgroundColor = 'var(--theme-control-icon-bg)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--theme-control-icon-fg)'; e.currentTarget.style.backgroundColor = 'transparent'; }}>
            <span className="material-symbols-outlined text-2xl fill-icon">skip_previous</span>
          </button>
          <button
            onClick={onTogglePlay}
            disabled={!track}
            className="size-10 flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-20 shadow-lg"
            style={{
              backgroundColor: 'var(--theme-control-primary-button-bg)',
              color: 'var(--theme-control-primary-button-fg)',
              borderRadius: 'var(--theme-button-radius)',
              boxShadow: 'var(--theme-control-primary-button-shadow)',
            }}
          >
            <span className="material-symbols-outlined text-2xl fill-icon">{isPlaying ? 'pause' : 'play_arrow'}</span>
          </button>
          <button onClick={onSkipNext} disabled={!track} className="size-9 flex items-center justify-center transition-colors disabled:opacity-20" style={{ color: 'var(--theme-control-icon-fg)', borderRadius: 'var(--theme-button-radius)' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-control-icon-fg-hover)'; e.currentTarget.style.backgroundColor = 'var(--theme-control-icon-bg)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--theme-control-icon-fg)'; e.currentTarget.style.backgroundColor = 'transparent'; }}>
            <span className="material-symbols-outlined text-2xl fill-icon">skip_next</span>
          </button>
        </div>

        {/* Progress Bar */}
        <div className="flex items-center gap-3 flex-1">
          <span className="text-[10px] tabular-nums w-8 text-right" style={{ color: 'var(--theme-text-muted)' }}>{formatTime(displayCurrentTime)}</span>
          <div className="player-slider" style={{ '--slider-progress': `${progress}%` } as React.CSSProperties}>
            <input
              type="range" min="0" max={duration || 100} step="0.1" value={displayCurrentTime}
              disabled={!track || duration === 0}
              aria-label={t('controls.seek')}
              aria-valuetext={`${formatTime(displayCurrentTime)} / ${formatTime(duration)}`}
              onKeyDown={preserveSliderKeys}
              onChange={(e) => onSeek(Number(e.target.value))}
            />
            <div className="player-slider-track" aria-hidden="true">
              <div className="player-slider-fill" data-progress={progress} data-current-time={currentTime} />
            </div>
            <span className="player-slider-thumb" aria-hidden="true" />
          </div>
          <span className="text-[10px] tabular-nums w-8" style={{ color: 'var(--theme-text-muted)' }}>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Volume & Playback Mode */}
      <div className="flex items-center justify-center gap-2 w-36">
        <button
          onClick={onTogglePlaybackMode}
          className="size-8 flex items-center justify-center transition-colors relative"
          style={{ color: 'var(--theme-control-icon-fg)', borderRadius: 'var(--theme-button-radius)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-control-icon-fg-hover)'; e.currentTarget.style.backgroundColor = 'var(--theme-control-icon-bg)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--theme-control-icon-fg)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <span className="material-symbols-outlined text-lg">
            {playbackMode === 'shuffle'
              ? 'shuffle'
              : playbackMode === 'repeat-one'
              ? 'repeat_one'
              : 'repeat'}
          </span>
        </button>
        <div className="flex items-center gap-2 group">
          <span
            className="material-symbols-outlined transition-colors text-base cursor-pointer"
            style={{ color: 'var(--theme-control-icon-fg)' }}
            onClick={onToggleMute}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--theme-control-icon-fg-hover)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--theme-control-icon-fg)'}
          >
            {volume === 0 ? 'volume_off' : 'volume_up'}
          </span>
          <div className="player-slider player-volume-slider" style={{ '--slider-progress': `${volume * 100}%` } as React.CSSProperties}>
            <input type="range" min="0" max="1" step="0.01" value={volume} aria-label={t('controls.volume')} aria-valuetext={`${Math.round(volume * 100)}%`} onKeyDown={preserveSliderKeys} onChange={(e) => onVolumeChange(Number(e.target.value))} />
            <div className="player-slider-track" aria-hidden="true"><div className="player-slider-fill" /></div>
            <span className="player-slider-thumb" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for React.memo
  // Only re-render when critical props actually change
  // Check track identity (reference equality)
  if (prevProps.track !== nextProps.track) return false;

  // Check playback state
  if (prevProps.isPlaying !== nextProps.isPlaying) return false;

  // Check volume (changes infrequently)
  if (prevProps.volume !== nextProps.volume) return false;

  // Check focus mode
  if (prevProps.isFocusMode !== nextProps.isFocusMode) return false;

  // Check callbacks (reference equality)
  if (prevProps.onTogglePlay !== nextProps.onTogglePlay) return false;
  if (prevProps.onSkipNext !== nextProps.onSkipNext) return false;
  if (prevProps.onSkipPrev !== nextProps.onSkipPrev) return false;
  if (prevProps.onSeek !== nextProps.onSeek) return false;
  if (prevProps.onVolumeChange !== nextProps.onVolumeChange) return false;
  if (prevProps.onToggleMute !== nextProps.onToggleMute) return false;
  if (prevProps.playbackMode !== nextProps.playbackMode) return false;
  if (prevProps.onTogglePlaybackMode !== nextProps.onTogglePlaybackMode) return false;
  if (prevProps.onToggleFocus !== nextProps.onToggleFocus) return false;

  // Native media timeupdate is already low-frequency. Keep every committed
  // sample so the progress bar never lags behind the shared playback clock.
  if (prevProps.currentTime !== nextProps.currentTime) return false;

  // Check floating mode
  if (prevProps.floating !== nextProps.floating) return false;

  // All props are effectively the same, skip re-render
  return true;
});

Controls.displayName = 'Controls';

export default Controls;
