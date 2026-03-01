import React, { useState, useEffect } from 'react';
import { ViewMode } from '../types';
import { i18n } from '../services/i18n';

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

const Sidebar: React.FC<SidebarProps> = ({ 
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
  // Force re-render when language changes
  const [, setLanguageVersion] = useState(0);
  
  // Sync local state with global searchInputValue when it changes from outside
  useEffect(() => {
    setInputValue(searchInputValue);
  }, [searchInputValue]);

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = i18n.subscribe(() => {
      setLanguageVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

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
              <span className="text-sm font-semibold">{i18n.t('sidebar.library')}</span>
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
              <span className="text-sm font-semibold">{i18n.t('sidebar.browse')}</span>
            </button>

            <button
              onClick={onImportClick}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-white/60 hover:bg-primary/10 hover:text-primary transition-all mt-4 border border-dashed border-white/20 group"
            >
              <span className="material-symbols-outlined group-hover:scale-110 transition-transform">add_circle</span>
              <span className="text-sm font-semibold">{i18n.t('sidebar.importFiles')}</span>
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
                    placeholder={isBrowseView ? i18n.t('sidebar.searchOnline') : i18n.t('sidebar.searchTracks')}
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

            {/* 设置和皮肤按钮 */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => onNavigate(ViewMode.SETTINGS)}
                className={`flex items-center justify-center px-4 py-3.5 rounded-xl transition-all ${
                  currentView === ViewMode.SETTINGS
                    ? 'bg-primary/20 text-primary shadow-[0_0_20px_rgba(43,140,238,0.15)]'
                    : 'bg-white/5 text-white/60 hover:bg-white/[0.08] hover:text-white'
                }`}
                title={i18n.t('sidebar.settings')}
              >
                <span className={`material-symbols-outlined text-[22px] ${currentView === ViewMode.SETTINGS ? 'fill-1' : ''}`}>settings</span>
              </button>

              <button
                onClick={() => onNavigate(ViewMode.THEME)}
                className={`flex items-center justify-center px-4 py-3.5 rounded-xl transition-all ${
                  currentView === ViewMode.THEME
                    ? 'bg-primary/20 text-primary shadow-[0_0_20px_rgba(43,140,238,0.15)]'
                    : 'bg-white/5 text-white/60 hover:bg-white/[0.08] hover:text-white'
                }`}
                title={i18n.t('sidebar.theme')}
              >
                <span className={`material-symbols-outlined text-[22px] ${currentView === ViewMode.THEME ? 'fill-1' : ''}`}>checkroom</span>
              </button>
            </div>

            {hasUnavailableTracks && onReloadFiles && (
              <button
                onClick={onReloadFiles}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-yellow-400/80 hover:bg-yellow-500/10 hover:text-yellow-400 transition-all border border-dashed border-yellow-500/20 group"
                title="Reload unavailable tracks"
              >
                <span className="material-symbols-outlined group-hover:scale-110 transition-transform">refresh</span>
                <span className="text-sm font-semibold">{i18n.t('sidebar.reloadFiles')}</span>
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
};

export default Sidebar;
