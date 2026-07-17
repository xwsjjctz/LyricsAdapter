import React, { memo, useCallback, useMemo, useState } from 'react';
import { ViewMode, SlotId } from '../types';
import { SIDEBAR_DEFAULT_WIDTH } from '../hooks/useSidebarLayout';
import { useTranslation } from 'react-i18next';
import { webdavClient } from '../services/webdavClient';
import { notify } from '../services/notificationService';
import { useOnlinePlaylists } from '../hooks/new-ui/useOnlinePlaylists';
import type { OnlineSource, PlaylistInfo } from '../services/onlineMusicProvider';
import {
  applyOverrides,
  loadOverrides,
  setOverride,
  type PlaylistOverride,
} from '../services/playlistOverrides';

interface LibraryTrackCounts {
  local: number;
  cloud: number;
  online: number;
}

interface SidebarProps {
  onNavigate: (mode: ViewMode) => void;
  currentView: ViewMode;
  onReloadFiles?: () => void;
  hasUnavailableTracks?: boolean;
  viewMode: ViewMode;
  activeSlotId: SlotId;
  onSlotChange: (slotId: SlotId) => void;
  libraryTrackCounts: LibraryTrackCounts;
  onOpenPlaylist?: (source: OnlineSource, playlistId: string, name: string, songCount: number) => Promise<void>;
  floating?: boolean;
  /** Expanded width in px. Ignored when collapsed. */
  width?: number;
  collapsed?: boolean;
  /** True while a drag-resize is active — suppresses the width transition. */
  isResizing?: boolean;
  onResizeStart?: (event: React.PointerEvent) => void;
}

const PLAYLIST_SOURCES: OnlineSource[] = ['qq', 'netease', 'soda'];

