import React, { useCallback, useRef } from 'react';
import type { Track } from '../../types';
import type { ThemeColors } from '../../types/theme';
import { useFocusGlassControls } from './useFocusGlassControls';
import { useFocusBackdropLuminance } from './useFocusBackdropLuminance';
import { resolveCoverUrl } from '../../services/coverUrl';
import FocusPortraitControls from './FocusPortraitControls';
import WindowsFocusControls from './WindowsFocusControls';
import { getDesktopAPI } from '../../services/desktopAdapter';

type PlaybackMode = 'order' | 'shuffle' | 'repeat-one';

export interface FocusControlsProps {
  track: Track | null;
  colors: ThemeColors;
  isPlaying: boolean;
  isPlayerVisible: boolean;
  isFocusVisible: boolean;
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
  glassMaterial?: boolean;
  scale?: number;
  portrait?: boolean;
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
  isFocusVisible,
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
  glassMaterial = false,
  scale = 1,
  portrait = false,
}) => {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const setPlayerRef = useCallback((element: HTMLDivElement | null) => {
    anchorRef.current = element;
    if (typeof playerRef === 'function') playerRef(element);
    else if (playerRef) (playerRef as React.MutableRefObject<HTMLDivElement | null>).current = element;
  }, [playerRef]);
  const nativeGlass = useFocusGlassControls({
    anchorRef, focusVisible: isFocusVisible, visible: isPlayerVisible, enabled: !!track, nativeEnabled: !portrait, isPlaying,
    currentTime: activeCurrentTime, duration: track?.duration ?? 0, volume, playbackMode, scale,
    onSeek, onTogglePlay, onSkipNext, onSkipPrev, onVolumeChange, onToggleMute,
    onTogglePlaybackMode, onMouseEnter, onMouseLeave,
  });
  const backdropLight = useFocusBackdropLuminance(track ? resolveCoverUrl(track.coverUrl) : undefined);
  // Glass panels pick foreground colors from the analyzed backdrop instead of
  // the theme: a washed-out cover otherwise hides whichever fixed color the
  // theme picked. Null (not analyzed yet / not glass) keeps the theme colors.
  const glassColors = glassMaterial && backdropLight != null
    ? backdropLight
      ? {
        muted: 'rgba(15, 23, 42, 0.55)', secondary: 'rgba(15, 23, 42, 0.78)',
        primary: 'rgba(15, 23, 42, 0.92)', border: 'rgba(15, 23, 42, 0.16)',
        playBg: 'rgba(15, 23, 42, 0.92)', playFg: 'rgba(255, 255, 255, 0.92)',
      }
      : {
        muted: 'rgba(255, 255, 255, 0.6)', secondary: 'rgba(255, 255, 255, 0.82)',
        primary: '#ffffff', border: 'rgba(255, 255, 255, 0.22)',
        playBg: 'rgba(255, 255, 255, 0.94)', playFg: 'rgba(15, 23, 42, 0.92)',
      }
    : null;
  const fg = {
    muted: glassColors ? glassColors.muted : colors.textMuted,
    secondary: glassColors ? glassColors.secondary : colors.textSecondary,
    primary: glassColors ? glassColors.primary : colors.textPrimary,
    border: glassColors ? glassColors.border : colors.borderLight,
  };
  if (portrait) return <FocusPortraitControls
    playerRef={setPlayerRef} shown={isPlayerVisible && isFocusVisible} enabled={!!track} isPlaying={isPlaying}
    currentTime={activeCurrentTime} duration={track?.duration ?? 0} volume={volume} playbackMode={playbackMode}
    onSeek={onSeek} onTogglePlay={onTogglePlay} onSkipPrev={onSkipPrev} onSkipNext={onSkipNext}
    onVolumeChange={onVolumeChange} onToggleMute={onToggleMute} onTogglePlaybackMode={onTogglePlaybackMode}
    onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />;
  if (getDesktopAPI()?.platform === 'win32') return <WindowsFocusControls
    track={track} colors={colors} isPlaying={isPlaying} isPlayerVisible={isPlayerVisible} isFocusVisible={isFocusVisible}
    activeCurrentTime={activeCurrentTime} progress={progress} volume={volume} playbackMode={playbackMode}
    playerRef={setPlayerRef} scale={scale} backdropLight={backdropLight}
    onSeek={onSeek} onTogglePlay={onTogglePlay} onSkipPrev={onSkipPrev} onSkipNext={onSkipNext}
    onVolumeChange={onVolumeChange} onToggleMute={onToggleMute} onTogglePlaybackMode={onTogglePlaybackMode}
    onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />;
  if (nativeGlass !== 'fallback') {
    // Keep a hover target when the native controls fade out; it owns no playback
    // controls or accessibility nodes and creates no duplicate tab stops.
    return <div
      ref={setPlayerRef}
      className="focus-native-controls transition-opacity duration-500 motion-reduce:transition-none"
      data-testid="focus-native-controls"
      data-native-status={nativeGlass}
      aria-hidden="true"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ position: 'fixed', bottom: 24 * scale, left: '50%', transform: 'translateX(-50%)', width: `min(${350 * scale}px, calc(100vw - 48px))`, aspectRatio: '350 / 96', opacity: isPlayerVisible ? 1 : 0 }}
    />;
  }
  const panelStyle: React.CSSProperties = glassMaterial
    ? {
        opacity: isPlayerVisible ? 1 : 0,
        borderRadius: '24px',
        border: '1px solid color-mix(in srgb, var(--theme-border-light, rgba(255, 255, 255, 0.14)) 70%, transparent)',
        background: 'color-mix(in srgb, var(--theme-control-panel-bg-floating, rgba(16, 25, 34, 0.86)) 56%, transparent)',
        boxShadow: '0 22px 68px -18px rgba(0, 0, 0, 0.62), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(32px) saturate(145%)',
        WebkitBackdropFilter: 'blur(32px) saturate(145%)',
      }
    : {
        opacity: isPlayerVisible ? 1 : 0,
        borderRadius: 'var(--theme-surface-radius)',
        border: `var(--theme-panel-border-width) solid ${colors.borderLight}`,
        backgroundColor: colors.backgroundDark,
        boxShadow: 'var(--theme-surface-shadow)',
      };
  const scaledPanelStyle: React.CSSProperties = scale > 1
    ? {
        ...panelStyle,
        transform: `scale(${scale})`,
        transformOrigin: 'center bottom',
      }
    : panelStyle;

  return (
  <div
    className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xl px-5"
    style={scale > 1 ? { bottom: `${24 * scale}px` } : undefined}
  >
    <div
      ref={playerRef}
      data-testid="focus-web-controls"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="p-4 flex flex-col gap-3 relative z-20 transition-opacity duration-500"
      style={scaledPanelStyle}
    >
      <div className="w-full flex items-center gap-3">
        <span className="text-[10px] tabular-nums font-bold w-10 text-right" style={{ color: fg.muted }}>
          {formatTime(activeCurrentTime)}
        </span>
        <div
          className="flex-1 relative h-1 cursor-pointer group"
          style={{ backgroundColor: fg.border, borderRadius: 'var(--theme-progress-radius)' }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const pct = x / rect.width;
            onSeek(pct * (track?.duration || 0));
          }}
        >
          <div
            className="absolute top-0 left-0 h-full"
            style={{ width: `${progress}%`, backgroundColor: colors.primary, boxShadow: `0 0 15px ${colors.glowColor}`, borderRadius: 'var(--theme-progress-radius)' }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 size-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `${progress}%`, marginLeft: '-4px', backgroundColor: fg.primary, borderRadius: 'var(--theme-progress-radius)' }}
          />
        </div>
        <span className="text-[10px] tabular-nums font-bold w-10" style={{ color: fg.muted }}>
          {formatTime(track?.duration || 0)}
        </span>
      </div>

      <div className="flex items-center justify-between px-4">
        <div className="flex gap-4" style={{ color: fg.muted }}>
          <span
            className="material-symbols-rounded text-lg cursor-pointer transition-colors relative -left-[4px]"
            style={{ color: fg.muted }}
            onClick={onTogglePlaybackMode}
            onMouseEnter={event => { event.currentTarget.style.color = fg.primary; }}
            onMouseLeave={event => { event.currentTarget.style.color = fg.muted; }}
          >
            {playbackModeIcon[playbackMode]}
          </span>
        </div>

        <div className="flex items-center gap-6 relative left-[30px]">
          <button
            type="button"
            onClick={onSkipPrev}
            className="transition-all hover:scale-110"
            style={{ color: fg.secondary }}
            onMouseEnter={event => { event.currentTarget.style.color = fg.primary; }}
            onMouseLeave={event => { event.currentTarget.style.color = fg.secondary; }}
          >
            <span className="material-symbols-rounded text-2xl">skip_previous</span>
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            className="size-11 flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg"
            style={{ backgroundColor: glassColors ? glassColors.playBg : colors.textPrimary, color: glassColors ? glassColors.playFg : colors.backgroundDark, borderRadius: 'var(--theme-button-radius)' }}
          >
            <span className="material-symbols-rounded text-3xl">{isPlaying ? 'pause' : 'play_arrow'}</span>
          </button>
          <button
            type="button"
            onClick={onSkipNext}
            className="transition-all hover:scale-110"
            style={{ color: fg.secondary }}
            onMouseEnter={event => { event.currentTarget.style.color = fg.primary; }}
            onMouseLeave={event => { event.currentTarget.style.color = fg.secondary; }}
          >
            <span className="material-symbols-rounded text-2xl">skip_next</span>
          </button>
        </div>

        <div className="flex justify-end gap-4 items-center" style={{ color: fg.muted }}>
          <span
            className="material-symbols-rounded text-lg cursor-pointer transition-colors"
            style={{ color: fg.muted }}
            onClick={onToggleMute}
            onMouseEnter={event => { event.currentTarget.style.color = fg.primary; }}
            onMouseLeave={event => { event.currentTarget.style.color = fg.muted; }}
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
            <div className="w-full h-1 overflow-hidden" style={{ backgroundColor: fg.border, borderRadius: 'var(--theme-progress-radius)' }}>
              <div className="h-full" style={{ width: `${volume * 100}%`, backgroundColor: fg.secondary }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
};

export default FocusControls;
