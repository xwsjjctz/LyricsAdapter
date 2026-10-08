import type { CSSProperties, KeyboardEvent, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { PlaybackIcon, usePlaybackSymbols } from '../PlaybackIcon';
import { getDesktopAPI } from '../../services/desktopAdapter';

interface Props {
  playerRef: Ref<HTMLDivElement>;
  shown: boolean;
  enabled: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onSkipPrev: () => void;
  onSkipNext: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onTogglePlaybackMode: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const formatTime = (seconds: number) => {
  const time = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
};

const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
function handleSliderKey(event: KeyboardEvent<HTMLDivElement>) {
  if (event.target instanceof HTMLInputElement && event.target.type === 'range'
    && !event.metaKey && !event.ctrlKey && !event.altKey && SLIDER_KEYS.has(event.key)) {
    // The range's native keyboard action must not also invoke global seek/volume shortcuts.
    event.stopPropagation();
  }
}

/** Android's three-row presentation, routed through the desktop player callbacks. */
export default function FocusPortraitControls(props: Props) {
  const { t } = useTranslation();
  const symbols = usePlaybackSymbols();
  const isMac = getDesktopAPI()?.platform === 'darwin';
  const duration = Math.max(0, props.duration);
  const time = Math.min(duration, Math.max(0, props.currentTime));
  const mode = props.playbackMode === 'shuffle' ? 'shuffleMode'
    : props.playbackMode === 'repeat-one' ? 'repeatOneMode' : 'sequence';
  return (
    <div ref={props.playerRef} className="focus-portrait-controls" data-focus-controls
      data-macos-controls={isMac || undefined}
      data-testid="focus-portrait-controls" aria-hidden={!props.shown || undefined}
      {...(!props.shown ? { inert: '' } : {})}
      style={{ opacity: props.shown ? 1 : 0, pointerEvents: props.shown ? undefined : 'none' }}
      onMouseEnter={props.onMouseEnter} onMouseLeave={props.onMouseLeave} onKeyDown={handleSliderKey}>
      <div className="focus-portrait-progress">
        <div className="player-slider" style={{ '--slider-progress': `${duration ? time / duration * 100 : 0}%` } as CSSProperties}>
          <input data-testid="focus-seek-slider" type="range" min="0" max={duration || 100} step="0.1" value={time}
            disabled={!props.shown || !props.enabled || duration === 0} aria-label={t('controls.seek')}
            aria-valuetext={`${formatTime(time)} / ${formatTime(duration)}`}
            onChange={event => props.onSeek(Number(event.target.value))} />
          <div className="player-slider-track" aria-hidden="true"><div className="player-slider-fill" /></div>
        </div>
        <div className="focus-portrait-times"><span>{formatTime(time)}</span><span>−{formatTime(duration - time)}</span></div>
      </div>
      <div className="focus-portrait-transport">
        <button type="button" aria-label={t('shortcut.prevTrack')} disabled={!props.shown || !props.enabled} onClick={props.onSkipPrev}>
          <PlaybackIcon symbols={symbols} name="fast_rewind" className="material-symbols-rounded" aria-hidden="true" /></button>
        <button type="button" aria-label={t('shortcut.playPause')} disabled={!props.shown || !props.enabled}
          onClick={props.onTogglePlay} data-testid="focus-play-button">
          <PlaybackIcon symbols={symbols} name={props.isPlaying ? 'pause' : 'play_arrow'} className="material-symbols-rounded" aria-hidden="true" /></button>
        <button type="button" aria-label={t('shortcut.nextTrack')} disabled={!props.shown || !props.enabled} onClick={props.onSkipNext}>
          <PlaybackIcon symbols={symbols} name="fast_forward" className="material-symbols-rounded" aria-hidden="true" /></button>
      </div>
      <div className="focus-portrait-volume">
        <button type="button" disabled={!props.shown} aria-label={t(props.volume === 0 ? 'controls.unmute' : 'controls.mute')} onClick={props.onToggleMute}>
          <PlaybackIcon symbols={symbols} name={props.volume === 0 ? 'volume_off' : 'volume_down'} className="material-symbols-rounded" aria-hidden="true" /></button>
        <div className="player-slider" style={{ '--slider-progress': `${props.volume * 100}%` } as CSSProperties}>
          <input data-testid="focus-volume-slider" type="range" min="0" max="1" step="0.01" value={props.volume}
            disabled={!props.shown} aria-label={t('controls.volume')} aria-valuetext={`${Math.round(props.volume * 100)}%`}
            onChange={event => props.onVolumeChange(Number(event.target.value))} />
          <div className="player-slider-track" aria-hidden="true"><div className="player-slider-fill" /></div>
        </div>
        <PlaybackIcon symbols={symbols} name="volume_up" className="material-symbols-rounded" aria-hidden="true" />
        <button type="button" disabled={!props.shown || !props.enabled} aria-label={t(`controls.${mode}`)} onClick={props.onTogglePlaybackMode}>
          <PlaybackIcon symbols={symbols} name={props.playbackMode === 'repeat-one' ? 'repeat_one' : props.playbackMode === 'shuffle' ? 'shuffle' : 'repeat'} className="material-symbols-rounded" aria-hidden="true" /></button>
      </div>
    </div>
  );
}
