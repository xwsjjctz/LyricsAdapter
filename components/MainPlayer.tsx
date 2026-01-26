
import React from 'react';
import { Track } from '../types';

interface MainPlayerProps {
  track: Track | null;
  isVisible: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
}

const MainPlayer: React.FC<MainPlayerProps> = ({ track, isVisible, isPlaying, onTogglePlay }) => {
  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pb-32 px-10 transition-all duration-700 animate-in fade-in slide-in-from-bottom-4">
      {track ? (
        <>
          <div className="relative group">
            <div className={`w-80 h-80 rounded-2xl overflow-hidden album-shadow transition-all duration-700 ${isPlaying ? 'scale-[1.05]' : 'scale-100 hover:scale-[1.02]'}`}>
              <img 
                className="w-full h-full object-cover transition-transform duration-1000" 
                src={track.coverUrl} 
                alt={track.title} 
              />
            </div>
            
            {/* Play Overlay */}
            <div 
              onClick={onTogglePlay}
              className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all bg-black/30 rounded-2xl cursor-pointer"
            >
              <div className="size-20 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30 scale-90 group-hover:scale-100 transition-transform">
                <span className="material-symbols-outlined text-5xl fill-1 text-white">
                  {isPlaying ? 'pause' : 'play_arrow'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-12 text-center max-w-2xl">
            <h1 className="text-5xl font-bold tracking-tight mb-3 text-white drop-shadow-lg">{track.title}</h1>
            <p className="text-2xl text-primary font-medium opacity-90">{track.artist} — {track.album}</p>
          </div>
        </>
      ) : (
        <div className="text-center opacity-40">
          <span className="material-symbols-outlined text-8xl mb-6 block">music_note</span>
          <p className="text-xl font-medium tracking-wide">Import tracks to start listening</p>
        </div>
      )}
    </div>
  );
};

export default MainPlayer;
