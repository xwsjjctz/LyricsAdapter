
import React from 'react';
import { Track } from '../types';

interface LyricsOverlayProps {
  track: Track | null;
  isVisible: boolean;
}

const LyricsOverlay: React.FC<LyricsOverlayProps> = ({ track, isVisible }) => {
  if (!isVisible) return null;

  const lines = track?.lyrics ? track.lyrics.split('\n') : [];

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-start py-20 px-10 overflow-y-auto custom-scrollbar transition-all duration-700 animate-in fade-in zoom-in-95">
      <div className="max-w-3xl w-full">
        {track?.lyrics ? (
          <div className="flex flex-col gap-8 items-center text-center">
             {lines.map((line, idx) => (
                <p 
                  key={idx} 
                  className="text-4xl font-bold leading-relaxed opacity-40 hover:opacity-100 transition-opacity cursor-default hover:text-primary"
                >
                  {line.trim() || '...'}
                </p>
             ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[50vh] opacity-20 text-center">
            <span className="material-symbols-outlined text-8xl mb-6">lyrics</span>
            <p className="text-2xl font-bold tracking-tight">
              {track ? "No lyrics found in this FLAC file." : "Select a track to view lyrics."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LyricsOverlay;
