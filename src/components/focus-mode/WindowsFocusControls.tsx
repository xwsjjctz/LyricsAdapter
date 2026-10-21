import { type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import '../../styles/playerSliders.css';
import '../../styles/windowsFocusControls.css';
import type { FocusControlsProps } from './FocusControls';
import FocusTranslateButton from './FocusTranslateButton';

const timeLabel = (seconds: number) => {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
function sliderKey(event: KeyboardEvent<HTMLInputElement>) {
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) event.stopPropagation();
}

/**
 * Same 350×96 content geometry as focusGlass.mm, on Fluent Acrylic instead of
 * Liquid Glass; Material Symbols replace SF Symbols.
 */
export default function WindowsFocusControls(props: FocusControlsProps & { backdropLight: boolean | null }) {
  const { t } = useTranslation();
  const scale = props.scale ?? 1;
  const shown = props.isPlayerVisible && props.isFocusVisible;
  const duration = Number.isFinite(props.track?.duration) ? Math.max(0, props.track!.duration) : 0;
  const time = Number.isFinite(props.activeCurrentTime) ? Math.max(0, Math.min(duration, props.activeCurrentTime)) : 0;
  // Acrylic follows the analysed cover; until then the theme picks it in CSS.
  const tone = props.backdropLight == null ? undefined : props.backdropLight ? 'light' : 'dark';
  const mode = props.playbackMode === 'shuffle' ? 'shuffleMode' : props.playbackMode === 'repeat-one' ? 'repeatOneMode' : 'sequence';
  const icon = (name: string) => <span className="material-symbols-rounded" aria-hidden="true">{name}</span>;
  const translation = props.onToggleTranslation ? props.translationStatus ?? 'unavailable' : 'unavailable';
  return (
    <div ref={props.playerRef} className="windows-focus-controls transition-opacity duration-500 motion-reduce:transition-none"
      data-testid="focus-web-controls" data-material="acrylic" data-tone={tone} data-translation={translation !== 'unavailable'} aria-hidden={!shown || undefined}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) props.onMouseLeave(); }}
      onFocusCapture={props.onMouseEnter}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !event.currentTarget.matches(':hover')) props.onMouseLeave();
      }}
      style={{ opacity: shown ? 1 : 0,
        '--focus-glass-scale': scale, '--focus-glass-bottom': `${24 * scale}px`,
      } as CSSProperties}>
      <span className="focus-glass-time focus-glass-elapsed">{timeLabel(time)}</span>
      <div className="player-slider focus-glass-seek" style={{ '--slider-progress': `${duration ? time / duration * 100 : 0}%` } as CSSProperties}>
        <input data-testid="focus-seek-slider" type="range" min="0" max={duration || 100} step="0.1" value={time}
          disabled={!shown || !props.track || duration === 0} aria-label={t('controls.seek')}
          aria-valuetext={`${timeLabel(time)} / ${timeLabel(duration)}`} onKeyDown={sliderKey}
          onChange={event => props.onSeek(Number(event.target.value))} />
        <div className="player-slider-track" aria-hidden="true"><div className="player-slider-fill" /></div>
        <span className="player-slider-thumb" aria-hidden="true" />
      </div>
      <span className="focus-glass-time focus-glass-total">{timeLabel(duration)}</span>
      {props.onToggleTranslation && <FocusTranslateButton status={translation} onToggle={props.onToggleTranslation} placement="glass" disabled={!shown} />}
      <button type="button" className="focus-glass-mode" data-active={props.playbackMode !== 'order'} aria-label={t(`controls.${mode}`)}
        disabled={!shown || !props.track} onClick={props.onTogglePlaybackMode}>
        {icon(props.playbackMode === 'shuffle' ? 'shuffle' : props.playbackMode === 'repeat-one' ? 'repeat_one' : 'repeat')}
      </button>
      <button type="button" className="focus-glass-previous" aria-label={t('shortcut.prevTrack')} disabled={!shown || !props.track} onClick={props.onSkipPrev}>{icon('skip_previous')}</button>
      <button type="button" className="focus-glass-play" data-testid="focus-play-button" aria-label={t('shortcut.playPause')}
        disabled={!shown || !props.track} onClick={props.onTogglePlay}>{icon(props.isPlaying ? 'pause' : 'play_arrow')}</button>
      <button type="button" className="focus-glass-next" aria-label={t('shortcut.nextTrack')} disabled={!shown || !props.track} onClick={props.onSkipNext}>{icon('skip_next')}</button>
      <button type="button" className="focus-glass-mute" aria-label={t(props.volume === 0 ? 'controls.unmute' : 'controls.mute')}
        disabled={!shown} onClick={props.onToggleMute}>{icon(props.volume === 0 ? 'volume_off' : 'volume_up')}</button>
      <div className="player-slider focus-glass-volume" style={{ '--slider-progress': `${props.volume * 100}%` } as CSSProperties}>
        <input data-testid="focus-volume-slider" type="range" min="0" max="1" step="0.01" value={props.volume} disabled={!shown}
          aria-label={t('controls.volume')} aria-valuetext={`${Math.round(props.volume * 100)}%`} onKeyDown={sliderKey}
          onChange={event => props.onVolumeChange(Number(event.target.value))} />
        <div className="player-slider-track" aria-hidden="true"><div className="player-slider-fill" /></div>
        <span className="player-slider-thumb" aria-hidden="true" />
      </div>
    </div>
  );
}
