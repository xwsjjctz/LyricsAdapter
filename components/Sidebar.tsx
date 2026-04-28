import React, { useState, useEffect } from 'react';
import { ViewMode } from '../types';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';
import { webdavClient } from '../services/webdavClient';
import { notify } from '../services/notificationService';

interface SidebarProps {
  onImportClick: () => void;
  onNavigate: (mode: ViewMode) => void;
  currentView: ViewMode;
  onReloadFiles?: () => void;
  hasUnavailableTracks?: boolean;
  viewMode: ViewMode;
  activeSlotId: 'local' | 'cloud';
  onSlotChange: (slotId: 'local' | 'cloud') => void;
  localTrackCount: number;
  cloudTrackCount: number;
}

const Sidebar: React.FC<SidebarProps> = ({
  onImportClick,
  onNavigate,
  currentView,
  onReloadFiles,
  hasUnavailableTracks,
  viewMode: _viewMode,
  activeSlotId,
  onSlotChange,
  localTrackCount,
  cloudTrackCount,
}) => {
  const isLibraryView = currentView === ViewMode.PLAYER || currentView === ViewMode.LYRICS;
  const isBrowseView = currentView === ViewMode.BROWSE;
  const isMetadataView = currentView === ViewMode.METADATA;
  const isSettingsView = currentView === ViewMode.SETTINGS;
  const isThemeView = currentView === ViewMode.THEME;

  // Force re-render when language changes
  const [, setLanguageVersion] = useState(0);
  // Track current theme for styling
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());

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

  // Get theme-aware styles
  const colors = currentTheme.colors;
  const isDark = currentTheme.isDark;
  
  // Text colors based on theme
  const textPrimary = colors.textPrimary;
  const textSecondary = colors.textSecondary;
  const libraryItems = [
    {
      key: 'local' as const,
      icon: 'hard_drive',
      label: i18n.t('sidebar.local'),
      count: localTrackCount,
      active: isLibraryView && activeSlotId === 'local',
      onClick: () => {
        if (!isLibraryView) onNavigate(ViewMode.PLAYER);
        onSlotChange('local');
      },
    },
    {
      key: 'cloud' as const,
      icon: 'cloud',
      label: i18n.t('sidebar.cloud'),
      count: cloudTrackCount,
      active: isLibraryView && activeSlotId === 'cloud',
      onClick: () => {
        if (!webdavClient.hasConfig()) {
          notify(i18n.t('settingsDialog.webdavTitle'), i18n.t('settingsDialog.webdavFillAll'));
          onNavigate(ViewMode.SETTINGS);
          return;
        }
        if (!isLibraryView) onNavigate(ViewMode.PLAYER);
        onSlotChange('cloud');
      },
    },
  ];

  return (
    <aside 
      className="w-56 flex flex-col backdrop-blur-md z-20 pt-8"
      style={{
        backgroundColor: colors.backgroundSidebar,
        borderRight: `1px solid ${colors.borderLight}`,
      }}
    >
      <div className="px-6 flex flex-col gap-6 pt-6">
        <div>
          <nav className="flex flex-col gap-2">
            {/* LIBRARY 容器 */}
            <div
              className="rounded-2xl p-2"
              style={{
                backgroundColor: colors.primaryLight,
                border: `1px solid ${colors.borderLight}`,
              }}
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.24em] px-3 pt-2 pb-2" style={{ color: colors.textMuted }}>
                {i18n.t('sidebar.library')}
              </div>
              <div className="flex flex-col gap-1">
                {libraryItems.map((item) => (
                  <button
                    key={item.key}
                    onClick={item.onClick}
                    className="flex min-h-12 items-center gap-3 rounded-xl px-3 py-3 transition-all w-full text-left"
                    style={{
                      backgroundColor: item.active ? `${colors.primary}29` : 'transparent',
                      color: item.active ? colors.primary : textSecondary,
                      boxShadow: item.active ? `0 10px 24px -16px ${colors.glowColor}` : 'none',
                    }}
                    onMouseEnter={(e) => {
                      if (!item.active) {
                        e.currentTarget.style.backgroundColor = `${colors.backgroundCard}`;
                        e.currentTarget.style.color = textPrimary;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!item.active) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = textSecondary;
                      }
                    }}
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                      style={{
                        backgroundColor: item.active ? `${colors.primary}22` : `${colors.backgroundCard}cc`,
                        color: item.active ? colors.primary : textSecondary,
                      }}
                    >
                      <span className={`material-symbols-outlined text-[20px] leading-none ${item.active ? 'fill-1' : ''}`}>{item.icon}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-none">{item.label}</span>
                    </span>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
                      style={{
                        backgroundColor: item.active ? `${colors.primary}30` : `${colors.primary}18`,
                        color: item.active ? colors.primary : `${colors.primary}cc`,
                      }}
                    >
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* 分隔 */}
            <div className="my-1 mx-4 border-t" style={{ borderColor: colors.borderLight }} />

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
              className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all mt-2 border border-dashed group"
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

            {/* 设置和皮肤按钮 */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => onNavigate(ViewMode.SETTINGS)}
                className="flex items-center justify-center px-4 py-3.5 rounded-xl transition-all"
                style={{
                  backgroundColor: isSettingsView ? `${colors.primary}33` : colors.backgroundCard,
                  color: isSettingsView ? colors.primary : textSecondary,
                  boxShadow: isSettingsView ? `0 0 20px ${colors.glowColor}` : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isSettingsView) {
                    e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                    e.currentTarget.style.color = textPrimary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSettingsView) {
                    e.currentTarget.style.backgroundColor = colors.backgroundCard;
                    e.currentTarget.style.color = textSecondary;
                  }
                }}
              >
                <span className={`material-symbols-outlined text-[22px] ${isSettingsView ? 'fill-1' : ''}`}>settings</span>
              </button>

              <button
                onClick={() => onNavigate(ViewMode.THEME)}
                className="flex items-center justify-center px-4 py-3.5 rounded-xl transition-all"
                style={{
                  backgroundColor: isThemeView ? `${colors.primary}33` : colors.backgroundCard,
                  color: isThemeView ? colors.primary : textSecondary,
                  boxShadow: isThemeView ? `0 0 20px ${colors.glowColor}` : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isThemeView) {
                    e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                    e.currentTarget.style.color = textPrimary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isThemeView) {
                    e.currentTarget.style.backgroundColor = colors.backgroundCard;
                    e.currentTarget.style.color = textSecondary;
                  }
                }}
              >
                <span className={`material-symbols-outlined text-[22px] ${isThemeView ? 'fill-1' : ''}`}>checkroom</span>
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
