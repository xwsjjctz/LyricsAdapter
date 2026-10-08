import React, { memo, useId, useRef } from 'react';
import { Track } from '../types';
import { useTranslation } from 'react-i18next';
import { resolveCoverUrl, toCoverThumb } from '../services/coverUrl';
import OverflowMarquee from './OverflowMarquee';
import '../styles/playerSliders.css';
import { PlaybackIcon, usePlaybackSymbols } from './PlaybackIcon';
import { useVolumeDisclosure } from '../hooks/useVolumeDisclosure';
import { usePlayerControlbar } from '../hooks/usePlayerControlbar';
import { usePlayerControlbarLayout } from '../hooks/usePlayerControlbarLayout';
import { getDesktopAPI } from '../services/desktopAdapter';
import { FLOATING_PLAYER_BOTTOM, FLOATING_PLAYER_HEIGHT } from './playerLayout';
import { useLiquidGlass } from './LiquidGlass';

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
  floating = false,
}) => {
  const { t } = useTranslation();
  const symbols = usePlaybackSymbols();
  const platform = getDesktopAPI()?.platform;
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';
  const floatingPlayer = isMac || isWindows;
  const layout = usePlayerControlbarLayout();
  const compact = layout === 'compact';
  const panelRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const volumeShellRef = useRef<HTMLDivElement>(null);
  const volumePanelId = useId();

  const duration = track && Number.isFinite(track.duration) ? Math.max(0, track.duration) : 0;
  const displayCurrentTime = Number.isFinite(currentTime) ? Math.min(duration, Math.max(0, currentTime)) : 0;
  const progress = duration > 0 ? (displayCurrentTime / duration) * 100 : 0;
  const disclosure = useVolumeDisclosure(floatingPlayer && !isFocusMode && layout === 'full');
  const glass = useLiquidGlass(panelRef, isWindows, 'regular', 22);
  const volumeGlass = useLiquidGlass(volumeShellRef, isWindows && layout === 'full', 'regular', 22);
  const nativeControlbar = usePlayerControlbar({
    anchorRef: panelRef,
    visible: true,
    artworkUrl: resolveCoverUrl(track?.coverUrl),
    state: {
      enabled: !!track,
      layout,
      isPlaying,
      currentTime: displayCurrentTime,
      duration,
      volume,
      playbackMode,
      title: track?.title ?? t('controls.noTrackSelected'),
      artist: track?.artist ?? '',
      labels: {
        focus: t('controls.focusMode'),
        playPause: t('shortcut.playPause'),
        previous: t('shortcut.prevTrack'),
        next: t('shortcut.nextTrack'),
        seek: t('controls.seek'),
        volume: t('controls.volume'),
        mute: t(volume === 0 ? 'controls.unmute' : 'controls.mute'),
        mode: t(playbackMode === 'shuffle' ? 'controls.shuffleMode' : playbackMode === 'repeat-one' ? 'controls.repeatOneMode' : 'controls.sequence'),
      },
    },
    onFocus: onToggleFocus,
    onSeek,
    onTogglePlay,
    onSkipNext,
    onSkipPrev,
    onVolumeChange,
    onToggleMute,
    onTogglePlaybackMode,
  });

  if (nativeControlbar) {
    return (
      <div
        ref={panelRef}
        data-testid="main-controlbar"
        data-native-controlbar="true"
        data-compact-controlbar={compact}
        data-controlbar-layout={layout}
        aria-hidden="true"
        className={`macos-floating-player transition-transform duration-500 ${isFocusMode ? 'translate-y-32' : 'translate-y-0'}`}
        style={{ height: FLOATING_PLAYER_HEIGHT, bottom: FLOATING_PLAYER_BOTTOM, background: 'transparent' }}
      />
    );
  }

  const modeControl = (
    <button
      aria-label={t(playbackMode === 'shuffle' ? 'controls.shuffleMode' : playbackMode === 'repeat-one' ? 'controls.repeatOneMode' : 'controls.sequence')}
      onClick={onTogglePlaybackMode}
      className="ui-icon-btn ui-icon-btn--ghost ui-icon-btn--sm relative"
    >
      <PlaybackIcon symbols={symbols}
        name={playbackMode === 'shuffle' ? 'shuffle' : playbackMode === 'repeat-one' ? 'repeat_one' : 'repeat'}
        className="material-symbols-rounded text-lg" />
    </button>
  );

  return (
    <>
    {glass.filter}
    {volumeGlass.filter}
    <div
      ref={panelRef}
      data-testid="main-controlbar"
      data-macos-floating={isMac || undefined}
      data-floating-player={floatingPlayer || undefined}
      data-glass-material={isWindows ? 'regular' : undefined}
      data-compact-controlbar={compact}
      data-controlbar-layout={layout}
      className={'player-controls ' + (floatingPlayer ? `${isWindows ? 'floating-player windows-glass-player liquid-glass liquid-glass--layered' : 'macos-floating-player'} transition-transform duration-500 ${isFocusMode ? 'translate-y-32' : 'translate-y-0'}` : floating
        ? `mx-2 mb-2 h-20 flex items-center justify-between px-4 z-40 transition-transform duration-500 ${isFocusMode ? 'translate-y-32' : 'translate-y-0'}`
        : `h-24 border-t px-6 flex items-center justify-between z-40 transition-transform duration-500 ${isFocusMode ? 'translate-y-32' : 'translate-y-0'}`
      )}
      style={isWindows ? { height: FLOATING_PLAYER_HEIGHT, bottom: FLOATING_PLAYER_BOTTOM, ...glass.style } : isMac ? {
        height: FLOATING_PLAYER_HEIGHT, bottom: FLOATING_PLAYER_BOTTOM,
        backgroundColor: 'color-mix(in srgb, var(--theme-control-panel-bg-floating) 30%, transparent)',
        backdropFilter: 'blur(24px) saturate(135%)',
        WebkitBackdropFilter: 'blur(24px) saturate(135%)',
        border: 'var(--theme-panel-border-width) solid var(--theme-control-panel-border)',
        borderRadius: 'var(--theme-controlbar-radius)',
        boxShadow: '0 12px 32px -12px rgba(0, 0, 0, 0.45)',
      } : floating ? {
        backgroundColor: 'var(--theme-control-panel-bg-floating)',
        borderTop: 'var(--theme-panel-border-width) solid var(--theme-control-panel-border)',
        borderRight: 'var(--theme-panel-border-width) solid var(--theme-control-panel-border)',
        borderBottom: 'var(--theme-panel-border-width) solid var(--theme-control-panel-border)',
        borderRadius: 'var(--theme-controlbar-radius)',
        boxShadow: 'var(--theme-control-panel-shadow)',
      } : {
        borderColor: 'var(--theme-control-panel-border)',
        borderTopWidth: 'var(--theme-panel-border-width)',
        backgroundColor: 'var(--theme-control-panel-bg-glass)',
        boxShadow: 'var(--theme-control-panel-shadow)',
      }}
    >
      {/* Current Track Info - Clickable for Focus Mode */}
      <div className={floatingPlayer ? 'player-track-info flex items-center min-w-0' : 'player-track-info flex items-center gap-4 flex-[0_1_300px] min-w-[200px]'}>
        {track ? (
          <div
            onClick={onToggleFocus}
            role="button"
            tabIndex={0}
            aria-label={t('controls.focusMode')}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onToggleFocus(); }
            }}
            className="player-track-trigger flex items-center cursor-pointer group gap-3 min-w-0"
          >
            <div className={`player-track-cover relative overflow-hidden shadow-lg group-hover:scale-105 transition-transform ${floatingPlayer ? 'size-12 shrink-0' : 'size-14'}`} style={{ borderRadius: isWindows ? '12px' : 'var(--theme-media-radius)' }}>
              <img src={toCoverThumb(resolveCoverUrl(track.coverUrl), 128)} alt="" className="size-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <PlaybackIcon symbols={symbols} name="open_in_full" className="material-symbols-rounded" style={{ color: '#fff', fontSize: '20px' }} />
              </div>
            </div>
            <div className="flex-1 min-w-0 flex flex-col justify-center overflow-hidden">
              <div className="player-track-title text-sm group-hover:text-primary transition-colors" style={{ color: 'var(--theme-text-primary)', fontWeight: isWindows ? 600 : 'var(--theme-text-heading-weight)' }}>
                <OverflowMarquee text={track.title} />
              </div>
              <div className="player-track-artist text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                <OverflowMarquee text={track.artist} />
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm italic" style={{ color: 'var(--theme-text-muted)' }}>{t('controls.noTrackSelected')}</div>
        )}
      </div>

      {/* Main Controls - Horizontal Layout */}
      <div className={`player-primary-controls flex items-center flex-1 ${floatingPlayer ? 'gap-3 min-w-0' : 'gap-6'}`}>
        {/* Play Controls */}
        <div className={`player-transport flex items-center shrink-0 ${floatingPlayer ? 'gap-2' : 'gap-4'}`}>
          <button aria-label={t('shortcut.prevTrack')} onClick={onSkipPrev} disabled={!track} className="ui-icon-btn ui-icon-btn--ghost ui-icon-btn--md">
            <PlaybackIcon symbols={symbols} name="skip_previous" className="material-symbols-rounded text-2xl fill-icon" />
          </button>
          <button
            aria-label={t('shortcut.playPause')}
            data-testid="main-play-button"
            onClick={onTogglePlay}
            disabled={!track}
            className={`size-10 flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-20 ${floatingPlayer ? '' : 'shadow-lg'}`}
            style={{
              backgroundColor: floatingPlayer ? 'transparent' : 'var(--theme-control-primary-button-bg)',
              color: floatingPlayer ? 'var(--theme-control-icon-fg)' : 'var(--theme-control-primary-button-fg)',
              borderRadius: 'var(--theme-button-radius)',
              boxShadow: floatingPlayer ? 'none' : 'var(--theme-control-primary-button-shadow)',
            }}
          >
            <PlaybackIcon symbols={symbols} name={isPlaying ? 'pause' : 'play_arrow'} className="material-symbols-rounded text-2xl fill-icon" />
          </button>
          <button aria-label={t('shortcut.nextTrack')} onClick={onSkipNext} disabled={!track} className="ui-icon-btn ui-icon-btn--ghost ui-icon-btn--md">
            <PlaybackIcon symbols={symbols} name="skip_next" className="material-symbols-rounded text-2xl fill-icon" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className={`player-progress-controls flex items-center flex-1 ${floatingPlayer ? 'gap-2 min-w-0' : 'gap-3'}`}>
          <span className="text-[10px] tabular-nums w-8 text-right" style={{ color: 'var(--theme-text-muted)' }}>{formatTime(displayCurrentTime)}</span>
          <div ref={seekRef} className="player-slider" data-testid="main-seek-anchor" style={{ '--slider-progress': `${progress}%` } as React.CSSProperties}>
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

      {/* Hover/focus reveals volume; the single speaker button toggles mute. */}
      {floatingPlayer ? (
        <div className="player-volume-controls macos-volume-controls">
          <div className="macos-volume-mode">{modeControl}</div>
          <div ref={disclosure.rootRef} className="macos-volume-disclosure" data-open={disclosure.expanded} data-testid="main-volume-disclosure"
            onMouseEnter={disclosure.enter} onMouseLeave={disclosure.leave}
            onFocusCapture={disclosure.focusIn} onBlurCapture={disclosure.focusOut}
            onPointerDownCapture={disclosure.pointerDown} onKeyDownCapture={disclosure.keyDown}>
            <button ref={disclosure.triggerRef} type="button" className="macos-volume-button" data-testid="main-volume-button"
              aria-label={t(volume === 0 ? 'controls.unmute' : 'controls.mute')} aria-expanded={disclosure.expanded} aria-controls={volumePanelId}
              onClick={onToggleMute}
              onKeyDown={event => {
                if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
                if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) {
                  event.preventDefault(); event.stopPropagation(); disclosure.open();
                  onVolumeChange(Math.max(0, Math.min(1, volume + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -0.01 : 0.01))));
                }
              }}>
              <PlaybackIcon symbols={symbols} name={volume === 0 ? 'volume_off' : 'volume_up'} className="material-symbols-rounded text-xl" />
            </button>
            <div ref={volumeShellRef} id={volumePanelId} className={`macos-volume-slider-shell${isWindows ? ' liquid-glass' : ''}`} role="group" aria-label={t('controls.volume')}
              style={isWindows ? volumeGlass.style : undefined}
              aria-hidden={!disclosure.expanded || undefined}>
              <span className="macos-volume-value" aria-hidden="true">{Math.round(volume * 100)}%</span>
              <div ref={volumeRef} className="player-slider macos-volume-slider"
                data-testid="main-volume-anchor"
                style={{ '--slider-progress': `${volume * 100}%` } as React.CSSProperties}>
                <input ref={disclosure.sliderRef} type="range" min="0" max="1" step="0.01" value={volume}
                  onPointerDown={disclosure.startDrag}
                  tabIndex={!disclosure.expanded ? -1 : undefined}
                  aria-label={t('controls.volume')} aria-valuetext={`${Math.round(volume * 100)}%`} aria-orientation="vertical"
                  onKeyDown={preserveSliderKeys} onChange={e => onVolumeChange(Number(e.target.value))} />
                <div className="player-slider-track" aria-hidden="true"><div className="player-slider-fill" /></div>
                <span className="player-slider-thumb" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      ) : (
      <div className="player-volume-controls flex items-center justify-center gap-2 w-36">
        {modeControl}
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t('controls.mute')} onClick={onToggleMute}
            className="ui-icon-btn ui-icon-btn--ghost ui-icon-btn--sm">
            <PlaybackIcon symbols={symbols} name={volume === 0 ? 'volume_off' : 'volume_up'}
              className="material-symbols-rounded text-base" />
          </button>
          <div ref={volumeRef} className="player-slider player-volume-slider" data-testid="main-volume-anchor" style={{ '--slider-progress': `${volume * 100}%` } as React.CSSProperties}>
            <input type="range" min="0" max="1" step="0.01" value={volume} aria-label={t('controls.volume')} aria-valuetext={`${Math.round(volume * 100)}%`} onKeyDown={preserveSliderKeys} onChange={(e) => onVolumeChange(Number(e.target.value))} />
            <div className="player-slider-track" aria-hidden="true"><div className="player-slider-fill" /></div>
            <span className="player-slider-thumb" aria-hidden="true" />
          </div>
        </div>
      </div>
      )}
    </div>
    </>
  );
});

Controls.displayName = 'Controls';

export default Controls;
