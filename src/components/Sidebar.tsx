import React, { useState, useMemo, useCallback, memo } from 'react';
import { ViewMode, SlotId } from '../types';
import { useTranslation } from 'react-i18next';
import { webdavClient } from '../services/webdavClient';
import { notify } from '../services/notificationService';

interface SidebarProps {
  onNavigate: (mode: ViewMode) => void;
  currentView: ViewMode;
  onReloadFiles?: () => void;
  hasUnavailableTracks?: boolean;
  viewMode: ViewMode;
  activeSlotId: SlotId;
  onSlotChange: (slotId: SlotId) => void;
  floating?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  onNavigate,
  currentView,
  onReloadFiles,
  hasUnavailableTracks,
  viewMode: _viewMode,
  activeSlotId,
  onSlotChange,
}) => {
  const isLibraryView = currentView === ViewMode.PLAYER || currentView === ViewMode.LYRICS;
  const isSettingsView = currentView === ViewMode.SETTINGS;
  const isThemeView = currentView === ViewMode.THEME;
  const isPlaylistsView = currentView === ViewMode.PLAYLISTS;

  const { t } = useTranslation();
  const [isReloadHovered, setIsReloadHovered] = useState(false);

  // Note: theme colors are driven entirely by CSS variables (var(--theme-*)),
  // which the browser re-resolves on theme switch — no React state or
  // re-render needed here.

  const handleSlotClick = useCallback((slotId: SlotId) => {
    if (slotId === 'cloud') {
      if (!webdavClient.hasConfig()) {
        notify(t('settingsDialog.webdavTitle'), t('settingsDialog.webdavFillAll'));
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
      label: t('sidebar.local'),
      active: isLibraryView && activeSlotId === 'local',
      onClick: () => handleSlotClick('local'),
    },
    {
      key: 'cloud' as const,
      icon: 'cloud',
      label: t('sidebar.cloud'),
      active: isLibraryView && activeSlotId === 'cloud',
      onClick: () => handleSlotClick('cloud'),
    },
  ], [isLibraryView, activeSlotId, handleSlotClick]);

  const onlineItems = useMemo(() => [
    {
      key: 'online',
      icon: 'history',
      label: t('sidebar.onlineQueue'),
      active: isLibraryView && activeSlotId === 'online',
      onClick: () => handleSlotClick('online'),
    },
    {
      key: 'playlists',
      icon: 'queue_music',
      label: t('sidebar.playlists'),
      active: isPlaylistsView,
      onClick: () => onNavigate(ViewMode.PLAYLISTS),
    },
  ], [isLibraryView, activeSlotId, handleSlotClick, isPlaylistsView, onNavigate]);

  const renderNavItem = (
    item: {
      key: string;
      icon: string;
      label: string;
      active: boolean;
      onClick: () => void;
    },
    compact = false
  ) => (
    <button
      key={item.key}
      onClick={item.onClick}
      className={`relative flex items-center gap-3 transition-colors w-full text-left ${
        compact ? 'min-h-11 px-2.5 py-2.5' : 'min-h-12 px-2.5 py-2.5'
      } ${
        item.active
          ? ''
          : 'bg-transparent text-[var(--theme-control-action-fg)] hover:text-[var(--theme-control-action-fg-hover)]'
      }`}
      style={{
        ...(item.active
          ? { backgroundColor: 'color-mix(in srgb, var(--theme-control-item-bg-active) 78%, transparent)', color: 'var(--theme-control-item-fg-active)' }
          : {}),
        borderRadius: 'var(--theme-control-radius)',
        boxShadow: item.active ? 'var(--theme-control-item-shadow-active)' : 'none',
        textTransform: 'var(--theme-control-text-transform)' as React.CSSProperties['textTransform'],
        letterSpacing: 'var(--theme-button-letter-spacing)',
      }}
    >
      <span
        className="absolute left-0 top-2 bottom-2 w-1 transition-opacity"
        style={{
          backgroundColor: 'var(--theme-primary)',
          borderRadius: '999px',
          opacity: item.active ? 1 : 0,
        }}
      />
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center"
        style={{
          backgroundColor: item.active ? 'var(--theme-control-icon-bg-active)' : 'var(--theme-control-icon-bg)',
          color: item.active ? 'var(--theme-control-icon-fg-active)' : 'var(--theme-control-icon-fg)',
          borderRadius: 'var(--theme-control-radius)',
        }}
      >
        <span className={`material-symbols-outlined text-[20px] leading-none ${item.active ? 'fill-1' : ''}`}>{item.icon}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-none">{item.label}</span>
      </span>
    </button>
  );

  const renderSection = (
    title: string,
    items: Array<{
      key: string;
      icon: string;
      label: string;
      active: boolean;
      onClick: () => void;
    }>
  ) => (
    <div
      className="px-2 py-2"
      style={{
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--theme-control-container-bg) 90%, transparent), color-mix(in srgb, var(--theme-control-container-bg) 58%, transparent))',
        border: 'var(--theme-control-border-width) solid var(--theme-control-container-border)',
        borderRadius: 'var(--theme-surface-radius)',
        boxShadow: 'var(--theme-elevated-shadow)',
      }}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.24em] px-3 pt-2 pb-2" style={{ color: 'var(--theme-text-muted)' }}>
        <span>
          {title}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {items.map((item) => renderNavItem(item))}
      </div>
    </div>
  );

  return (
    <>
      {renderSection(t('sidebar.library'), libraryItems)}
      {renderSection(t('sidebar.onlineMusic'), onlineItems)}

      {/* 设置和皮肤按钮 */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => onNavigate(ViewMode.SETTINGS)}
          className={`flex items-center justify-center px-4 py-3.5 transition-colors ${
            isSettingsView
              ? ''
              : 'bg-[var(--theme-control-action-bg)] text-[var(--theme-control-action-fg)] hover:bg-[var(--theme-control-action-bg-hover)] hover:text-[var(--theme-control-action-fg-hover)]'
          }`}
          style={{
            ...(isSettingsView ? { backgroundColor: 'var(--theme-control-action-bg-active)', color: 'var(--theme-control-action-fg-active)' } : {}),
            borderRadius: 'var(--theme-control-radius)',
            boxShadow: isSettingsView ? 'var(--theme-control-action-shadow-active)' : 'var(--theme-control-action-shadow)',
          }}
        >
          <span className={`material-symbols-outlined text-[22px] ${isSettingsView ? 'fill-1' : ''}`}>settings</span>
        </button>

        <button
          onClick={() => onNavigate(ViewMode.THEME)}
          className={`flex items-center justify-center px-4 py-3.5 transition-colors ${
            isThemeView
              ? ''
              : 'bg-[var(--theme-control-action-bg)] text-[var(--theme-control-action-fg)] hover:bg-[var(--theme-control-action-bg-hover)] hover:text-[var(--theme-control-action-fg-hover)]'
          }`}
          style={{
            ...(isThemeView ? { backgroundColor: 'var(--theme-control-action-bg-active)', color: 'var(--theme-control-action-fg-active)' } : {}),
            borderRadius: 'var(--theme-control-radius)',
            boxShadow: isThemeView ? 'var(--theme-control-action-shadow-active)' : 'var(--theme-control-action-shadow)',
          }}
        >
          <span className={`material-symbols-outlined text-[22px] ${isThemeView ? 'fill-1' : ''}`}>checkroom</span>
        </button>
      </div>

      {hasUnavailableTracks && onReloadFiles && (
        <button
          onClick={onReloadFiles}
          onMouseEnter={() => setIsReloadHovered(true)}
          onMouseLeave={() => setIsReloadHovered(false)}
          className="flex items-center gap-3 px-4 py-3 transition-colors border border-dashed group"
          style={{
            backgroundColor: isReloadHovered ? 'var(--theme-warning-10)' : 'transparent',
            borderColor: 'var(--theme-warning-20)',
            borderRadius: 'var(--theme-control-radius)',
            borderWidth: 'var(--theme-control-border-width)',
            color: 'var(--theme-warning)',
          }}
          title="Reload unavailable tracks"
        >
          <span className="material-symbols-outlined group-hover:scale-110 transition-transform">refresh</span>
          <span className="text-sm font-semibold">{t('sidebar.reloadFiles')}</span>
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
          className="flex-1 flex flex-col ml-2 mr-0 mb-2 mt-2 overflow-hidden"
          style={{
            backgroundColor: 'var(--theme-background-sidebar)',
            borderRadius: 'var(--theme-surface-radius)',
            border: 'var(--theme-panel-border-width) solid var(--theme-border-light)',
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
        borderRight: 'var(--theme-panel-border-width) solid var(--theme-border-light)',
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
