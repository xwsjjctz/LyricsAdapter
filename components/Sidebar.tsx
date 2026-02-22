import React, { memo, useState, useEffect } from 'react';
import { ViewMode } from '../types';

interface SidebarProps {
  onImportClick: () => void;
  onNavigate: (mode: ViewMode) => void;
  currentView: ViewMode;
  onReloadFiles?: () => void;
  hasUnavailableTracks?: boolean;
  searchInputValue?: string;
  onSearchInputChange?: (value: string) => void;
  onSearchExecute?: () => void;
  viewMode: ViewMode;
}

const Sidebar: React.FC<SidebarProps> = memo(({ 
  onImportClick, 
  onNavigate, 
  currentView, 
  onReloadFiles, 
  hasUnavailableTracks, 
  searchInputValue = '', 
  onSearchInputChange,
  onSearchExecute,
  viewMode
}) => {
  const isLibraryView = currentView === ViewMode.PLAYER || currentView === ViewMode.LYRICS;
  const isBrowseView = currentView === ViewMode.BROWSE;
  
  // Local state for input (synced with global searchInputValue)
  const [inputValue, setInputValue] = useState(searchInputValue);
  
  // Sync local state with global searchInputValue when it changes from outside
  useEffect(() => {
    setInputValue(searchInputValue);
  }, [searchInputValue]);

  // Handle input change - update global state and local state
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onSearchInputChange?.(newValue);
  };

  // Handle Enter key to execute search
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearchExecute?.();
    }
  };

  // Handle clear - clear both local and global state
  const handleClear = () => {
    setInputValue('');
    onSearchInputChange?.('');
    onSearchExecute?.();
  };

  return (
    <aside className="w-64 flex flex-col bg-background-sidebar/60 backdrop-blur-md border-r border-white/10 z-20 pt-8">
      <div className="px-6 flex flex-col gap-6 pt-6">
        <div>
          <nav className="flex flex-col gap-2">
            <button
              onClick={() => onNavigate(ViewMode.PLAYER)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                isLibraryView
                  ? 'bg-primary/20 text-primary shadow-[0_0_20px_rgba(43,140,238,0.15)]'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span className={`material-symbols-outlined text-xl ${isLibraryView ? 'fill-1' : ''}`}>library_music</span>
              <span className="text-sm font-semibold">Library</span>
            </button>

            <button
              onClick={() => onNavigate(ViewMode.BROWSE)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                isBrowseView
                  ? 'bg-primary/20 text-primary shadow-[0_0_20px_rgba(43,140,238,0.15)]'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span className={`material-symbols-outlined text-xl ${isBrowseView ? 'fill-1' : ''}`}>explore</span>
              <span className="text-sm font-semibold">Browse</span>
            </button>

            <button
              onClick={onImportClick}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-white/60 hover:bg-primary/10 hover:text-primary transition-all mt-4 border border-dashed border-white/20 group"
            >
              <span className="material-symbols-outlined group-hover:scale-110 transition-transform">add_circle</span>
              <span className="text-sm font-semibold">Import Files</span>
            </button>

            {/* 搜索框 */}
            {onSearchInputChange && onSearchExecute && (
              <div className="mt-4">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-white/40 text-lg">
                    search
                  </span>
                  <input
                    type="text"
                    placeholder={isBrowseView ? 'Search online (Enter)' : 'Search tracks (Enter)'}
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-13 pr-10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50 focus:bg-white/[0.07] transition-all"
                  />
                  {inputValue && (
                    <button
                      onClick={handleClear}
                      className="absolute right-3 top-5/9 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                    >
                      <span className="material-symbols-outlined text-lg">close</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {hasUnavailableTracks && onReloadFiles && (
              <button
                onClick={onReloadFiles}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-yellow-400/80 hover:bg-yellow-500/10 hover:text-yellow-400 transition-all border border-dashed border-yellow-500/20 group"
                title="Reload unavailable tracks"
              >
                <span className="material-symbols-outlined group-hover:scale-110 transition-transform">refresh</span>
                <span className="text-sm font-semibold">Reload Files</span>
              </button>
            )}
          </nav>
        </div>
      </div>

      <div className="mt-auto p-8 opacity-20">
        <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-center">Lyrics Adapter</p>
      </div>
    </aside>
  );
});

Sidebar.displayName = 'Sidebar';

export default Sidebar;
