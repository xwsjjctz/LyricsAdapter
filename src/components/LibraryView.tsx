import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo } from 'react';
import { Track, SlotId } from '../types';
import { logger } from '../services/logger';
import { getDesktopAPI } from '../services/desktopAdapter';
import { useTranslation } from 'react-i18next';
import { themeManager } from '../services/themeManager';
import { toCoverThumb } from '../services/coverUrl';
import { ThemeConfig } from '../types/theme';
import { resolveThemeAppearance } from '../services/themeAppearance';
import LibraryTrackRow from './LibraryTrackRow';
import LibraryToolbar from './LibraryToolbar';
import TrackMenu from './TrackMenu';
import type { TrackDownloadQuality } from './trackMenuItems';
import LibrarySelectionBar from './LibrarySelectionBar';
import MetadataEditorPopup from './MetadataEditorPopup';
import ConfirmDialog from './ConfirmDialog';
import { useLibraryTrackActions } from '../hooks/useLibraryTrackActions';
import { useLibraryFileDrop } from '../hooks/useLibraryFileDrop';
import { useLibraryVirtualScroll } from '../hooks/useLibraryVirtualScroll';
import { readableForeground } from '../services/colorUtils';
import LibraryOverlayScrollbar from './LibraryOverlayScrollbar';
import { FLOATING_PLAYER_BOTTOM_INSET } from './playerLayout';

interface LibraryViewProps {
  tracks: Track[];
  currentTrackIndex: number;
  currentTrackId?: string;
  onTrackSelect: (index: number) => void;
  onRemoveTrack: (trackId: string) => void | Promise<void>;
  onRemoveMultipleTracks?: (trackIds: string[]) => void | Promise<void>;
  onImportClick?: () => void;
  importDisabled?: boolean;
  onOpenSettings?: () => void;
  onDropFiles?: (files: File[]) => void;
  onDropFilePaths?: (filePaths: { path: string; name: string }[]) => void;
  onReorderTracks?: (fromIndex: number, toIndex: number) => void;
  onUpdateTrack?: (track: Track) => void;
  /** Download an online-provider track to the local library. */
  onDownloadTrack?: (track: Track, quality: TrackDownloadQuality) => void;
  isFocusMode?: boolean;
  savedScrollPosition?: number;
  onScrollPositionChange?: (position: number) => void;
  autoLocateToken?: number;
  /** Pending palette "locate now playing" request, acknowledged once handled. */
  locateRequest?: number | null | undefined;
  onLocateRequestHandled?: ((token: number) => void) | undefined;
  importProgress?: { loaded: number; total: number } | null;
  dataSource: SlotId;
  activeSlotId: SlotId;
  onSwitchSlot: (slotId: SlotId, options?: { locateCurrentTrack?: boolean }) => Promise<void>;
  filterType: 'default' | 'album' | 'artist';
  categorySelection: string | null;
  onCategoryChange: (selection: string | null) => void;
  /** Cloud sync is owned by the shell; the list shows its progress and can refresh it. */
  cloudLoadProgress?: { loaded: number; total: number } | null | undefined;
  onRefreshCloud?: (() => Promise<void>) | undefined;
  onLoadMorePlaylist?: () => void | Promise<void>;
  playlistLoading?: boolean;
  playlistHasMore?: boolean;
  playlistLoadError?: string | null;
  playlistTitle?: string;
  playlistTrackCount?: number;
  pendingLocateSlot?: SlotId | undefined;
  pendingLocateToken?: number | undefined;
  onPendingLocatePrepared?: (token: number) => void;
  onSlotContentReady?: (slot: SlotId) => void;
  searchBox?: React.ReactNode;
  onPlayAll?: () => void;
  onShuffleAll?: () => void;
}


/** Placeholder rows while a playlist's first page loads. */
const PLAYLIST_SKELETON_ROWS = 8;

interface LibraryEmptyState {
  icon: string;
  title: string;
  description: string;
  primaryLabel: string;
  primaryIcon: string;
  onPrimary?: (() => void) | undefined;
  secondaryLabel?: string | undefined;
  secondaryIcon?: string | undefined;
  onSecondary?: (() => void) | undefined;
}

