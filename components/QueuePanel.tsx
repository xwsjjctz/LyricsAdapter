
import React, { memo } from 'react';
import { Track } from '../types';

interface QueuePanelProps {
  tracks: Track[];
  currentTrackIndex: number;
  isOpen: boolean;
  onTrackSelect: (index: number) => void;
}

const QueuePanel: React.FC<QueuePanelProps> = memo(({ tracks, currentTrackIndex, isOpen, onTrackSelect }) => {
  return (
    <aside className={`w-80 glass border-l border-white/10 flex flex-col h-full z-20 transition-all duration-500 transform ${isOpen ? 'translate-x-0' : 'translate-x-full fixed right-0'}`}>
      <div className="p-6 h-full flex flex-col">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
          Up Next
          <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full font-medium text-white/40">{tracks.length}</span>
        </h2>
        
        <div className="flex-1 flex flex-col gap-2 overflow-y-auto custom-scrollbar pr-1">
          {tracks.length > 0 ? (
            tracks.map((track, index) => (
              <div 
                key={track.id}
                onClick={() => onTrackSelect(index)}
                className={`flex items-center gap-3 p-3 rounded-xl transition-all cursor-pointer group border ${
                  index === currentTrackIndex 
                  ? 'bg-primary/20 border-primary/30 shadow-lg' 
                  : 'bg-white/5 border-transparent hover:bg-white/10'
                }`}
              >
                <div 
                  className="size-12 rounded-lg bg-cover bg-center shrink-0 shadow-md group-hover:scale-105 transition-transform" 
                  style={{backgroundImage: `url('${track.coverUrl}')`}}
                ></div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold truncate transition-colors ${index === currentTrackIndex ? 'text-primary' : ''}`}>
                    {track.title}
                  </p>
                  <p className="text-xs text-white/40 truncate">{track.artist}</p>
                </div>
                {index === currentTrackIndex && (
                  <div className="size-4 flex items-center justify-center">
                    <div className="flex gap-0.5 items-end h-3">
                      <div className="w-0.5 bg-primary animate-[bounce_0.6s_infinite_0s]"></div>
                      <div className="w-0.5 bg-primary animate-[bounce_0.6s_infinite_0.2s]"></div>
                      <div className="w-0.5 bg-primary animate-[bounce_0.6s_infinite_0.4s]"></div>
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="flex-1 flex items-center justify-center flex-col opacity-20 text-center px-4">
              <span className="material-symbols-outlined text-4xl mb-4">playlist_add</span>
              <p className="text-sm">Queue is empty. Import files to see them here.</p>
            </div>
          )}
        </div>

        <div className="mt-6 pt-6 border-t border-white/10">
          <button className="w-full py-3 rounded-xl border border-white/10 hover:bg-white/5 transition-colors text-sm font-semibold tracking-wide">
            View Full Queue
          </button>
        </div>
      </div>
    </aside>
  );
});

QueuePanel.displayName = 'QueuePanel';

export default QueuePanel;
