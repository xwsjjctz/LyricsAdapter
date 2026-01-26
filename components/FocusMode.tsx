import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Track, SyncedLyricLine } from '../types';

interface FocusModeProps {
  track: Track | null;
  isVisible: boolean;
  currentTime: number;
  onClose: () => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onSeek: (time: number) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
}

const FocusMode: React.FC<FocusModeProps> = ({
  track, isVisible, currentTime, onClose,
  isPlaying, onTogglePlay, onSkipNext, onSkipPrev, onSeek, volume, onVolumeChange
}) => {
  const lyricsRef = useRef<HTMLDivElement>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progress = track && track.duration > 0 ? (currentTime / track.duration) * 100 : 0;

  // Parse lyrics - use synced lyrics if available, otherwise fall back to plain text
  const lyricsLines = useMemo(() => {
    if (track?.syncedLyrics && track.syncedLyrics.length > 0) {
      return track.syncedLyrics;
    }
    // Fall back to plain text lyrics
    if (track?.lyrics) {
      const plainLines = track.lyrics.split(/\r?\n/).filter(line => line.trim().length > 0);
      // Convert to synced lyrics format with even distribution
      return plainLines.map((text, idx) => ({
        time: 0, // No timing info for plain lyrics
        text
      }));
    }
    return [];
  }, [track?.syncedLyrics, track?.lyrics]);

  // Find the currently active lyric line based on timestamp
  const activeIndex = useMemo(() => {
    if (!track || lyricsLines.length === 0) return -1;

    // If we have synced lyrics, find the line based on current time
    if (track.syncedLyrics && track.syncedLyrics.length > 0) {
      for (let i = lyricsLines.length - 1; i >= 0; i--) {
        if (currentTime >= lyricsLines[i].time) {
          return i;
        }
      }
      return 0;
    }

    // Fall back to percentage-based for plain text lyrics
    if (track.duration > 0) {
      return Math.floor((currentTime / track.duration) * lyricsLines.length);
    }
    return 0;
  }, [currentTime, lyricsLines, track]);

  // Helper to format time
  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds === 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Handle user scroll interaction
  const handleUserScroll = () => {
    setIsUserScrolling(true);

    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Set new timeout to resume auto-scroll after 3 seconds
    scrollTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false);
    }, 3000);
  };

  // Auto-scroll lyrics to current line (only when not user scrolling)
  useEffect(() => {
    if (isVisible && lyricsRef.current && activeIndex >= 0 && !isUserScrolling) {
      const lyricElements = lyricsRef.current.querySelectorAll('p');
      if (lyricElements[activeIndex]) {
        lyricElements[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentTime, isVisible, activeIndex, isUserScrolling]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Handle click on synced lyric line to seek
  const handleLyricClick = (lyricTime: number) => {
    if (lyricTime > 0 && onSeek) {
      onSeek(lyricTime);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 transition-all duration-700 ease-in-out ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}`}>
      {/* Background Blur */}
      <div className="immersive-bg" style={{ backgroundImage: `url(${track?.coverUrl})` }} />
      <div className="fixed inset-0 bg-black/70 backdrop-blur-3xl" />

      <div className="relative h-full flex flex-col z-10 overflow-hidden">
        {/* Top Header */}
        <header className="flex items-center justify-start px-6 py-4 shrink-0">
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-white/40 hover:text-white transition-all group"
          >
            <div className="bg-white/5 p-1.5 rounded-full group-hover:bg-white/10 transition-colors">
              <span className="material-symbols-outlined text-base">keyboard_arrow_down</span>
            </div>
            <span className="text-[9px] font-bold tracking-[0.15em] uppercase">Now Playing</span>
          </button>
        </header>

        {/* Content Section */}
        <main className="flex-1 flex flex-col lg:flex-row items-center justify-center pl-0 pr-4 lg:pl-0 lg:pr-8 gap-20 lg:gap-32 overflow-hidden mb-24 max-w-5xl mx-auto w-full translate-x-16 lg:translate-x-24">

          {/* Cover & Title */}
          <div className="flex-none flex flex-col items-center justify-center w-auto">
            <div className="relative w-full aspect-square max-w-[280px] lg:max-w-[340px] shadow-[0_30px_80px_rgba(0,0,0,0.5)] rounded-2xl overflow-hidden group">
              <img
                src={track?.coverUrl}
                className={`w-full h-full object-cover transition-transform duration-[6s] ${isPlaying ? 'scale-110' : 'scale-100'}`}
                alt="album cover"
              />
            </div>
            <div className="mt-5 lg:mt-7 text-center w-full max-w-[340px]">
              <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-white mb-2 line-clamp-2 drop-shadow-2xl">
                {track?.title}
              </h1>
              <p className="text-base lg:text-lg text-primary font-semibold truncate opacity-80">
                {track?.artist}
              </p>
              <p className="text-xs lg:text-sm text-white/30 font-medium truncate mt-1">
                {track?.album}
              </p>
            </div>
          </div>

          {/* Lyrics */}
          <div
            className="flex-1 h-full max-h-[50vh] lg:max-h-[60vh] overflow-y-auto no-scrollbar mask-fade flex flex-col gap-5 lg:gap-7 py-36 px-8"
            ref={lyricsRef}
            onScroll={handleUserScroll}
          >
            {lyricsLines.length > 0 ? (
              lyricsLines.map((lyric, idx) => {
                const isActive = idx === activeIndex;
                const hasTimestamp = track?.syncedLyrics && lyric.time > 0;
                return (
                  <p
                    key={idx}
                    className={`text-xl lg:text-2xl font-bold leading-tight transition-all duration-700 cursor-default ${
                      isActive ? 'active-lyric' : 'text-white/10 hover:text-white/30'
                    } ${hasTimestamp ? 'cursor-pointer' : ''}`}
                    onClick={() => hasTimestamp && handleLyricClick(lyric.time)}
                  >
                    {lyric.text}
                  </p>
                );
              })
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-white/10 gap-3">
                <span className="material-symbols-outlined text-4xl">lyrics</span>
                <p className="italic text-base">No lyrics found in metadata</p>
              </div>
            )}
          </div>
        </main>

        {/* Compact Bottom Player */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-xl px-5">
          <div className="glass rounded-2xl p-4 flex flex-col gap-3 shadow-xl border border-white/5 relative z-20">
            {/* Progress */}
            <div className="w-full flex items-center gap-3">
              <span className="text-[10px] tabular-nums font-bold text-white/30 w-10 text-right">{formatTime(currentTime)}</span>
              <div
                className="flex-1 relative h-1 bg-white/10 rounded-full cursor-pointer group"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const pct = x / rect.width;
                  onSeek(pct * (track?.duration || 0));
                }}
              >
                <div
                  className="absolute top-0 left-0 h-full bg-primary shadow-[0_0_15px_rgba(43,140,238,0.5)] rounded-full transition-all duration-100"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 size-2 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ left: `${progress}%`, marginLeft: '-4px' }}
                />
              </div>
              <span className="text-[10px] tabular-nums font-bold text-white/30 w-10">{formatTime(track?.duration || 0)}</span>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between px-4">
              <div className="flex gap-4 text-white/20">
                <span className="material-symbols-outlined text-lg hover:text-white cursor-pointer transition-colors">shuffle</span>
                <span className="material-symbols-outlined text-lg hover:text-white cursor-pointer transition-colors">repeat</span>
              </div>

              <div className="flex items-center gap-6">
                <button onClick={onSkipPrev} className="text-white/60 hover:text-white transition-all hover:scale-110">
                  <span className="material-symbols-outlined text-2xl">skip_previous</span>
                </button>
                <button
                  onClick={onTogglePlay}
                  className="bg-white text-black size-11 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg"
                >
                  <span className="material-symbols-outlined text-3xl">{isPlaying ? 'pause' : 'play_arrow'}</span>
                </button>
                <button onClick={onSkipNext} className="text-white/60 hover:text-white transition-all hover:scale-110">
                  <span className="material-symbols-outlined text-2xl">skip_next</span>
                </button>
              </div>

              <div className="flex justify-end gap-4 text-white/20 items-center">
                <span className="material-symbols-outlined text-lg hover:text-white cursor-pointer transition-colors">volume_up</span>
                <div className="w-16 relative h-4 flex items-center group">
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
        </div>
      </div>
    </div>
  );
};

export default FocusMode;