const LibraryView: React.FC<LibraryViewProps> = memo(({
  tracks,
  currentTrackIndex,
  currentTrackId,
  onTrackSelect,
  onRemoveTrack,
  onRemoveMultipleTracks,
  onImportClick,
  importDisabled = false,
  onOpenSettings,
  onDropFiles,
  onDropFilePaths,
  onReorderTracks,
  onUpdateTrack,
  onDownloadTrack,
  isFocusMode = false,
  savedScrollPosition = 0,
  onScrollPositionChange,
  autoLocateToken = 0,
  locateRequest,
  onLocateRequestHandled,
  importProgress,
  dataSource,
  activeSlotId,
  onSwitchSlot,
  filterType,
  categorySelection,
  onCategoryChange,
  cloudLoadProgress: loadProgress,
  onRefreshCloud: refreshCloudTracks,
  onLoadMorePlaylist,
  playlistLoading = false,
  playlistHasMore = false,
  playlistLoadError = null,
  playlistTitle,
  playlistTrackCount,
  pendingLocateSlot,
  pendingLocateToken,
  onPendingLocatePrepared,
  onSlotContentReady,
  searchBox,
  onPlayAll,
  onShuffleAll,
}) => {
  const { t } = useTranslation();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null); // Track being reordered
  const [insertPosition, setInsertPosition] = useState<{ index: number; position: 'before' | 'after' } | null>(null); // Where to insert the dragged item
  const [highlightStyle, setHighlightStyle] = useState<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 0,
    opacity: 0
  });
  const [isHighlightTransitionSuppressed, setIsHighlightTransitionSuppressed] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefreshCloud = useCallback(async () => {
    if (!refreshCloudTracks || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshCloudTracks();
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshCloudTracks, isRefreshing]);

  const displayTracks = tracks;
  // 预计算 id→index 映射，避免在行渲染的 map 内每行调用 displayTracks.findIndex，
  // 把整体渲染从 O(n²) 降到 O(n)。tracks 变化时重建。
  const displayIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < displayTracks.length; i++) {
      map.set(displayTracks[i]!.id, i);
    }
    return map;
  }, [displayTracks]);
  const [showLocateButton, setShowLocateButton] = useState(false);

  const selectedArtist = filterType === 'artist' ? categorySelection : null;
  const selectedAlbum = filterType === 'album' ? categorySelection : null;

  // Subscribe to theme changes
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  const filteredTracks = displayTracks;

  const uniqueArtists = useMemo(() => {
    const artistMap = new Map<string, { name: string; coverUrl?: string }>();
    displayTracks.forEach(track => {
      const artists = track.artist.split(/[/&、]/).map(a => a.trim()).filter(a => a);
      artists.forEach(artist => {
        if (!artistMap.has(artist)) {
          artistMap.set(artist, {
            name: artist,
            ...(track.coverUrl != null && { coverUrl: track.coverUrl })
          });
        }
      });
    });
    return Array.from(artistMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [displayTracks]);

  const uniqueAlbums = useMemo(() => {
    const albumMap = new Map<string, { name: string; artist: string; coverUrl?: string }>();
    displayTracks.forEach(track => {
      if (!albumMap.has(track.album)) {
        albumMap.set(track.album, {
          name: track.album,
          artist: track.artist,
          ...(track.coverUrl != null && { coverUrl: track.coverUrl })
        });
      }
    });
    return Array.from(albumMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [displayTracks]);

  // Filter tracks based on selected category
  const categoryFilteredTracks = useMemo(() => {
    if (filterType === 'default') return filteredTracks;
    if (filterType === 'artist' && selectedArtist) {
      return filteredTracks.filter(track => {
        const artists = track.artist.split(/[/&、]/).map(a => a.trim()).filter(a => a);
        return artists.includes(selectedArtist);
      });
    }
    if (filterType === 'album' && selectedAlbum) {
      return filteredTracks.filter(track => track.album === selectedAlbum);
    }
    return [];
  }, [filteredTracks, filterType, selectedArtist, selectedAlbum]);

  // Check if tracks actually changed (by comparing IDs)
  // Ref for the scrollable container
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousTrackIndexRef = useRef<number>(-1);
  const lastHandledAutoLocateTokenRef = useRef<number>(autoLocateToken);
  const highlightUpdateIdRef = useRef(0);
  // A cross-slot locate prepares the target scroll position before its entrance.
  const skipNextScrollRestoreRef = useRef(false);
  // 实时记录 scrollTop，cleanup 时读此 ref 而非 DOM（避免 DOM 切换后 scrollTop 被 clamp）
  const lastScrollTopRef = useRef(0);

  // Theme colors
  const colors = currentTheme.colors;
  const localImportForeground = readableForeground(colors.primary);
  // 当前播放指示器形态：'inline' 时不渲染浮动跟随滑块，改用行内实色高亮，
  // 彻底规避浮动定位错位，且滚动时无跟随动画。
  const playingIndicator = resolveThemeAppearance(currentTheme).playingIndicator;
  // inline 模式（粗粝类主题）下，浮动定位按钮也走粗粝风：实色底 + 黑色直角边框 + 硬阴影。
  const inlineFab = playingIndicator === 'inline';

  // Determine which tracks to use for calculations
  const activeTracks = filterType === 'default' ? filteredTracks : categoryFilteredTracks;

  const trackActions = useLibraryTrackActions({
    tracks: displayTracks,
    listedTracks: activeTracks,
    dataSource,
    filterType,
    categorySelection,
    onRemoveTrack,
    onRemoveMultipleTracks,
    onUpdateTrack,
    onDownloadTrack,
  });
  const {
    isSelecting, selectedIds, toggleSelectAll, toggleSelectOne, finishSelection,
    trackMenu, menuTrack, menuItemsFor, openTrackMenu, closeTrackMenu, handleTrackMenuAction,
  } = trackActions;

  const emptyState = useMemo<LibraryEmptyState>(() => {
    if (dataSource === 'cloud') {
      return {
        icon: 'cloud_off',
        title: t('library.noCloudTracks'),
        description: t('library.cloudEmptyHint'),
        primaryLabel: t('library.refresh'),
        primaryIcon: 'refresh',
        onPrimary: handleRefreshCloud,
        secondaryLabel: t('browse.openSettings'),
        secondaryIcon: 'settings',
        onSecondary: onOpenSettings,
      };
    }
    if (dataSource === 'online') {
      return {
        icon: 'history',
        title: t('library.noOnlineTracks'),
        description: t('library.onlineQueueEmptyHint'),
        primaryLabel: '',
        primaryIcon: '',
      };
    }
    return {
      icon: 'library_music',
      title: t('library.noTracksImported'),
      description: t('library.importTracksHint'),
      primaryLabel: t('sidebar.importFiles'),
      primaryIcon: 'add',
      onPrimary: onImportClick,
    };
  }, [dataSource, handleRefreshCloud, onImportClick, onOpenSettings]);

  // The header no longer overlays the track list, so no top inset is needed.
  // bottomInset still lets the final rows clear the optional glass ControlBar.
  const topInset = 0;
  const bottomInset = ['darwin', 'win32'].includes(getDesktopAPI()?.platform ?? '')
    ? FLOATING_PLAYER_BOTTOM_INSET : 0;

  const {
    baseRowHeight,
    rowStride,
    totalHeight,
    startIndex,
    endIndex,
    paddingTop,
    paddingBottom,
    rowMeasureRef,
  } = useLibraryVirtualScroll({
    itemCount: activeTracks.length,
    scrollTop,
    scrollContainerRef,
    listRef,
    isEditMode: isSelecting,
    topInset,
  });

  const shouldVirtualize = endIndex > startIndex || startIndex > 0;
  const visibleTracks = shouldVirtualize ? activeTracks.slice(startIndex, endIndex) : activeTracks;

  // Absolute content-y of a row. Keep the inset term shared with the virtual-scroll
  // math even though the in-flow library header currently makes it zero.
  const rowTop = (idx: number) => idx * rowStride + topInset;
  // Max scrollTop: list height (rows + top inset) plus bottom inset, minus viewport.
  const maxScrollTop = (clientHeight: number) =>
    Math.max(0, totalHeight + topInset + bottomInset - clientHeight);

  // Animation is disabled for better performance
  const shouldShowAnimation = false;

  // Track whether we've already auto-located to the playing track
  const hasAutoLocatedToTrackRef = useRef(false);

  // Handle scroll position restoration and scroll to playing track on first load
  useEffect(() => {
    // 已经定位过，或没有有效曲目时跳过
    if (hasAutoLocatedToTrackRef.current || pendingLocateSlot === dataSource) return;
    if (currentTrackIndex < 0 || tracks.length === 0) return;

    // 首次定位：等待 row height 计算完毕
    const timer = setTimeout(() => {
      if (!scrollContainerRef.current) return;

      const container = scrollContainerRef.current;
      const itemTop = rowTop(currentTrackIndex);
      const itemBottom = itemTop + baseRowHeight;
      const targetTop = itemBottom - container.clientHeight / 2; // Center the track
      const maxTop = maxScrollTop(container.clientHeight);
      const clampedTop = Math.max(0, Math.min(targetTop, maxTop));

      container.scrollTop = clampedTop;
      setScrollTop(clampedTop);
      hasAutoLocatedToTrackRef.current = true;
      logger.debug(`[LibraryView] Auto-located to playing track ${currentTrackIndex + 1} at position ${clampedTop}`);
    }, 50);

    return () => clearTimeout(timer);
  }, [currentTrackIndex, tracks.length, rowStride, baseRowHeight, totalHeight, topInset, pendingLocateSlot, dataSource]);

  // Restore scroll position when switching between local/cloud
  useEffect(() => {
    if (!scrollContainerRef.current) return;
    if (skipNextScrollRestoreRef.current) {
      skipNextScrollRestoreRef.current = false;
      return;
    }
    scrollContainerRef.current.scrollTop = savedScrollPosition;
    setScrollTop(savedScrollPosition);
  }, [dataSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save scroll position on unmount
  useEffect(() => {
    return () => {
      // 用 ref 中记录的值而非 DOM scrollTop —— 此时 DOM 可能已切到新列表导致 scrollTop 被 clamp
      const finalScrollPosition = lastScrollTopRef.current;
      onScrollPositionChange?.(finalScrollPosition);
      logger.debug(`[LibraryView] Saved scroll position on unmount: ${finalScrollPosition} (${dataSource})`);
    };
  }, [onScrollPositionChange, dataSource]);

  // Get the index of current track in filtered list
  const currentTrackInFilteredIndex = useMemo(() => {
    if (!currentTrackId) return -1;
    const targetTracks = filterType === 'default' ? filteredTracks : categoryFilteredTracks;
    return targetTracks.findIndex(t => t.id === currentTrackId);
  }, [currentTrackId, filteredTracks, categoryFilteredTracks, filterType]);

  // Get the index of current track in the full displayTracks list
  const currentTrackInDisplayIndex = useMemo(() => {
    if (!currentTrackId) return -1;
    return displayTracks.findIndex(t => t.id === currentTrackId);
  }, [currentTrackId, displayTracks]);

  // When locating across slots, prepare the target list while its wrapper is
  // invisible. This deliberately happens before the GSAP entrance begins.
  useLayoutEffect(() => {
    if (pendingLocateSlot !== dataSource || pendingLocateToken == null) {
      // A completed or cancelled cross-slot preparation must never leave the
      // normal track-switch slider without its transition class.
      setIsHighlightTransitionSuppressed(false);
      onSlotContentReady?.(dataSource);
      return;
    }

    // The following normal effect must not restore the saved scroll position.
    skipNextScrollRestoreRef.current = true;
    setIsHighlightTransitionSuppressed(true);
    setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
    let restoreTransitionFrame: number | undefined;
    let enterFrame: number | undefined;
    const frame = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (container && currentTrackInFilteredIndex >= 0) {
        const itemTop = rowTop(currentTrackInFilteredIndex);
        const itemBottom = itemTop + baseRowHeight;
        const targetTop = itemBottom - container.clientHeight / 2;
        const clampedTop = Math.max(0, Math.min(targetTop, maxScrollTop(container.clientHeight)));
        container.scrollTop = clampedTop;
        lastScrollTopRef.current = clampedTop;
        setScrollTop(clampedTop);
        hasAutoLocatedToTrackRef.current = true;
      }
      if (filterType === 'default' && currentTrackInDisplayIndex >= 0) {
        setHighlightStyle({
          top: rowTop(currentTrackInDisplayIndex),
          height: baseRowHeight,
          opacity: 1,
        });
      }
      // Keep the list wrapper hidden until React has committed the final
      // highlight position, then restore the regular track-switch transition
      // before starting the wrapper entrance. Clearing pending state earlier
      // would rerun this effect and cancel the restoration frame.
      restoreTransitionFrame = requestAnimationFrame(() => {
        setIsHighlightTransitionSuppressed(false);
        enterFrame = requestAnimationFrame(() => {
          onPendingLocatePrepared?.(pendingLocateToken);
          onSlotContentReady?.(dataSource);
        });
      });
    });

    return () => {
      cancelAnimationFrame(frame);
      if (restoreTransitionFrame !== undefined) cancelAnimationFrame(restoreTransitionFrame);
      if (enterFrame !== undefined) cancelAnimationFrame(enterFrame);
    };
  }, [dataSource, pendingLocateSlot, pendingLocateToken, currentTrackInFilteredIndex, currentTrackInDisplayIndex, filterType, rowStride, baseRowHeight, totalHeight, onPendingLocatePrepared, onSlotContentReady]);

  // Auto-locate only when a track-switch action occurs.
  useEffect(() => {
    if (lastHandledAutoLocateTokenRef.current === autoLocateToken) {
      return;
    }
    lastHandledAutoLocateTokenRef.current = autoLocateToken;

    if (currentTrackInFilteredIndex < 0 || !scrollContainerRef.current) {
      return;
    }

    const container = scrollContainerRef.current;
    const timer = setTimeout(() => {
      // The optional ControlBar inset keeps located rows clear of the bottom overlay.
      const viewTop = container.scrollTop + topInset;
      const viewBottom = container.scrollTop + container.clientHeight - bottomInset;
      const itemTop = rowTop(currentTrackInFilteredIndex);
      const itemBottom = itemTop + baseRowHeight;

      if (itemTop >= viewTop && itemBottom <= viewBottom) {
        logger.debug(`[LibraryView] Track ${currentTrackInFilteredIndex + 1} is already visible, no auto-locate needed`);
        previousTrackIndexRef.current = currentTrackInFilteredIndex;
        setShowLocateButton(false);
        return;
      }

      const isNext = previousTrackIndexRef.current < 0 || currentTrackInFilteredIndex > previousTrackIndexRef.current;
      let targetTop: number;

      if (isFocusMode) {
        targetTop = itemTop < viewTop ? itemTop - topInset : itemBottom - (container.clientHeight - bottomInset);
      } else {
        targetTop = isNext ? itemBottom - (container.clientHeight - bottomInset) : itemTop - topInset;
      }

      const maxTop = maxScrollTop(container.clientHeight);
      const clampedTop = Math.max(0, Math.min(targetTop, maxTop));

      logger.debug(`[LibraryView] Auto-locating to track ${currentTrackInFilteredIndex + 1}`);
      container.scrollTo({ top: clampedTop, behavior: 'smooth' });
      previousTrackIndexRef.current = currentTrackInFilteredIndex;
      setShowLocateButton(false);
    }, 0);

    return () => clearTimeout(timer);
  }, [autoLocateToken, currentTrackInFilteredIndex, rowStride, baseRowHeight, totalHeight, isFocusMode, topInset, bottomInset]);

  // 高亮覆盖层（"滑块"）的位置与可见性。
  // default 模式用纯计算 index*rowStride 定位，绝不查询 DOM：当前播放行被虚拟滚动
  // 卸载时高亮也不会丢失，滚动时 scrollTop 变化触发重渲染、transform 自动跟随。
  // （此前用 querySelector 取行元素，行被卸载后返回 null 会把 opacity 置 0，且 effect
  // 依赖不含 scrollTop，滚回该行后无法恢复，表现为"滑块消失"。）
  // category（专辑/艺术家）模式列表不按全局索引布局，保留 DOM 查找 + 重试。
  useEffect(() => {
    if (isSelecting || !currentTrackId || displayTracks.length === 0) {
      setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
      return;
    }

    if (filterType === 'default') {
      if (currentTrackInDisplayIndex < 0) {
        setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
        return;
      }
      setHighlightStyle({
        top: rowTop(currentTrackInDisplayIndex),
        height: baseRowHeight,
        opacity: 1,
      });
      return;
    }

    // category 模式：等 DOM 渲染后查找当前行（带 updateId 防竞态、带重试）
    const currentUpdateId = ++highlightUpdateIdRef.current;

    const updateHighlight = (retryCount = 0) => {
      if (currentUpdateId !== highlightUpdateIdRef.current) {
        return;
      }

      let currentTrackElement: HTMLElement | null = null;
      const isCurrentInCategory = categoryFilteredTracks.some(t => t.id === currentTrackId);
      if (isCurrentInCategory && scrollContainerRef.current) {
        currentTrackElement = scrollContainerRef.current.querySelector(
          `[data-track-index="${currentTrackInDisplayIndex}"]`
        ) as HTMLElement | null;
      }

      if (currentUpdateId !== highlightUpdateIdRef.current) {
        return;
      }

      if (currentTrackElement) {
        setHighlightStyle({
          top: currentTrackElement.offsetTop,
          height: currentTrackElement.offsetHeight,
          opacity: 1,
        });
        return;
      }

      if (retryCount < 30) {
        const nextRetry = retryCount + 1;
        const delay = 50 * nextRetry;
        setTimeout(() => {
          requestAnimationFrame(() => updateHighlight(nextRetry));
        }, delay);
      } else {
        setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
      }
    };

    const timer = setTimeout(() => {
      requestAnimationFrame(() => updateHighlight(0));
    }, 150);

    return () => clearTimeout(timer);
  }, [currentTrackId, currentTrackInDisplayIndex, displayTracks.length, isSelecting, filterType, categoryFilteredTracks, rowStride, baseRowHeight, topInset]);

  // 切到非 default 视图时立即隐藏高亮（category 列表布局不同，避免错位闪烁）
  useEffect(() => {
    if (filterType !== 'default') {
      logger.debug(`[LibraryView] Filter type changed to ${filterType}, hiding highlight temporarily`);
      setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
    }
  }, [filterType]);

  // Check if current track is visible in viewport
  // Account for the overlaid ControlBar: a track underneath it must count as
  // "not visible" so the locate button stays on screen.
  const isCurrentTrackVisible = useCallback(() => {
    if (currentTrackInFilteredIndex < 0 || !scrollContainerRef.current) return false;
    const container = scrollContainerRef.current;
    const itemTop = rowTop(currentTrackInFilteredIndex);
    const itemBottom = itemTop + baseRowHeight;
    const viewportTop = scrollTop + topInset;
    const viewportBottom = scrollTop + container.clientHeight - bottomInset;
    return itemBottom >= viewportTop && itemTop <= viewportBottom;
  }, [currentTrackInFilteredIndex, rowStride, baseRowHeight, scrollTop, topInset, bottomInset]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = e.currentTarget.scrollTop;
    lastScrollTopRef.current = newScrollTop;
    setScrollTop(newScrollTop);
    // Notify parent of scroll position change
    onScrollPositionChange?.(newScrollTop);

    if (dataSource === 'playlist' && filterType === 'default' && onLoadMorePlaylist && playlistHasMore && !playlistLoading) {
      const distanceToBottom = e.currentTarget.scrollHeight - newScrollTop - e.currentTarget.clientHeight;
      if (distanceToBottom < 240) void onLoadMorePlaylist();
    }

    // Check if current playing track is visible (only if it's in filtered results)
    const targetTracks = filterType === 'default' ? filteredTracks : categoryFilteredTracks;
    if (currentTrackInFilteredIndex >= 0 && targetTracks.length > 0) {
      const container = scrollContainerRef.current;
      if (container) {
        const itemTop = rowTop(currentTrackInFilteredIndex);
        const itemBottom = itemTop + baseRowHeight;
        // A track covered by the optional ControlBar is treated as out of view.
        const viewportTop = newScrollTop + topInset;
        const viewportBottom = newScrollTop + container.clientHeight - bottomInset;

        // Show locate button if current track is out of viewport
        const isVisible = itemBottom >= viewportTop && itemTop <= viewportBottom;
        setShowLocateButton(!isVisible);
      }
    } else if (dataSource !== activeSlotId && currentTrackId) {
      // Cross-slot: keep locate button visible regardless of scroll
      setShowLocateButton(true);
    } else {
      setShowLocateButton(false);
    }
  }, [onScrollPositionChange, onLoadMorePlaylist, playlistHasMore, playlistLoading, currentTrackInFilteredIndex, filteredTracks.length, categoryFilteredTracks.length, rowStride, baseRowHeight, filterType, dataSource, activeSlotId, currentTrackId, topInset, bottomInset]);

  const handleScrollToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.scrollTo({
      top: 0,
      behavior: 'smooth',
    });

    const targetTracks = filterType === 'default' ? filteredTracks : categoryFilteredTracks;
    if (currentTrackInFilteredIndex >= 0 && targetTracks.length > 0) {
      const itemTop = rowTop(currentTrackInFilteredIndex);
      const itemBottom = itemTop + baseRowHeight;
      const viewportTop = topInset;
      const viewportBottom = container.clientHeight - bottomInset;
      const isVisible = itemBottom >= viewportTop && itemTop <= viewportBottom;
      setShowLocateButton(!isVisible);
    } else if (dataSource !== activeSlotId && currentTrackId) {
      setShowLocateButton(true);
    } else {
      setShowLocateButton(false);
    }
  }, [onScrollPositionChange, currentTrackInFilteredIndex, filteredTracks.length, categoryFilteredTracks.length, rowStride, baseRowHeight, filterType, dataSource, activeSlotId, currentTrackId, topInset, bottomInset]);

  const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useLibraryFileDrop({
    importDisabled,
    onDropFiles,
    onDropFilePaths,
  });

  const canManage = dataSource === 'local' || dataSource === 'online';
  const canReorder = canManage && filterType === 'default' && !!onReorderTracks && !isSelecting;

  const reorderSource = useRef<number | null>(null);
  const handleTrackDragStart = useCallback((e: React.DragEvent, index: number) => {
    if (!canReorder) { e.preventDefault(); return; }
    closeTrackMenu();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', displayTracks[index]?.id ?? '');
    reorderSource.current = index;
    setDraggedIndex(index);
  }, [canReorder, closeTrackMenu, displayTracks]);
  const handleTrackDragOver = useCallback((e: React.DragEvent, index: number) => {
    if (reorderSource.current === null) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    setInsertPosition(reorderSource.current === index ? null : {
      index, position: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
    });
  }, []);
  const handleTrackDragEnd = useCallback(() => {
    reorderSource.current = null;
    setDraggedIndex(null);
    setInsertPosition(null);
  }, []);
  const handleTrackDrop = useCallback((e: React.DragEvent, index: number) => {
    const from = reorderSource.current;
    if (from === null) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const target = index + (e.clientY >= rect.top + rect.height / 2 ? 1 : 0);
    handleTrackDragEnd();
    if (canReorder && from !== index) onReorderTracks?.(from, target);
  }, [canReorder, onReorderTracks, handleTrackDragEnd]);
  useEffect(() => { handleTrackDragEnd(); }, [dataSource, filterType, categorySelection, isSelecting, handleTrackDragEnd]);

  // Handle locate to current playing track
  const handleLocateToCurrentTrack = useCallback(async () => {
    if (dataSource !== activeSlotId) {
      // Cross-slot: switch view to the playing slot and trigger auto-locate
      await onSwitchSlot(activeSlotId, { locateCurrentTrack: true });
      return;
    }
    // Same slot: scroll to current track
    if (currentTrackInFilteredIndex < 0 || !scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const itemTop = rowTop(currentTrackInFilteredIndex);
    const itemBottom = itemTop + baseRowHeight;
    const targetTop = itemBottom - container.clientHeight / 2; // Center the track
    const maxTop = maxScrollTop(container.clientHeight);
    const clampedTop = Math.max(0, Math.min(targetTop, maxTop));

    container.scrollTo({
      top: clampedTop,
      behavior: 'smooth'
    });
    setShowLocateButton(false);
    logger.debug(`[LibraryView] Located to current track ${currentTrackIndex + 1} (filtered index: ${currentTrackInFilteredIndex})`);
  }, [dataSource, activeSlotId, onSwitchSlot, currentTrackInFilteredIndex, currentTrackIndex, rowStride, baseRowHeight, totalHeight, topInset]);

  // The palette's "locate now playing" runs the same action as the locate button.
  useEffect(() => {
    if (locateRequest == null) return;
    void handleLocateToCurrentTrack();
    onLocateRequestHandled?.(locateRequest);
  }, [handleLocateToCurrentTrack, locateRequest, onLocateRequestHandled]);

  // Hide locate button when current track becomes visible (e.g., after clicking a new track to play)
  useEffect(() => {
    if (showLocateButton && isCurrentTrackVisible()) {
      setShowLocateButton(false);
    }
  }, [currentTrackId, showLocateButton, isCurrentTrackVisible]);

  return (
    <div
      className="library-view w-full flex flex-col h-full relative transition-all duration-300"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toolbar and column labels stay in flow above the scrolling rows. */}
      <div className="flex-shrink-0">
      <LibraryToolbar
        dataSource={dataSource}
        colors={colors}
        {...(dataSource === 'local' || dataSource === 'cloud' ? { onImportClick, importDisabled } : {})}
        {...(dataSource === 'cloud' ? { onRefreshCloud: handleRefreshCloud, isRefreshing } : {})}
        trackCount={filteredTracks.length}
        {...(playlistTitle ? { playlistTitle } : {})}
        {...(playlistTrackCount != null ? { playlistTrackCount } : {})}
        importProgress={importProgress}
        loadProgress={dataSource === 'cloud' ? loadProgress ?? undefined : undefined}
        searchBox={searchBox}
        onPlayAll={onPlayAll}
        onShuffleAll={onShuffleAll}
      />

      {isSelecting && <LibrarySelectionBar count={selectedIds.size} total={activeTracks.length} colors={colors}
        onToggleAll={toggleSelectAll} onRemove={trackActions.requestBatchDelete} onDone={finishSelection} />}

      {filterType === 'default' && (
        <div className="flex-shrink-0">
          <div
            className="library-track-grid grid gap-4 px-4 py-2 mb-2 text-xs font-bold uppercase tracking-widest border-b select-none"
            style={{ color: colors.textMuted, borderColor: colors.borderLight }}
            onDoubleClick={handleScrollToTop}
          >
            <span>{t('library.titleCol')}</span><span className="library-track-album pl-8">{t('library.albumCol')}</span>
            <span className="text-right">{t('library.timeCol')}</span>
          </div>
        </div>
      )}
      </div>

      {/* 可滚动的歌曲列表 */}
      {filterType === 'default' ? (
        <div
          className="library-track-scroll-shell library-bleed flex-1 relative min-h-0 overflow-hidden"
        >
          {/* 拖放覆盖层 - 拖放时仅覆盖列表区域 */}
          {isDragging && (
            <div className="absolute inset-y-0 left-6 right-6 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm r-surface border-2 border-dashed border-primary pointer-events-none animate-pulse">
              <div className="text-center">
                <span className="material-symbols-rounded text-6xl text-primary mb-4">upload_file</span>
                <p className="text-2xl font-bold text-primary mb-2">{t('library.dropFiles')}</p>
                <p className="text-sm" style={{ color: colors.textMuted }}>{t('library.supportFormats')}</p>
              </div>
            </div>
          )}
          {/* Sliding highlight overlay (outside scroll clipping) */}
          <div className="absolute inset-0 pointer-events-none">
            {playingIndicator === 'floating' && highlightStyle.opacity > 0 && (
              <div
                className={`absolute pointer-events-none ${isHighlightTransitionSuppressed ? '' : 'transition-[transform,height] duration-150 ease-out'}`}
                style={{
                  transform: `translateY(${highlightStyle.top - scrollTop}px)`,
                  height: `${highlightStyle.height}px`,
                  opacity: highlightStyle.opacity,
                  left: 'var(--library-bleed)',
                  right: 'var(--library-bleed)',
                  backgroundColor: 'color-mix(in srgb, var(--theme-control-current-track-band-tint) 15%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--theme-control-current-track-band-tint) 25%, transparent)',
                  boxShadow: 'var(--theme-elevated-shadow)',
                  borderRadius: 'var(--library-row-radius)',
                }}
              />
            )}
          </div>

          <div
            ref={scrollContainerRef}
            className="library-track-scroll no-scrollbar h-full min-h-0 overflow-y-auto"
            onScroll={handleScroll}
          >
            {filteredTracks.length > 0 ? (
              <div
                ref={listRef}
                className="grid relative"
                style={{ paddingTop, paddingBottom: paddingBottom + bottomInset, gap: 'var(--theme-list-item-gap)', paddingRight: playingIndicator === 'inline' ? 6 : undefined }}
              >
                {insertPosition !== null && (
                  <div
                    className="absolute left-0 right-0 h-0.5 rounded-full shadow-lg z-20 transition-all duration-150"
                    style={{
                      top: paddingTop + (insertPosition.position === 'before'
                        ? (insertPosition.index - startIndex)
                        : (insertPosition.index - startIndex + 1)) * rowStride,
                      opacity: insertPosition.index >= startIndex - 1 && insertPosition.index < endIndex ? 1 : 0,
                      backgroundColor: colors.primary,
                      boxShadow: `0 0 10px ${colors.primary}`, borderRadius: 'var(--theme-progress-radius)',
                    }}
                  />
                )}
                {visibleTracks.map((track, idx) => {
                  const filteredIndex = startIndex + idx;
                  const isCurrentTrack = track.id === currentTrackId;
                  const isDragged = draggedIndex === filteredIndex;
                  return (
                    <LibraryTrackRow
                      key={track.id}
                      track={track}
                      filteredIndex={filteredIndex}
                      isCurrentTrack={isCurrentTrack}
                      isSelecting={isSelecting}
                      isSelected={selectedIds.has(track.id)}
                      isDragged={isDragged}
                      shouldShowAnimation={shouldShowAnimation}
                      colors={colors}
                      playingIndicator={playingIndicator}
                      measureRef={idx === 0 ? rowMeasureRef : undefined}
                      realTrackIndex={displayIndexMap.get(track.id) ?? -1}
                      onTrackSelect={onTrackSelect}
                      onToggleSelect={toggleSelectOne}
                      hasMenu={menuItemsFor(track).length > 0}
                      canReorder={canReorder}
                      onOpenMenu={openTrackMenu}
                      onDrop={handleTrackDrop}
                      onDragStart={handleTrackDragStart}
                      onDragOver={handleTrackDragOver}
                      onDragEnd={handleTrackDragEnd}
                    />
                  );
                })}
              </div>
            ) : dataSource === 'playlist' && playlistLoading ? (
              <div className="grid" aria-busy="true" aria-label={t('common.loading')}
                style={{ gap: 'var(--theme-list-item-gap)', paddingBottom: bottomInset }}>
                {Array.from({ length: PLAYLIST_SKELETON_ROWS }, (_, index) => (
                  <div key={index} className="library-skeleton-row px-4" aria-hidden="true">
                    <span className="library-skeleton-row__cover" style={{ backgroundColor: colors.backgroundCard }} />
                    <span className="library-skeleton-row__lines">
                      <span style={{ backgroundColor: colors.backgroundCard, width: `${40 + (index * 17) % 35}%` }} />
                      <span style={{ backgroundColor: colors.backgroundCard, width: `${20 + (index * 11) % 20}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-16 text-center r-surface" style={{ color: colors.textMuted, border: `2px dashed ${colors.borderLight}` }}>
                <span className="material-symbols-rounded text-6xl mb-4 block opacity-50">{emptyState.icon}</span>
                <p className="text-xl font-medium" style={{ color: colors.textSecondary }}>{emptyState.title}</p>
                <p className="text-sm mt-1">{emptyState.description}</p>
                <div className="mt-6 flex items-center justify-center gap-3">
                  {emptyState.onPrimary && (
                    <button
                      onClick={emptyState.onPrimary}
                      disabled={dataSource === 'local' && importDisabled}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-all"
                      style={{
                        backgroundColor: dataSource === 'local' && importDisabled ? colors.backgroundCard : colors.primary,
                        color: dataSource === 'local' && importDisabled
                          ? colors.textMuted
                          : dataSource === 'local'
                            ? localImportForeground
                            : '#fff',
                        borderRadius: 'var(--theme-control-radius)',
                        border: 'var(--theme-control-border-width) solid var(--theme-control-container-border)',
                        cursor: dataSource === 'local' && importDisabled ? 'not-allowed' : 'pointer',
                        opacity: dataSource === 'local' && importDisabled ? 0.55 : 1,
                      }}
                    >
                      <span className="material-symbols-rounded text-lg">{emptyState.primaryIcon}</span>
                      <span>{emptyState.primaryLabel}</span>
                    </button>
                  )}
                  {emptyState.onSecondary && (
                    <button
                      onClick={emptyState.onSecondary}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-all"
                      style={{
                        backgroundColor: colors.backgroundCard,
                        color: colors.textSecondary,
                        borderRadius: 'var(--theme-control-radius)',
                        border: 'var(--theme-control-border-width) solid var(--theme-control-container-border)',
                      }}
                    >
                      <span className="material-symbols-rounded text-lg">{emptyState.secondaryIcon}</span>
                      <span>{emptyState.secondaryLabel}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          <LibraryOverlayScrollbar
            scrollRef={scrollContainerRef}
            contentHeight={totalHeight + bottomInset}
            bottomInset={bottomInset}
          />
        </div>
      ) : (
        <div className="library-bleed flex-1 flex gap-4 overflow-hidden">
          {/* 左侧分类列表 */}
          <div
            className="w-64 flex-shrink-0 overflow-y-auto no-scrollbar"
            style={bottomInset ? { paddingBottom: bottomInset } : undefined}
          >
            <div className="text-xs font-bold uppercase tracking-widest mb-2 px-2" style={{ color: colors.textMuted }}>
              {t(filterType === 'artist' ? 'library.artistList' : 'library.albumList')}
            </div>
            <div className="flex flex-col gap-1">
              {filterType === 'artist' ? (
                uniqueArtists.map((artist) => (
                  <button
                    key={artist.name}
                    onClick={() => onCategoryChange(artist.name)}
                    className="library-category-row flex items-center gap-3 px-3 py-2 r-control"
                    data-selected={selectedArtist === artist.name || undefined}
                  >
                    {artist.coverUrl && (
                      <img
                        src={toCoverThumb(artist.coverUrl, 128)}
                        alt=""
                        className="w-10 h-10 r-media-sm object-cover"
                        loading="lazy"
                        decoding="async"
                        width={40}
                        height={40}
                      />
                    )}
                    <span className="text-sm truncate">{artist.name}</span>
                  </button>
                ))
              ) : (
                uniqueAlbums.map((album) => (
                  <button
                    key={album.name}
                    onClick={() => onCategoryChange(album.name)}
                    className="library-category-row flex items-center gap-3 px-3 py-2 r-control"
                    data-selected={selectedAlbum === album.name || undefined}
                  >
                    {album.coverUrl && (
                      <img
                        src={toCoverThumb(album.coverUrl, 128)}
                        alt=""
                        className="w-10 h-10 r-media-sm object-cover"
                        loading="lazy"
                        decoding="async"
                        width={40}
                        height={40}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{album.name}</p>
                      <p className="text-xs truncate" style={{ color: colors.textMuted }}>{album.artist}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

           {/* 右侧歌曲列表 */}
           <div className="library-track-pane flex-1 flex flex-col min-w-0 relative overflow-hidden">
             {/* 拖放覆盖层 - 拖放时仅覆盖列表区域 */}
             {isDragging && (
               <div className="absolute inset-y-0 left-6 right-6 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm r-surface border-2 border-dashed border-primary pointer-events-none animate-pulse">
                 <div className="text-center">
                   <span className="material-symbols-rounded text-6xl text-primary mb-4">upload_file</span>
                   <p className="text-2xl font-bold text-primary mb-2">{t('library.dropFiles')}</p>
                   <p className="text-sm" style={{ color: colors.textMuted }}>{t('library.supportFormats')}</p>
                 </div>
               </div>
             )}
             <div className="library-bleed flex-shrink-0">
               <div
                 className="library-track-grid grid gap-4 px-4 py-2 text-xs font-bold uppercase tracking-widest border-b mb-2 select-none"
                 style={{ color: colors.textMuted, borderColor: colors.borderLight }}
                 onDoubleClick={handleScrollToTop}
               >
                 <span>{t('library.titleCol')}</span><span className="library-track-album pl-8">{t('library.albumCol')}</span>
                <span className="text-right">{t('library.timeCol')}</span>
               </div>
             </div>
             <div className="library-track-scroll-shell library-bleed flex-1 relative min-h-0 overflow-hidden">
               {/* Sliding highlight overlay (outside scroll clipping) */}
               <div className="absolute inset-0 pointer-events-none">
                 {playingIndicator === 'floating' && highlightStyle.opacity > 0 && (
                   <div
                     className={`absolute pointer-events-none ${isHighlightTransitionSuppressed ? '' : 'transition-[transform,height] duration-150 ease-out'}`}
                     style={{
                       transform: `translateY(${highlightStyle.top - scrollTop}px)`,
                       height: `${highlightStyle.height}px`,
                       opacity: highlightStyle.opacity,
                       left: 'var(--library-bleed)',
                       right: 'var(--library-bleed)',
                       backgroundColor: 'color-mix(in srgb, var(--theme-control-current-track-band-tint) 15%, transparent)',
                       border: '1px solid color-mix(in srgb, var(--theme-control-current-track-band-tint) 25%, transparent)',
                       boxShadow: 'var(--theme-elevated-shadow)',
                       borderRadius: 'var(--library-row-radius)',
                     }}
                   />
                 )}
               </div>

              <div
                ref={scrollContainerRef}
                className="library-track-scroll no-scrollbar h-full min-h-0 overflow-y-auto"
                onScroll={handleScroll}
              >
                 {visibleTracks.length > 0 ? (
                   <div
                     ref={listRef}
                     className="grid relative"
                     style={{ paddingTop, paddingBottom: paddingBottom + bottomInset, gap: 'var(--theme-list-item-gap)', paddingRight: playingIndicator === 'inline' ? 6 : undefined }}
                   >
                      {visibleTracks.map((track, idx) => (
                        <LibraryTrackRow key={track.id} track={track} filteredIndex={startIndex + idx}
                          realTrackIndex={displayIndexMap.get(track.id) ?? -1}
                          isCurrentTrack={track.id === currentTrackId} isSelecting={isSelecting}
                          isSelected={selectedIds.has(track.id)} isDragged={false} hasMenu={menuItemsFor(track).length > 0} canReorder={false}
                          shouldShowAnimation={shouldShowAnimation} colors={colors} playingIndicator={playingIndicator}
                          measureRef={idx === 0 ? rowMeasureRef : undefined} onTrackSelect={onTrackSelect}
                          onToggleSelect={toggleSelectOne} onOpenMenu={openTrackMenu}
                          onDragStart={handleTrackDragStart} onDragOver={handleTrackDragOver}
                          onDrop={handleTrackDrop} onDragEnd={handleTrackDragEnd} />
                      ))}
                  </div>
                ) : (
                  <div className="py-20 text-center opacity-40">
                    <span className="material-symbols-rounded text-6xl mb-4 block">music_note</span>
                    <p className="text-xl font-medium">{t(filterType === 'artist' ? 'library.selectArtist' : 'library.selectAlbum')}</p>
                  </div>
                )}
              </div>
              <LibraryOverlayScrollbar
                scrollRef={scrollContainerRef}
                contentHeight={totalHeight + bottomInset}
                bottomInset={bottomInset}
              />
            </div>
          </div>
        </div>
      )}

      {/* Floating locate button - shows when current track is out of viewport or in a different slot.
          In glass mode the ControlBar overlays the bottom of <main> (absolute, z-40), so the button
          must sit above it (bottomInset + margin) instead of being occluded. */}
      {((showLocateButton && currentTrackInFilteredIndex >= 0) || (dataSource !== activeSlotId && currentTrackId)) && (
        <button
          onClick={handleLocateToCurrentTrack}
          className="absolute right-28 w-9 h-9 shadow-md flex items-center justify-center transition-all z-30 animate-fadeIn"
          style={{
            backgroundColor: inlineFab ? colors.primary : colors.backgroundCard,
            color: inlineFab ? 'var(--theme-control-action-fg)' : colors.textSecondary,
            border: inlineFab ? 'var(--theme-control-border-width) solid var(--theme-list-item-border)' : undefined,
            borderRadius: 'var(--theme-button-radius)',
            boxShadow: inlineFab ? 'var(--theme-elevated-shadow)' : undefined,
            bottom: bottomInset + 24,
          }}
          aria-label={t('library.locateToCurrent')}
          onMouseEnter={e => {
            if (inlineFab) return; // 粗粝风按钮 hover 不变阴影/底色，保持稳定外观
            e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
            e.currentTarget.style.color = colors.textPrimary;
          }}
          onMouseLeave={e => {
            if (inlineFab) return;
            e.currentTarget.style.backgroundColor = colors.backgroundCard;
            e.currentTarget.style.color = colors.textSecondary;
          }}
        >
          <span className="material-symbols-rounded text-lg">my_location</span>
        </button>
      )}

      {trackMenu && menuTrack && !isSelecting && <TrackMenu position={trackMenu} colors={colors}
        items={menuItemsFor(menuTrack)} onClose={closeTrackMenu}
        onAction={id => handleTrackMenuAction(menuTrack, id)} />}

      <ConfirmDialog
        isOpen={trackActions.deleteConfirm !== null}
        title={t('library.removeConfirmTitle')}
        message={trackActions.deleteConfirm === 'batch'
          ? t('library.removeSelectedConfirmMessage', { count: selectedIds.size })
          : t('library.removeConfirmMessage')}
        confirmLabel={t('library.remove')}
        busy={trackActions.isRemoving}
        error={trackActions.removalError ? t('library.removalFailed') : null}
        onConfirm={trackActions.confirmDelete}
        onCancel={trackActions.cancelDelete}
      />

      {/* Metadata editor popup */}
      {trackActions.editingTrack && (
        <MetadataEditorPopup
          track={trackActions.editingTrack}
          isOpen={trackActions.isMetadataEditorOpen}
          onUpdateTrack={(updatedTrack) => {
            onUpdateTrack?.(updatedTrack);
          }}
          onClose={trackActions.closeMetadataEditor}
          onExited={trackActions.clearEditingTrack}
        />
      )}

      {dataSource === 'playlist' && playlistLoadError && (
        <div
          className="absolute left-1/2 z-30 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-1.5 r-control px-3 py-2 text-xs shadow-lg"
          style={{
            bottom: bottomInset + 12,
            backgroundColor: colors.backgroundCard,
            border: `1px solid ${colors.borderLight}`,
            color: colors.error,
          }}
        >
          {playlistLoadError}
        </div>
      )}
    </div>
  );
});

LibraryView.displayName = 'LibraryView';

export default LibraryView;
