import React from 'react';
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
  onToggleFocus: () => void;
  isFocusMode: boolean;
}

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const Controls: React.FC<ControlsProps> = ({
  track, isPlaying, currentTime, volume,
  onTogglePlay, onSkipNext, onSkipPrev, onSeek, onVolumeChange,
  onToggleFocus, isFocusMode
}) => {
  const progress = track ? (currentTime / track.duration) * 100 : 0;

  return (
    <div className={`h-24 glass border-t border-white/10 px-6 flex items-center justify-between z-40 transition-transform duration-500 ${isFocusMode ? 'translate-y-32' : 'translate-y-0'}`}>
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
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <span className="text-[10px] tabular-nums text-white/40 w-8 text-right">{formatTime(currentTime)}</span>
          <div className="flex-1 relative h-4 group flex items-center">
            <input
              type="range" min="0" max={track?.duration || 100} step="0.1" value={currentTime}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="w-full absolute z-10 opacity-0 cursor-pointer h-full"
            />
            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-primary" style={{width: `${progress}%`}}></div>
            </div>
          </div>
          <span className="text-[10px] tabular-nums text-white/40 w-8">{track ? formatTime(track.duration) : '0:00'}</span>
        </div>
      </div>

      {/* Volume & Extras */}
      <div className="flex items-center justify-end gap-4 w-1/4">
        <div className="flex items-center gap-2 group">
          <span className="material-symbols-outlined text-white/40 text-base">volume_down</span>
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
};

export default Controls;