import React, { useMemo, useCallback, memo } from 'react';
import { ViewMode } from '../types';
import { i18n } from '../services/i18n';
import { useI18n, useTheme } from '../hooks/useServices';
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
  floating?: boolean;
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
  const isSettingsView = currentView === ViewMode.SETTINGS;
  const isThemeView = currentView === ViewMode.THEME;

  useI18n();
  const currentTheme = useTheme();

  // Get theme-aware styles
  const colors = currentTheme.colors;
  const isDark = currentTheme.isDark;

  // Text colors based on theme
  const textSecondary = colors.textSecondary;

  const handleSlotClick = useCallback((slotId: 'local' | 'cloud') => {
    if (slotId === 'cloud') {
      if (!webdavClient.hasConfig()) {
        notify(i18n.t('settingsDialog.webdavTitle'), i18n.t('settingsDialog.webdavFillAll'));
        onNavigate(ViewMode.SETTINGS);
        return;
      }
    }
    if (!isLibraryView) onNavigate(ViewMode.PLAYER);
    onSlotChange(slotId);
  }, [isLibraryView, onNavigate, onSlotChange]);

  const libraryItems = useMemo(() => [
    {
      key: 'local' as const,
      icon: 'hard_drive',
      label: i18n.t('sidebar.local'),
      count: localTrackCount,
      active: isLibraryView && activeSlotId === 'local',
      onClick: () => handleSlotClick('local'),
    },
    {
      key: 'cloud' as const,
      icon: 'cloud',
      label: i18n.t('sidebar.cloud'),
      count: cloudTrackCount,
      active: isLibraryView && activeSlotId === 'cloud',
      onClick: () => handleSlotClick('cloud'),
    },
  ], [localTrackCount, cloudTrackCount, isLibraryView, activeSlotId, handleSlotClick]);

  return (
    <>
      {/* LIBRARY 容器 */}
      <div
        className="rounded-2xl p-2 shadow-xl"
        style={{
          backgroundColor: 'var(--theme-primary-light)',
          border: '1px solid var(--theme-border-light)',
        }}
      >
        <div className="text-[10px] font-bold uppercase tracking-[0.24em] px-3 pt-2 pb-2" style={{ color: 'var(--theme-text-muted)' }}>
          {i18n.t('sidebar.library')}
        </div>
        <div className="flex flex-col gap-1">
          {libraryItems.map((item) => (
            <button
              key={item.key}
              onClick={item.onClick}
              className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-3 transition-colors w-full text-left ${
                item.active
                  ? ''
                  : 'bg-transparent text-[var(--theme-text-secondary)] hover:bg-[var(--theme-background-card)] hover:text-[var(--theme-text-primary)]'
              }`}
              style={{
                ...(item.active ? { backgroundColor: `${colors.primary}29`, color: colors.primary } : {}),
                boxShadow: item.active ? '0 10px 24px -16px var(--theme-glow-color)' : 'none',
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
            </button>
          ))}
        </div>
      </div>

      {/* 分隔 */}
      <div className="my-1 mx-4 border-t" style={{ borderColor: 'var(--theme-border-light)' }} />

      <button
        onClick={onImportClick}
        className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors mt-2 border border-dashed group text-[var(--theme-text-secondary)]"
        style={{
          borderColor: 'var(--theme-border-light)',
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
          className={`flex items-center justify-center px-4 py-3.5 rounded-xl transition-colors ${
            isSettingsView
              ? ''
              : 'bg-[var(--theme-background-card)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-background-card-hover)] hover:text-[var(--theme-text-primary)]'
          }`}
          style={{
            ...(isSettingsView ? { backgroundColor: `${colors.primary}33`, color: colors.primary } : {}),
            boxShadow: isSettingsView ? '0 0 20px var(--theme-glow-color)' : '0 4px 16px -6px var(--theme-glow-color)',
          }}
        >
          <span className={`material-symbols-outlined text-[22px] ${isSettingsView ? 'fill-1' : ''}`}>settings</span>
        </button>

        <button
          onClick={() => onNavigate(ViewMode.THEME)}
          className={`flex items-center justify-center px-4 py-3.5 rounded-xl transition-colors ${
            isThemeView
              ? ''
              : 'bg-[var(--theme-background-card)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-background-card-hover)] hover:text-[var(--theme-text-primary)]'
          }`}
          style={{
            ...(isThemeView ? { backgroundColor: `${colors.primary}33`, color: colors.primary } : {}),
            boxShadow: isThemeView ? '0 0 20px var(--theme-glow-color)' : '0 4px 16px -6px var(--theme-glow-color)',
          }}
        >
          <span className={`material-symbols-outlined text-[22px] ${isThemeView ? 'fill-1' : ''}`}>checkroom</span>
        </button>
      </div>

      {hasUnavailableTracks && onReloadFiles && (
        <button
          onClick={onReloadFiles}
          className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors border border-dashed group text-[var(--theme-warning)]"
          style={{
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
    </>
  );
};

const MemoizedSidebar = memo(Sidebar);

const SidebarWrapper: React.FC<SidebarProps> = (props) => {
  const { floating } = props;

  if (floating) {
    return (
      <div
        className="w-56 flex flex-col flex-shrink-0"
        style={{
          backgroundColor: 'transparent',
        }}
      >
        <aside
          className="flex-1 flex flex-col ml-2 mr-0 mb-2 mt-2 rounded-lg overflow-hidden"
          style={{
            backgroundColor: 'var(--theme-background-sidebar)',
            filter: `drop-shadow(0 6px 24px rgba(0, 0, 0, 0.45))`,
          }}
        >
          {/* 面板延伸到 TitleBar 下层，此 spacer 确保内容避开 TitleBar 交互区域 */}
          <div className="h-[28px] flex-shrink-0" />

          <div className="px-4 flex flex-col gap-6 pt-3 flex-1 overflow-hidden">
            <div>
              <nav className="flex flex-col gap-2">
                <MemoizedSidebar {...props} />
              </nav>
            </div>
          </div>

          <div className="mt-auto p-8" style={{ opacity: 0.2 }}>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.3em] text-center"
              style={{ color: 'var(--theme-text-primary)' }}
            >
              Lyrics Adapter
            </p>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <aside
      className="w-56 flex flex-col backdrop-blur-md z-20 pt-8"
      style={{
        backgroundColor: 'var(--theme-background-sidebar)',
        borderRight: '1px solid var(--theme-border-light)',
      }}
    >
      <div className="px-6 flex flex-col gap-6 pt-3 flex-1 overflow-hidden">
        <div>
          <nav className="flex flex-col gap-2">
            <MemoizedSidebar {...props} />
          </nav>
        </div>
      </div>

      <div className="mt-auto p-8" style={{ opacity: 0.2 }}>
        <p
          className="text-[9px] font-bold uppercase tracking-[0.3em] text-center"
          style={{ color: 'var(--theme-text-primary)' }}
        >
          Lyrics Adapter
        </p>
      </div>
    </aside>
  );
};

export default SidebarWrapper;