const Sidebar: React.FC<SidebarProps> = ({
  onNavigate,
  currentView,
  onReloadFiles,
  hasUnavailableTracks,
  viewMode: _viewMode,
  activeSlotId,
  onSlotChange,
  libraryTrackCounts,
  onOpenPlaylist,
}) => {
  const { t, i18n } = useTranslation();
  const { playlists: onlinePlaylists, loading: playlistsLoading } = useOnlinePlaylists();
  const [isPlaylistEditMode, setIsPlaylistEditMode] = useState(false);
  const [playlistOverrides, setPlaylistOverrides] = useState<Record<string, PlaylistOverride>>({});
  const [selectedPlaylistKey, setSelectedPlaylistKey] = useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void loadOverrides().then((overrides) => {
      if (!cancelled) setPlaylistOverrides({ ...overrides });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isLibraryView = currentView === ViewMode.PLAYER || currentView === ViewMode.LYRICS;
  const isSettingsView = currentView === ViewMode.SETTINGS;
  const isThemeView = currentView === ViewMode.THEME;
  const isLibrarySelectionActive = isLibraryView || isSettingsView || isThemeView;
  const handleSlotClick = useCallback((slotId: SlotId) => {
    if (slotId === 'cloud' && !webdavClient.hasConfig()) {
      notify(t('settingsDialog.webdavTitle'), t('settingsDialog.webdavFillAll'));
      onNavigate(ViewMode.SETTINGS);
      return;
    }
    if (!isLibraryView) onNavigate(ViewMode.PLAYER);
    onSlotChange(slotId);
  }, [isLibraryView, onNavigate, onSlotChange, t]);

  const libraryItems = useMemo(() => [
    {
      key: 'local',
      icon: 'hard_drive',
      label: t('sidebar.local'),
      meta: String(libraryTrackCounts.local),
      active: isLibrarySelectionActive && activeSlotId === 'local',
      onClick: () => handleSlotClick('local'),
    },
    {
      key: 'cloud',
      icon: 'cloud',
      label: t('sidebar.cloud'),
      meta: String(libraryTrackCounts.cloud),
      active: isLibrarySelectionActive && activeSlotId === 'cloud',
      onClick: () => handleSlotClick('cloud'),
    },
    {
      key: 'online',
      icon: 'history',
      label: t('sidebar.onlineQueue'),
      meta: String(libraryTrackCounts.online),
      active: isLibrarySelectionActive && activeSlotId === 'online',
      onClick: () => handleSlotClick('online'),
    },
  ], [activeSlotId, handleSlotClick, i18n.language, isLibrarySelectionActive, libraryTrackCounts, t]);

  const playlistsForDisplay = useMemo(() => {
    const { visible, all } = applyOverrides(onlinePlaylists, playlistOverrides);
    return isPlaylistEditMode ? all : visible;
  }, [isPlaylistEditMode, onlinePlaylists, playlistOverrides]);

  const playlistsBySource = useMemo(() => {
    const groups: Record<OnlineSource, PlaylistInfo[]> = {
      qq: [],
      netease: [],
      soda: [],
    };
    playlistsForDisplay.forEach((playlist) => groups[playlist.source].push(playlist));
    return groups;
  }, [playlistsForDisplay]);

  const sourceLabels = useMemo<Record<OnlineSource, string>>(() => ({
    qq: t('settingsDialog.onlineSourceQq'),
    netease: t('settingsDialog.onlineSourceNetease'),
    soda: t('settingsDialog.onlineSourceSoda'),
  }), [i18n.language, t]);

  const handlePlaylistClick = useCallback(async (playlist: PlaylistInfo) => {
    if (!onOpenPlaylist || isPlaylistEditMode) return;
    setSelectedPlaylistKey(`${playlist.source}:${playlist.id}`);
    try {
      await onOpenPlaylist(playlist.source, playlist.id, playlist.name, playlist.songCount);
    } catch {
      notify(t('playlists.title'), t('browse.error'));
    }
  }, [isPlaylistEditMode, onOpenPlaylist, t]);

  const handleTogglePlaylistVisibility = useCallback(async (playlist: PlaylistInfo) => {
    const key = `${playlist.source}:${playlist.id}`;
    const current = playlistOverrides[key];
    const next = await setOverride(playlist.source, playlist.id, {
      hidden: !current?.hidden,
    });
    setPlaylistOverrides({ ...next });
  }, [playlistOverrides]);

  const renderNavItem = (
    item: {
      key: string;
      icon: string;
      label: string;
      active: boolean;
      onClick: () => void;
      trailing?: string;
      meta?: string;
    },
    compact = false,
  ) => (
    <button
      key={item.key}
      type="button"
      onClick={item.onClick}
      className={`relative flex w-full items-center gap-3 text-left transition-colors ${compact ? 'min-h-10 px-3 py-2' : 'min-h-11 px-3 py-2.5'}`}
      style={{
        backgroundColor: item.active
          ? 'color-mix(in srgb, var(--theme-control-item-bg-active) 78%, transparent)'
          : 'transparent',
        color: item.active
          ? 'var(--theme-control-item-fg-active)'
          : 'var(--theme-control-action-fg)',
        borderRadius: 'var(--theme-control-radius)',
        textTransform: 'var(--theme-control-text-transform)' as React.CSSProperties['textTransform'],
        letterSpacing: 'var(--theme-button-letter-spacing)',
      }}
    >
      <span
        className="absolute left-1 top-2 bottom-2 w-1 transition-opacity"
        style={{
          backgroundColor: 'var(--theme-primary)',
          borderRadius: '999px',
          opacity: item.active ? 1 : 0,
        }}
      />
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center"
        style={{ color: item.active ? 'var(--theme-control-icon-fg-active)' : 'var(--theme-control-icon-fg)' }}
      >
        <span className={`material-symbols-outlined text-[21px] leading-none ${item.active ? 'fill-1' : ''}`}>
          {item.icon}
        </span>
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-none">{item.label}</span>
      {item.trailing && (
        <span className="material-symbols-outlined text-[18px]" style={{ color: 'var(--theme-text-muted)' }}>
          {item.trailing}
        </span>
      )}
      {item.meta && (
        <span className="shrink-0 text-xs font-medium" style={{ color: 'var(--theme-text-muted)' }}>
          {item.meta}
        </span>
      )}
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
      meta?: string;
    }>,
  ) => (
    <section className="space-y-1">
      <h2
        className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.24em]"
        style={{ color: 'var(--theme-text-muted)' }}
      >
        {title}
      </h2>
      <div className="flex flex-col gap-1">
        {items.map((item) => renderNavItem(item))}
      </div>
    </section>
  );

  const renderUtilityButton = (mode: ViewMode, icon: string, label: string) => (
    <button
      type="button"
      onClick={() => onNavigate(mode)}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
      style={{
        color: 'var(--theme-control-icon-fg)',
        backgroundColor: 'transparent',
      }}
      title={label}
      aria-label={label}
    >
      <span className="material-symbols-outlined text-[20px]">{icon}</span>
    </button>
  );

  const playlistItems = PLAYLIST_SOURCES.flatMap((source) => {
    const sourcePlaylists = playlistsBySource[source];
    if (sourcePlaylists.length === 0) return [];
    return [
      <div
        key={`${source}-heading`}
        className="px-4 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: 'var(--theme-text-muted)' }}
      >
        {sourceLabels[source]}
      </div>,
      ...sourcePlaylists.map((playlist) => {
        const playlistKey = `${playlist.source}:${playlist.id}`;
        const isHidden = Boolean(playlistOverrides[playlistKey]?.hidden);
        return (
          <div
            key={playlistKey}
            className="relative"
          >
            <button
              type="button"
              onClick={() => void handlePlaylistClick(playlist)}
              className={`relative flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-1.5 ${isPlaylistEditMode ? 'pr-10' : 'pr-3'} text-left transition-colors hover:bg-[color-mix(in_srgb,var(--theme-control-item-bg-hover)_70%,transparent)] ${isHidden ? 'opacity-45' : ''}`}
              style={{
                backgroundColor: selectedPlaylistKey === playlistKey && activeSlotId === 'playlist'
                  ? 'color-mix(in srgb, var(--theme-control-item-bg-active) 62%, transparent)'
                  : 'transparent',
                color: selectedPlaylistKey === playlistKey && activeSlotId === 'playlist'
                  ? 'var(--theme-control-item-fg-active)'
                  : 'var(--theme-control-action-fg)',
              }}
            >
              <span
                className="h-8 w-8 shrink-0 overflow-hidden rounded-md"
                style={{ backgroundColor: 'var(--theme-control-icon-bg)' }}
              >
                {playlist.coverUrl ? (
                  <img src={playlist.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="material-symbols-outlined flex h-full items-center justify-center text-[17px]" style={{ color: 'var(--theme-control-icon-fg)' }}>
                    queue_music
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{playlist.name}</span>
              <span className="shrink-0 text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>{playlist.songCount}</span>
              <span
                className="absolute left-1 top-2 bottom-2 w-1 rounded-full transition-opacity"
                style={{ backgroundColor: 'var(--theme-primary)', opacity: selectedPlaylistKey === playlistKey && activeSlotId === 'playlist' ? 1 : 0 }}
              />
            </button>
            {isPlaylistEditMode && (
              <button
                type="button"
                onClick={() => void handleTogglePlaylistVisibility(playlist)}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition-colors hover:bg-[color-mix(in_srgb,var(--theme-control-item-bg-hover)_80%,transparent)]"
                style={{ color: isHidden ? 'var(--theme-text-muted)' : 'var(--theme-control-icon-fg)' }}
                aria-label={isHidden ? '显示歌单' : '隐藏歌单'}
              >
                <span className="material-symbols-outlined text-[17px]">
                  {isHidden ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            )}
          </div>
        );
      }),
    ];
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {renderSection(t('sidebar.library'), libraryItems)}

        <section className="mt-5 flex min-h-0 flex-1 flex-col space-y-1">
          <div className="shrink-0">
            <div className="flex items-center justify-between px-3 py-1">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: 'var(--theme-text-muted)' }}>
                {t('sidebar.playlists')}
              </h2>
              <button
                type="button"
                onClick={() => setIsPlaylistEditMode((editing) => !editing)}
                className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[color-mix(in_srgb,var(--theme-control-item-bg-hover)_80%,transparent)]"
                style={{ color: isPlaylistEditMode ? 'var(--theme-control-icon-fg-active)' : 'var(--theme-control-icon-fg)' }}
                aria-label={isPlaylistEditMode ? '完成编辑' : '编辑歌单'}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {isPlaylistEditMode ? 'done' : 'edit'}
                </span>
              </button>
            </div>
          </div>
          <div className="sidebar-playlist-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1">
            {playlistsLoading && onlinePlaylists.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-3 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                <span>{t('browse.loading')}</span>
              </div>
            ) : playlistItems.length > 0 ? (
              playlistItems
            ) : null}
          </div>
        </section>

        {hasUnavailableTracks && onReloadFiles && (
          <button
            type="button"
            onClick={onReloadFiles}
            className="mt-5 flex w-full items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-[var(--theme-warning-10)]"
            style={{
              borderColor: 'var(--theme-warning-20)',
              borderWidth: 'var(--theme-control-border-width)',
              color: 'var(--theme-warning)',
            }}
            title="Reload unavailable tracks"
          >
            <span className="material-symbols-outlined text-[20px]">refresh</span>
            <span>{t('sidebar.reloadFiles')}</span>
          </button>
        )}
      </div>

      <div className="mt-5 flex shrink-0 items-center justify-start gap-2 border-t pt-3" style={{ borderColor: 'var(--theme-border-light)' }}>
        {renderUtilityButton(ViewMode.SETTINGS, 'settings', t('settings.title'))}
        {renderUtilityButton(ViewMode.THEME, 'checkroom', t('sidebar.theme'))}
      </div>
    </div>
  );
};

const MemoizedSidebar = memo(Sidebar);

const SidebarWrapper: React.FC<SidebarProps> = (props) => {
  const {
    floating,
    width = SIDEBAR_DEFAULT_WIDTH,
    collapsed = false,
    isResizing = false,
    onResizeStart,
    ...sidebarProps
  } = props;

  const widthTransition = isResizing ? 'none' : 'width 0.2s ease';

  const resizeHandle = !collapsed && onResizeStart ? (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onResizeStart}
      className="absolute right-0 z-30 cursor-col-resize"
      style={{ top: 40, bottom: 0, width: 8, touchAction: 'none' }}
    />
  ) : null;

  if (floating) {
    return (
      <div
        className="relative flex flex-col flex-shrink-0"
        style={{
          width: collapsed ? 0 : width,
          overflow: collapsed ? 'hidden' : 'visible',
          transition: widthTransition,
        }}
      >
        <aside
          className="flex-1 flex flex-col ml-2 mr-0 mb-2 mt-2 overflow-hidden"
          style={{
            backgroundColor: 'var(--theme-background-sidebar)',
            borderRadius: 'var(--theme-surface-radius)',
            border: 'var(--theme-panel-border-width) solid var(--theme-border-light)',
            filter: 'drop-shadow(0 6px 24px rgba(0, 0, 0, 0.45))',
          }}
        >
          <div className="h-[28px] flex-shrink-0" />
          <div className="flex min-h-0 flex-1 flex-col px-3 pb-4 pt-3">
            <nav className="flex min-h-0 flex-1 flex-col">
              <MemoizedSidebar {...sidebarProps} />
            </nav>
          </div>
        </aside>
        {resizeHandle}
      </div>
    );
  }

  return (
    <aside
      className="relative flex flex-col backdrop-blur-md z-20 pt-8"
      style={{
        width: collapsed ? 0 : width,
        overflow: collapsed ? 'hidden' : 'visible',
        transition: widthTransition,
        backgroundColor: 'var(--theme-background-sidebar)',
        borderRight: collapsed ? 'none' : 'var(--theme-panel-border-width) solid var(--theme-border-light)',
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-4 pt-3">
        <nav className="flex min-h-0 flex-1 flex-col">
          <MemoizedSidebar {...sidebarProps} />
        </nav>
      </div>
      {resizeHandle}
    </aside>
  );
};

export default SidebarWrapper;
