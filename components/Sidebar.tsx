import React, { useState, useEffect } from 'react';
import { ViewMode } from '../types';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';

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
  viewMode: _viewMode
}) => {
  const isLibraryView = currentView === ViewMode.PLAYER || currentView === ViewMode.LYRICS;
  const isBrowseView = currentView === ViewMode.BROWSE;
  const isMetadataView = currentView === ViewMode.METADATA;

  // Local state for input (synced with global searchInputValue)
  const [inputValue, setInputValue] = useState(searchInputValue);
  // Force re-render when language changes
  const [, setLanguageVersion] = useState(0);
  // Track current theme for styling
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());

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

  // Subscribe to theme changes
  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
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

  // Handle clear - clear both local and local state
  const handleClear = () => {
    setInputValue('');
    onSearchInputChange?.('');
    onSearchExecute?.();
  };

  // Get theme-aware styles
  const colors = currentTheme.colors;
  const isDark = currentTheme.isDark;
  
  // Text colors based on theme
  const textPrimary = colors.textPrimary;
  const textSecondary = colors.textSecondary;
  const textMuted = colors.textMuted;

  return (
    <aside 
      className="w-64 flex flex-col backdrop-blur-md z-20 pt-8"
      style={{
        backgroundColor: colors.backgroundSidebar,
        borderRight: `1px solid ${colors.borderLight}`,
      }}
    >
      <div className="px-6 flex flex-col gap-6 pt-6">
        <div>
          <nav className="flex flex-col gap-2">
            <button
              onClick={() => onNavigate(ViewMode.PLAYER)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
              style={{
                backgroundColor: isLibraryView ? `${colors.primary}33` : 'transparent',
                color: isLibraryView ? colors.primary : textSecondary,
                boxShadow: isLibraryView ? `0 0 20px ${colors.glowColor}` : 'none',
              }}
              onMouseEnter={(e) => {
                if (!isLibraryView) {
                  e.currentTarget.style.backgroundColor = `${colors.backgroundCard}`;
                  e.currentTarget.style.color = textPrimary;
                }
              }}
              onMouseLeave={(e) => {
                if (!isLibraryView) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = textSecondary;
                }
              }}
            >
              <span className={`material-symbols-outlined text-xl ${isLibraryView ? 'fill-1' : ''}`}>library_music</span>
              <span className="text-sm font-semibold">{i18n.t('sidebar.library')}</span>
            </button>

            <button
              onClick={() => onNavigate(ViewMode.BROWSE)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
              style={{
                backgroundColor: isBrowseView ? `${colors.primary}33` : 'transparent',
                color: isBrowseView ? colors.primary : textSecondary,
                boxShadow: isBrowseView ? `0 0 20px ${colors.glowColor}` : 'none',
              }}
              onMouseEnter={(e) => {
                if (!isBrowseView) {
                  e.currentTarget.style.backgroundColor = `${colors.backgroundCard}`;
                  e.currentTarget.style.color = textPrimary;
                }
              }}
              onMouseLeave={(e) => {
                if (!isBrowseView) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = textSecondary;
                }
              }}
            >
              <span className={`material-symbols-outlined text-xl ${isBrowseView ? 'fill-1' : ''}`}>explore</span>
              <span className="text-sm font-semibold">{i18n.t('sidebar.browse')}</span>
            </button>

            <button
              onClick={() => onNavigate(ViewMode.METADATA)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
              style={{
                backgroundColor: isMetadataView ? `${colors.primary}33` : 'transparent',
                color: isMetadataView ? colors.primary : textSecondary,
                boxShadow: isMetadataView ? `0 0 20px ${colors.glowColor}` : 'none',
              }}
              onMouseEnter={(e) => {
                if (!isMetadataView) {
                  e.currentTarget.style.backgroundColor = `${colors.backgroundCard}`;
                  e.currentTarget.style.color = textPrimary;
                }
              }}
              onMouseLeave={(e) => {
                if (!isMetadataView) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = textSecondary;
                }
              }}
            >
              <span className={`material-symbols-outlined text-xl ${isMetadataView ? 'fill-1' : ''}`}>description</span>
              <span className="text-sm font-semibold">{i18n.t('sidebar.metadata')}</span>
            </button>

            <button
              onClick={onImportClick}
              className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all mt-4 border border-dashed group"
              style={{
                color: textSecondary,
                borderColor: colors.borderLight,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = `${colors.primary}1a`;
                e.currentTarget.style.color = colors.primary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = textSecondary;
              }}
            >
              <span className="material-symbols-outlined group-hover:scale-110 transition-transform">add_circle</span>
              <span className="text-sm font-semibold">{i18n.t('sidebar.importFiles')}</span>
            </button>

            {/* 搜索框 */}
            {onSearchInputChange && onSearchExecute && (
              <div className="mt-4">
                <div className="relative">
                  <span 
                    className="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-lg"
                    style={{ color: textMuted }}
                  >
                    search
                  </span>
                  <input
                    type="text"
                    placeholder={isBrowseView ? i18n.t('sidebar.searchOnline') : i18n.t('sidebar.searchTracks')}
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    className="w-full rounded-xl py-3 pl-13 pr-10 text-sm transition-all focus:outline-none focus:ring-0"
                    style={{
                      backgroundColor: colors.backgroundCard,
                      border: `1px solid ${colors.borderLight}`,
                      color: textPrimary,
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.boxShadow = `0 0 20px ${colors.glowColor}`;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                  {inputValue && (
                    <button
                      onClick={handleClear}
                      className="absolute right-3 top-5/9 -translate-y-1/2 transition-colors"
                      style={{ color: textMuted }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = textPrimary;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = textMuted;
                      }}
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
                className="flex items-center justify-center px-4 py-3.5 rounded-xl transition-all"
                style={{
                  backgroundColor: currentView === ViewMode.SETTINGS ? `${colors.primary}33` : colors.backgroundCard,
                  color: currentView === ViewMode.SETTINGS ? colors.primary : textSecondary,
                  boxShadow: currentView === ViewMode.SETTINGS ? `0 0 20px ${colors.glowColor}` : 'none',
                }}
                onMouseEnter={(e) => {
                  if (currentView !== ViewMode.SETTINGS) {
                    e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                    e.currentTarget.style.color = textPrimary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (currentView !== ViewMode.SETTINGS) {
                    e.currentTarget.style.backgroundColor = colors.backgroundCard;
                    e.currentTarget.style.color = textSecondary;
                  }
                }}
              >
                <span className={`material-symbols-outlined text-[22px] ${currentView === ViewMode.SETTINGS ? 'fill-1' : ''}`}>settings</span>
              </button>

              <button
                onClick={() => onNavigate(ViewMode.THEME)}
                className="flex items-center justify-center px-4 py-3.5 rounded-xl transition-all"
                style={{
                  backgroundColor: currentView === ViewMode.THEME ? `${colors.primary}33` : colors.backgroundCard,
                  color: currentView === ViewMode.THEME ? colors.primary : textSecondary,
                  boxShadow: currentView === ViewMode.THEME ? `0 0 20px ${colors.glowColor}` : 'none',
                }}
                onMouseEnter={(e) => {
                  if (currentView !== ViewMode.THEME) {
                    e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                    e.currentTarget.style.color = textPrimary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (currentView !== ViewMode.THEME) {
                    e.currentTarget.style.backgroundColor = colors.backgroundCard;
                    e.currentTarget.style.color = textSecondary;
                  }
                }}
              >
                <span className={`material-symbols-outlined text-[22px] ${currentView === ViewMode.THEME ? 'fill-1' : ''}`}>checkroom</span>
              </button>
            </div>

            {hasUnavailableTracks && onReloadFiles && (
              <button
                onClick={onReloadFiles}
                className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all border border-dashed group"
                style={{
                  color: isDark ? 'rgba(250, 204, 21, 0.8)' : '#d97706',
                  borderColor: isDark ? 'rgba(234, 179, 8, 0.2)' : 'rgba(217, 119, 6, 0.3)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = isDark ? 'rgba(234, 179, 8, 0.1)' : 'rgba(217, 119, 6, 0.1)';
                  e.currentTarget.style.color = isDark ? '#facc15' : '#b45309';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = isDark ? 'rgba(250, 204, 21, 0.8)' : '#d97706';
                }}
                title="Reload unavailable tracks"
              >
                <span className="material-symbols-outlined group-hover:scale-110 transition-transform">refresh</span>
                <span className="text-sm font-semibold">{i18n.t('sidebar.reloadFiles')}</span>
              </button>
            )}
          </nav>
        </div>
      </div>

      <div className="mt-auto p-8" style={{ opacity: 0.2 }}>
        <p 
          className="text-[9px] font-bold uppercase tracking-[0.3em] text-center"
          style={{ color: textPrimary }}
        >
          Lyrics Adapter
        </p>
      </div>
    </aside>
  );
};

export default Sidebar;
