import React, { memo, useMemo } from 'react';
import { Track } from '../types';

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
  forceUpdateCounter?: number; // Force re-render after restore
  audioRef?: React.RefObject<HTMLAudioElement>; // Access to audio element
}

// Move formatTime outside component to avoid re-creation
const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const Controls: React.FC<ControlsProps> = memo(({
  track, isPlaying, currentTime, volume,
  onTogglePlay, onSkipNext, onSkipPrev, onSeek, onVolumeChange, onToggleMute,
  playbackMode, onTogglePlaybackMode, onToggleFocus, isFocusMode, forceUpdateCounter, audioRef
}) => {
// Use audio element's currentTime directly for progress calculation
  // This ensures we show the actual audio playback position
  const actualCurrentTime = audioRef?.current ? audioRef.current.currentTime : currentTime;
  
  // Calculate progress percentage
  const progress = track ? (actualCurrentTime / track.duration) * 100 : 0;

  return (
    <div className={`h-24 glass glass-soft border-t border-white/10 px-6 flex items-center justify-between z-40 transition-transform duration-500 ${isFocusMode ? 'translate-y-32' : 'translate-y-0'}`}>
      {/* Current Track Info - Clickable for Focus Mode */}
      <div className="flex items-center gap-4 w-1/4 min-w-[200px]">
        {track ? (
          <div
            onClick={onToggleFocus}
            className="flex items-center gap-4 cursor-pointer group"
          >
            <div className="relative size-14 rounded-xl overflow-hidden shadow-lg group-hover:scale-105 transition-transform">
              <img src={track.coverUrl} className="size-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <span className="material-symbols-outlined text-white text-xl">open_in_full</span>
              </div>
            </div>
            <div className="w-[130px] flex flex-col justify-center overflow-hidden">
              {track.title.length > 15 || track.artist.length > 15 ? (
                <div
                  className="whitespace-nowrap"
                  style={{
                    animation: 'scroll-left 10s linear infinite'
                  }}
                >
                  <p className="text-sm font-bold group-hover:text-primary transition-colors">
                    {track.title + ' '}
                  </p>
                  <p className="text-xs text-white/40">
                    {track.artist + ' '}
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm font-bold truncate group-hover:text-primary transition-colors" title={track.title}>
                    {track.title}
                  </p>
                  <p className="text-xs text-white/40 truncate" title={track.artist}>
                    {track.artist}
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="text-sm text-white/20 italic">No track selected</div>
        )}
      </div>

      {/* Main Controls - Horizontal Layout */}
      <div className="flex items-center gap-6 flex-1">
        {/* Play Controls */}
        <div className="flex items-center gap-4">
          <button onClick={onSkipPrev} disabled={!track} className="text-white/60 hover:text-white transition-colors disabled:opacity-20">
            <span className="material-symbols-outlined text-2xl fill-icon">skip_previous</span>
          </button>
          <button
            onClick={onTogglePlay}
            disabled={!track}
            className="size-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-20 shadow-lg"
          >
            <span className="material-symbols-outlined text-2xl fill-icon">{isPlaying ? 'pause' : 'play_arrow'}</span>
          </button>
          <button onClick={onSkipNext} disabled={!track} className="text-white/60 hover:text-white transition-colors disabled:opacity-20">
            <span className="material-symbols-outlined text-2xl fill-icon">skip_next</span>
          </button>
        </div>

        {/* Progress Bar */}
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <span className="text-[10px] tabular-nums text-white/40 w-8 text-right">{formatTime(actualCurrentTime)}</span>
          <div className="flex-1 relative h-4 group flex items-center" key={`progress-${currentTime}`}>
            <input
              type="range" min="0" max={track?.duration || 100} step="0.1" value={actualCurrentTime}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="w-full absolute z-10 opacity-0 cursor-pointer h-full"
            />
            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{width: `${progress}%`}}
                data-progress={progress}
                data-current-time={currentTime}
              ></div>
            </div>
          </div>
          <span className="text-[10px] tabular-nums text-white/40 w-8">{track ? formatTime(track.duration) : '0:00'}</span>
          <button
            onClick={onTogglePlaybackMode}
            className="text-white/60 hover:text-white transition-colors ml-1 relative top-[3.5px]"
            title={
              playbackMode === 'shuffle'
                ? '随机播放'
                : playbackMode === 'repeat-one'
                ? '单曲循环'
                : '顺序播放'
            }
          >
            <span className="material-symbols-outlined text-lg">
              {playbackMode === 'shuffle'
                ? 'shuffle'
                : playbackMode === 'repeat-one'
                ? 'repeat_one'
                : 'repeat'}
            </span>
          </button>
        </div>
      </div>

      {/* Volume & Extras */}
      <div className="flex items-center justify-center gap-4 w-32">
        <div className="flex items-center gap-2 group">
          <span
            className="material-symbols-outlined text-white/60 hover:text-white transition-colors text-base cursor-pointer"
            onClick={onToggleMute}
          >
            {volume === 0 ? 'volume_off' : 'volume_up'}
          </span>
          <div className="w-16 relative h-4 flex items-center">
            <input
              type="range" min="0" max="1" step="0.01" value={volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="w-full absolute z-10 opacity-0 cursor-pointer h-full"
            />
            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-white/60" style={{width: `${volume * 100}%`}}></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for React.memo
  // Only re-render when critical props actually change
  // Note: We intentionally allow re-renders when currentTime changes significantly
  // to update the progress bar, but we could optimize this further if needed

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

  // Allow re-render when currentTime changes more than 1 second
  // This prevents excessive re-renders during playback
  const timeDiff = Math.abs(prevProps.currentTime - nextProps.currentTime);
  if (timeDiff > 1) return false;

  // Check force update counter
  if (prevProps.forceUpdateCounter !== nextProps.forceUpdateCounter) return false;

  // All props are effectively the same, skip re-render
  return true;
});

Controls.displayName = 'Controls';

export default Controls;
