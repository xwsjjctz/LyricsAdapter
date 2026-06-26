import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { Track } from '../types';
import { logger } from '../services/logger';
import { getDesktopAPI } from '../services/desktopAdapter';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { toCoverThumb } from '../services/coverUrl';
import { ThemeConfig } from '../types/theme';
import TrackCover from './TrackCover';
import LibraryTrackRow from './LibraryTrackRow';
import LibraryToolbar from './LibraryToolbar';
import MetadataEditorPopup from './MetadataEditorPopup';
import GsapModal from './GsapModal';
import { useLibraryCloudSync } from '../hooks/useLibraryCloudSync';
import { useLibraryVirtualScroll } from '../hooks/useLibraryVirtualScroll';
import { useGlassUI } from '../hooks/useGlassUI';

interface LibraryViewProps {
  tracks: Track[];
  currentTrackIndex: number;
  currentTrackId?: string;
  onTrackSelect: (index: number) => void;
  onRemoveTrack: (trackId: string, deleteFile?: boolean) => void;
  onRemoveMultipleTracks?: (trackIds: string[], deleteFile?: boolean) => void;
  onDropFiles?: (files: File[]) => void;
  onDropFilePaths?: (filePaths: { path: string; name: string }[]) => void;
  onReorderTracks?: (fromIndex: number, toIndex: number) => void;
  onUpdateTrack?: (track: Track) => void;
  isFocusMode?: boolean;
  savedScrollPosition?: number;
  onScrollPositionChange?: (position: number) => void;
  autoLocateToken?: number;
  importProgress?: { loaded: number; total: number } | null;
  dataSource: 'local' | 'cloud';
  activeSlotId: 'local' | 'cloud';
  onSwitchSlot: (slotId: 'local' | 'cloud') => void;
  filterType: 'default' | 'album' | 'artist';
  categorySelection: string | null;
  onFilterTypeChange: (filterType: 'default' | 'album' | 'artist') => void;
  onCategoryChange: (selection: string | null) => void;
  onHeaderHeightChange?: (height: number) => void;
  onLoadCloudTracks: (tracks: Track[]) => void;
  onMergeCloudTracks: (added: Track[], removedIds: string[], updated: Track[]) => void;
  onLocateTrack?: () => void;
  searchBox?: React.ReactNode;
}

const LibraryView: React.FC<LibraryViewProps> = memo(({
  tracks,
  currentTrackIndex,
  currentTrackId,
  onTrackSelect,
  onRemoveTrack,
  onRemoveMultipleTracks,
  onDropFiles,
  onDropFilePaths,
  onReorderTracks,
  onUpdateTrack,
  isFocusMode = false,
  savedScrollPosition = 0,
  onScrollPositionChange,
  autoLocateToken = 0,
  importProgress,
  dataSource,
  activeSlotId,
  onSwitchSlot,
  filterType,
  categorySelection,
  onFilterTypeChange,
  onCategoryChange,
  onHeaderHeightChange,
  onLoadCloudTracks,
  onMergeCloudTracks,
  onLocateTrack,
  searchBox,
}) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false); // New: Drag state for file drop
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null); // Track being reordered
  const [_dragOverIndex, setDragOverIndex] = useState<number | null>(null); // Drop target
  const [insertPosition, setInsertPosition] = useState<{ index: number; position: 'before' | 'after' } | null>(null); // Where to insert the dragged item
  const [originalIndex, setOriginalIndex] = useState<number | null>(null); // Remember where the item started
  // Force re-render when language changes
  const [, setLanguageVersion] = useState(0);
  const [highlightStyle, setHighlightStyle] = useState<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 0,
    opacity: 0
  });
  const [scrollTop, setScrollTop] = useState(0);
  const glassUI = useGlassUI();
  // Measured height of the frosted header band (toolbar + column header) when glass UI is on.
  // Drives topInset so the virtualized list content starts below the band yet scrolls under it.
  const [headerBandHeight, setHeaderBandHeight] = useState(0);
  const headerBandRef = useRef<HTMLDivElement>(null);
  const { loadProgress, refreshCloudTracks } = useLibraryCloudSync({
    dataSource,
    onLoadCloudTracks,
    onMergeCloudTracks,
  });
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
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [deleteFileOption, setDeleteFileOption] = useState(false);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [isMetadataEditorOpen, setIsMetadataEditorOpen] = useState(false);

  const selectedArtist = filterType === 'artist' ? categorySelection : null;
  const selectedAlbum = filterType === 'album' ? categorySelection : null;

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = i18n.subscribe(() => {
      setLanguageVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

  // Subscribe to theme changes
  const [showEditDropdown, setShowEditDropdown] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  // Measure the frosted header band height so topInset tracks its real size
  // (varies with import-progress bar, edit-mode column header, filter type).
  useEffect(() => {
    if (!glassUI) {
      setHeaderBandHeight(0);
      onHeaderHeightChange?.(0);
      return;
    }
    const el = headerBandRef.current;
    if (!el) return;
    const update = () => {
      const h = el.getBoundingClientRect().height;
      setHeaderBandHeight(h);
      onHeaderHeightChange?.(h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [glassUI, filterType, isEditMode, onHeaderHeightChange]);

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
  // 跨槽定位时，跳过 restore scroll 并使用即时滚动定位
  const instantLocateRef = useRef(false);
  // 实时记录 scrollTop，cleanup 时读此 ref 而非 DOM（避免 DOM 切换后 scrollTop 被 clamp）
  const lastScrollTopRef = useRef(0);

  // Theme colors
  const colors = currentTheme.colors;

  // Determine which tracks to use for calculations
  const activeTracks = filterType === 'default' ? filteredTracks : categoryFilteredTracks;

  // Glass UI insets. topInset offsets the default (virtualized) list below the
  // frosted header band so rows scroll under it; the hook windows against it and
  // rowTop() accounts for it. Category views keep the toolbar in-flow (frosted)
  // and just reserve bottom space. bottomInset lets the last rows scroll clear of
  // the overlaid ControlBar.
  const topInset = glassUI && filterType === 'default' ? headerBandHeight : 0;
  const bottomInset = glassUI ? 96 : 0; // ControlBar height (h-24)

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
    isEditMode,
    topInset,
  });

  const shouldVirtualize = endIndex > startIndex || startIndex > 0;
  const visibleTracks = shouldVirtualize ? activeTracks.slice(startIndex, endIndex) : activeTracks;

  // Absolute content-y of a row, including the topInset offset introduced by the
  // frosted header band. Use this everywhere a row's position is computed so the
  // highlight slider, locate math, and visibility checks stay aligned with the band.
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
    if (hasAutoLocatedToTrackRef.current) return;
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
  }, [currentTrackIndex, tracks.length, rowStride, baseRowHeight, totalHeight, topInset]);

  // Restore scroll position when switching between local/cloud
  useEffect(() => {
    if (!scrollContainerRef.current) return;
    // 如果即将有定位操作，跳过恢复，由 auto-locate effect 处理
    if (instantLocateRef.current) return;
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
      // Effective viewport excludes the frosted header (topInset) and ControlBar
      // (bottomInset); locating must land the track where it isn't occluded.
      const viewTop = container.scrollTop + topInset;
      const viewBottom = container.scrollTop + container.clientHeight - bottomInset;
      const itemTop = rowTop(currentTrackInFilteredIndex);
      const itemBottom = itemTop + baseRowHeight;

      if (itemTop >= viewTop && itemBottom <= viewBottom) {
        logger.debug(`[LibraryView] Track ${currentTrackInFilteredIndex + 1} is already visible, no auto-locate needed`);
        previousTrackIndexRef.current = currentTrackInFilteredIndex;
        setShowLocateButton(false);
        instantLocateRef.current = false;
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
      if (instantLocateRef.current) {
        // 跨槽定位：直接跳转，避免先恢复旧位置再平滑滚动的长动画
        container.scrollTop = clampedTop;
        instantLocateRef.current = false;
      } else {
        container.scrollTo({ top: clampedTop, behavior: 'smooth' });
      }
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
    if (isEditMode || !currentTrackId || displayTracks.length === 0) {
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
  }, [currentTrackId, currentTrackInDisplayIndex, displayTracks.length, isEditMode, filterType, categoryFilteredTracks, rowStride, baseRowHeight, topInset]);

  // 切到非 default 视图时立即隐藏高亮（category 列表布局不同，避免错位闪烁）
  useEffect(() => {
    if (filterType !== 'default') {
      logger.debug(`[LibraryView] Filter type changed to ${filterType}, hiding highlight temporarily`);
      setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
    }
  }, [filterType]);

  // Check if current track is visible in viewport
  // Account for the frosted header (topInset) and overlaid ControlBar (bottomInset):
  // a track sitting within the scroll viewport but occluded by either glass band
  // must still count as "not visible" so the locate button stays on screen.
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

    // Check if current playing track is visible (only if it's in filtered results)
    const targetTracks = filterType === 'default' ? filteredTracks : categoryFilteredTracks;
    if (currentTrackInFilteredIndex >= 0 && targetTracks.length > 0) {
      const container = scrollContainerRef.current;
      if (container) {
        const itemTop = rowTop(currentTrackInFilteredIndex);
        const itemBottom = itemTop + baseRowHeight;
        // Effective viewport excludes the frosted header (top) and ControlBar (bottom);
        // a track covered by either band is treated as out of view.
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
  }, [onScrollPositionChange, currentTrackInFilteredIndex, filteredTracks.length, categoryFilteredTracks.length, rowStride, baseRowHeight, filterType, dataSource, activeSlotId, currentTrackId, topInset, bottomInset]);

  // Handle drag events
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if this is an external file drop (not internal track reordering)
    const hasFiles = e.dataTransfer.files.length > 0;
    const hasFileTypes = e.dataTransfer.types.some(type =>
      type === 'Files' || type === 'text/uri-list'
    );
    
    // Only show import overlay for external file drops
    if ((hasFiles || hasFileTypes) && !isDragging) {
      logger.debug('[LibraryView] Drag over - enabling dragging state');
      setIsDragging(true);
    }
  }, [isDragging]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Only set dragging to false if we're actually leaving the container
    // (not just hovering over child elements)
    const currentTarget = e.currentTarget as HTMLElement;
    const relatedTarget = e.relatedTarget as HTMLElement;

    // Check if the related target is outside the current target
    // relatedTarget is null when dragging leaves the window (e.g., to desktop)
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      logger.debug('[LibraryView] Drag leave - disabling dragging state');
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    logger.debug('[LibraryView] Drop event triggered');
    setIsDragging(false);

    // Get dropped files
    const droppedFiles = Array.from(e.dataTransfer.files);
    logger.debug(`[LibraryView] Total files dropped: ${droppedFiles.length}`);

    // Filter for audio files only
    const audioExtensions = ['.flac', '.mp3', '.m4a', '.wav'];
    const audioFiles = droppedFiles.filter(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      return audioExtensions.includes(ext);
    });

    logger.debug(`[LibraryView] Audio files after filtering: ${audioFiles.length}`);

    if (audioFiles.length === 0) {
      logger.warn('[LibraryView] No audio files dropped');
      return;
    }

    // Check if we're in Electron mode and can get file paths
    const desktopAPI = getDesktopAPI();
    logger.debug('[LibraryView] Drop check - desktopAPI:', !!desktopAPI, 'getPathForFile:', !!desktopAPI?.getPathForFile, 'onDropFilePaths:', !!onDropFilePaths);
    
    if (desktopAPI?.getPathForFile && onDropFilePaths) {
      // Electron mode: get real file paths
      logger.debug('[LibraryView] Electron mode: getting file paths from dropped files');
      try {
        const filePaths = audioFiles.map(file => ({
          path: desktopAPI.getPathForFile!(file),
          name: file.name
        }));
        logger.debug(`[LibraryView] Got ${filePaths.length} file paths`);
        onDropFilePaths(filePaths);
        return;
      } catch (error) {
        logger.error('[LibraryView] Failed to get file paths:', error);
        // Fall through to File mode
      }
    }

    // Web mode or fallback: use File objects
    if (onDropFiles) {
      logger.debug(`[LibraryView] Web mode: passing ${audioFiles.length} File objects`);
      onDropFiles(audioFiles);
    } else {
      logger.warn('[LibraryView] No drop handler available');
    }
  }, [onDropFiles, onDropFilePaths]);

  const toggleSelectAll = useCallback(() => {
    // Use filtered tracks for selection when searching
    if (selectedIds.size === tracks.length) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Select all
      setSelectedIds(new Set(tracks.map(t => t.id)));
    }
  }, [selectedIds.size, tracks]);

  const toggleSelectOne = useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return newSelected;
    });
  }, []);

  const confirmDelete = useCallback((trackId: string) => {
    setTrackToDelete(trackId);
    setDeleteFileOption(false);
    setShowDeleteConfirm(true);
  }, []);

  const openMetadataEditor = useCallback((track: Track) => {
    setEditingTrack(track);
    setIsMetadataEditorOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (trackToDelete) {
      await onRemoveTrack(trackToDelete, dataSource === 'local' && deleteFileOption);
      setShowDeleteConfirm(false);
      setTrackToDelete(null);
    }
  }, [trackToDelete, onRemoveTrack, dataSource, deleteFileOption]);

  const confirmBatchDelete = useCallback(() => {
    setDeleteFileOption(false);
    setShowBatchDeleteConfirm(true);
  }, []);

  const handleConfirmBatchDelete = useCallback(async () => {
    const idsToRemove = Array.from(selectedIds);

    logger.debug(`[LibraryView] Removing ${idsToRemove.length} tracks...`);

    const shouldDeleteFile = dataSource === 'local' && deleteFileOption;

    if (onRemoveMultipleTracks) {
      await onRemoveMultipleTracks(idsToRemove, shouldDeleteFile);
      logger.debug('[LibraryView] ✓ Batch removal complete');
    } else {
      logger.debug('[LibraryView] Using sequential removal (fallback)...');
      for (let i = 0; i < idsToRemove.length; i++) {
        const id = idsToRemove[i]!;
        logger.debug(`[LibraryView] Removing track ${i + 1}/${idsToRemove.length}`);
        await onRemoveTrack(id, shouldDeleteFile);
      }
      logger.debug('[LibraryView] Sequential removal complete');
    }

    setSelectedIds(new Set());
    setIsEditMode(false);
    setShowBatchDeleteConfirm(false);
  }, [selectedIds, onRemoveMultipleTracks, onRemoveTrack]);

  // Handle drag start for track reordering
  const handleTrackDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedIndex(index);
    setOriginalIndex(index);
    logger.debug(`[LibraryView] Drag started at index ${index}`);
  }, []);

  // Handle drag over for track reordering
  const handleTrackDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);

      // Calculate whether to insert before or after the target row
      const targetElement = e.currentTarget as HTMLElement;
      const rect = targetElement.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const insertBefore = relativeY < rect.height / 2;

      setInsertPosition({
        index,
        position: insertBefore ? 'before' : 'after'
      });
    } else if (draggedIndex !== null && draggedIndex === index) {
      // Clear insert position when hovering over the dragged item itself
      setInsertPosition(null);
    }
  }, [draggedIndex]);

  // Handle drag end for track reordering
  const handleTrackDragEnd = useCallback(() => {
    if (draggedIndex !== null && originalIndex !== null && insertPosition !== null) {
      let targetIndex = insertPosition.index;

      // Adjust target index based on insert position
      if (insertPosition.position === 'after') {
        targetIndex = targetIndex + 1;
      }

      // Only reorder if the position actually changed
      if (targetIndex !== originalIndex) {
        logger.debug(`[LibraryView] Dropping track from ${originalIndex} to ${targetIndex}`);
        onReorderTracks?.(originalIndex, targetIndex);
      } else {
        logger.debug(`[LibraryView] Track returned to original position ${originalIndex}, no reorder needed`);
      }
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
    setInsertPosition(null);
    setOriginalIndex(null);
  }, [draggedIndex, originalIndex, insertPosition, onReorderTracks]);

  // Handle locate to current playing track
  const handleLocateToCurrentTrack = useCallback(() => {
    if (dataSource !== activeSlotId) {
      // Cross-slot: switch view to the playing slot and trigger auto-locate
      // 标记跨槽定位，使 restore scroll effect 跳过、auto-locate 使用即时滚动
      instantLocateRef.current = true;
      onSwitchSlot(activeSlotId);
      onLocateTrack?.();
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
  }, [dataSource, activeSlotId, onSwitchSlot, onLocateTrack, currentTrackInFilteredIndex, currentTrackIndex, rowStride, baseRowHeight, totalHeight, topInset]);

  // Hide locate button when current track becomes visible (e.g., after clicking a new track to play)
  useEffect(() => {
    if (showLocateButton && isCurrentTrackVisible()) {
      setShowLocateButton(false);
    }
  }, [currentTrackId, showLocateButton, isCurrentTrackVisible]);

  return (
    <div
      className={`w-full flex flex-col h-full relative transition-all duration-300 ${
        isDragging
          ? 'bg-primary/5'
          : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖放覆盖层 - 拖放时显示 */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm rounded-2xl border-2 border-dashed border-primary pointer-events-none animate-pulse">
          <div className="text-center">
            <span className="material-symbols-outlined text-6xl text-primary mb-4">upload_file</span>
            <p className="text-2xl font-bold text-primary mb-2">{i18n.t('library.dropFiles')}</p>
            <p className="text-sm" style={{ color: colors.textMuted }}>{i18n.t('library.supportFormats')}</p>
          </div>
        </div>
      )}

      {/* Header band: toolbar (+ default column header). In default mode with glass UI
          it becomes a frosted absolute overlay (list scrolls under it, height measured
          via ResizeObserver → topInset). In category mode it stays in-flow but frosted. */}
      <div
        ref={headerBandRef}
        className={
          glassUI
            ? 'flex-shrink-0 relative z-30'
            : 'flex-shrink-0'
        }
      >
      <LibraryToolbar
        dataSource={dataSource}
        colors={colors}
        isEditMode={isEditMode}
        selectedCount={selectedIds.size}
        showEditDropdown={showEditDropdown}
        setShowEditDropdown={setShowEditDropdown}
        onToggleEditMode={() => {
          if (isEditMode) {
            setIsEditMode(false);
            setSelectedIds(new Set());
            setShowEditDropdown(false);
          } else {
            setIsEditMode(true);
          }
        }}
        onBatchDelete={confirmBatchDelete}
        {...(dataSource === 'cloud' ? { onRefreshCloud: handleRefreshCloud, isRefreshing } : {})}
        filterType={filterType}
        onFilterTypeChange={onFilterTypeChange}
        onCategoryChange={onCategoryChange}
        uniqueAlbums={uniqueAlbums}
        uniqueArtists={uniqueArtists}
        trackCount={filteredTracks.length}
        importProgress={importProgress}
        loadProgress={dataSource === 'cloud' ? loadProgress : undefined}
        searchBox={searchBox}
      />

      {filterType === 'default' && (
        <div className="flex-shrink-0">
          <div className={`grid gap-4 px-4 py-2 text-xs font-bold uppercase tracking-widest border-b grid-cols-[48px_1fr_1fr_120px] ${glassUI ? 'mb-0' : 'mb-2'}`} style={{ color: colors.textMuted, borderColor: colors.borderLight }}>
            {isEditMode ? (
              <input
                type="checkbox"
                checked={selectedIds.size === tracks.length && tracks.length > 0}
                onChange={toggleSelectAll}
                onClick={(e) => e.stopPropagation()}
                className="w-4 h-4 rounded cursor-pointer"
                style={{ accentColor: colors.primary }}
              />
            ) : (
              <span>#</span>
            )}
            <span>{i18n.t('library.titleCol')}</span><span className="pl-8">{i18n.t('library.albumCol')}</span>
            {isEditMode ? (
              <span className="text-right">{i18n.t('library.actionCol')}</span>
            ) : (
              <span className="text-right">{i18n.t('library.timeCol')}</span>
            )}
          </div>
        </div>
      )}
      </div>

      {/* 可滚动的歌曲列表 */}
      {filterType === 'default' ? (
        <div
          className={glassUI ? 'absolute inset-0 overflow-hidden' : 'flex-1 relative min-h-0 overflow-hidden'}
          style={{ marginLeft: -24, marginRight: -24, paddingLeft: 24, paddingRight: 24 }}
        >
          {/* Sliding highlight overlay (outside scroll clipping) */}
          <div className="absolute inset-0 pointer-events-none">
            {highlightStyle.opacity > 0 && (
              <div
                className="absolute rounded-xl pointer-events-none transition-[transform,height] duration-150 ease-out shadow-xl"
                style={{
                  transform: `translateY(${highlightStyle.top - scrollTop}px)`,
                  height: `${highlightStyle.height}px`,
                  opacity: highlightStyle.opacity,
                  left: 24,
                  right: 24,
                  backgroundColor: `${colors.primary}26`,
                  border: `1px solid ${colors.primary}40`,
                }}
              />
            )}
          </div>

          <div
            ref={scrollContainerRef}
            className="h-full min-h-0 overflow-y-auto no-scrollbar"
            onScroll={handleScroll}
          >
            {filteredTracks.length > 0 ? (
              <div
                ref={listRef}
                className="grid gap-2 relative"
                style={{ paddingTop, paddingBottom: paddingBottom + bottomInset }}
              >
                {insertPosition !== null && (
                  <div
                    className="absolute left-0 right-0 h-0.5 rounded-full shadow-lg z-20 transition-all duration-150"
                    style={{
                      top: (insertPosition.position === 'before'
                        ? (insertPosition.index - startIndex)
                        : (insertPosition.index - startIndex + 1)) * rowStride,
                      opacity: insertPosition.index >= startIndex - 1 && insertPosition.index < endIndex ? 1 : 0,
                      backgroundColor: colors.primary,
                      boxShadow: `0 0 10px ${colors.primary}`,
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
                      isEditMode={isEditMode}
                      isSelected={selectedIds.has(track.id)}
                      isDragged={isDragged}
                      shouldShowAnimation={shouldShowAnimation}
                      colors={colors}
                      measureRef={idx === 0 ? rowMeasureRef : undefined}
                      realTrackIndex={displayIndexMap.get(track.id) ?? -1}
                      onTrackSelect={onTrackSelect}
                      onToggleSelect={toggleSelectOne}
                      onEditMetadata={openMetadataEditor}
                      onDelete={confirmDelete}
                      onDragStart={handleTrackDragStart}
                      onDragOver={handleTrackDragOver}
                      onDragEnd={handleTrackDragEnd}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="py-20 text-center rounded-2xl" style={{ opacity: 0.2, color: colors.textMuted, border: `2px dashed ${colors.borderLight}` }}>
                <span className="material-symbols-outlined text-6xl mb-4 block">library_music</span>
                <p className="text-xl font-medium">{i18n.t('library.noTracksImported')}</p>
                <p className="text-sm">{i18n.t('library.useSidebarToImport')}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex gap-4 overflow-hidden" style={{ marginLeft: -24, marginRight: -24, paddingLeft: 24, paddingRight: 24 }}>
          {/* 左侧分类列表 */}
          <div
            className="w-64 flex-shrink-0 overflow-y-auto no-scrollbar"
            style={glassUI ? { paddingBottom: bottomInset } : undefined}
          >
            <div className="text-xs font-bold uppercase tracking-widest mb-2 px-2" style={{ color: colors.textMuted }}>
              {i18n.t(filterType === 'artist' ? 'library.artistList' : 'library.albumList')}
            </div>
            <div className="flex flex-col gap-1">
              {filterType === 'artist' ? (
                uniqueArtists.map((artist) => (
                  <button
                    key={artist.name}
                    onClick={() => onCategoryChange(artist.name)}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all"
                    style={{
                      backgroundColor: selectedArtist === artist.name ? colors.backgroundCard : 'transparent',
                      color: selectedArtist === artist.name ? colors.textPrimary : colors.textSecondary,
                    }}
                    onMouseEnter={e => { if (selectedArtist !== artist.name) e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
                    onMouseLeave={e => { if (selectedArtist !== artist.name) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    {artist.coverUrl && (
                      <img
                        src={toCoverThumb(artist.coverUrl, 128)}
                        alt=""
                        className="w-10 h-10 rounded-lg object-cover"
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
                    className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all"
                    style={{
                      backgroundColor: selectedAlbum === album.name ? colors.backgroundCard : 'transparent',
                      color: selectedAlbum === album.name ? colors.textPrimary : colors.textSecondary,
                    }}
                    onMouseEnter={e => { if (selectedAlbum !== album.name) e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
                    onMouseLeave={e => { if (selectedAlbum !== album.name) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    {album.coverUrl && (
                      <img
                        src={toCoverThumb(album.coverUrl, 128)}
                        alt=""
                        className="w-10 h-10 rounded-lg object-cover"
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
           <div className="flex-1 flex flex-col min-w-0">
             <div className="flex-shrink-0" style={{ marginLeft: -24, marginRight: -24, paddingLeft: 24, paddingRight: 24 }}>
               <div className="grid gap-4 px-4 py-2 text-xs font-bold uppercase tracking-widest border-b mb-2 grid-cols-[48px_1fr_1fr_120px]" style={{ color: colors.textMuted, borderColor: colors.borderLight }}>
                {isEditMode ? (
                  <input
                    type="checkbox"
                    checked={selectedIds.size === tracks.length && tracks.length > 0}
                    onChange={toggleSelectAll}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded cursor-pointer"
                  style={{ accentColor: colors.primary }}
                />
                ) : (
                  <span>#</span>
                )}
                 <span>{i18n.t('library.titleCol')}</span><span className="pl-8">{i18n.t('library.albumCol')}</span>
                {isEditMode ? (
                  <span className="text-right">{i18n.t('library.actionCol')}</span>
                ) : (
                  <span className="text-right">{i18n.t('library.timeCol')}</span>
                )}
               </div>
             </div>
             <div className="flex-1 relative min-h-0 overflow-hidden" style={{ marginLeft: -24, marginRight: -24, paddingLeft: 24, paddingRight: 24 }}>
               {/* Sliding highlight overlay (outside scroll clipping) */}
               <div className="absolute inset-0 pointer-events-none">
                 {highlightStyle.opacity > 0 && (
                   <div
                     className="absolute rounded-xl pointer-events-none transition-[transform,height] duration-150 ease-out shadow-xl"
                     style={{
                       transform: `translateY(${highlightStyle.top - scrollTop}px)`,
                       height: `${highlightStyle.height}px`,
                       opacity: highlightStyle.opacity,
                       left: 24,
                       right: 24,
                       backgroundColor: `${colors.primary}26`,
                       border: `1px solid ${colors.primary}40`,
                     }}
                   />
                 )}
               </div>

              <div
                ref={scrollContainerRef}
                className="h-full min-h-0 overflow-y-auto no-scrollbar"
                onScroll={handleScroll}
              >
                 {visibleTracks.length > 0 ? (
                   <div
                     ref={listRef}
                     className="grid gap-2 relative"
                     style={{ paddingTop, paddingBottom: paddingBottom + bottomInset }}
                   >
                      {visibleTracks.map((track, idx) => {
                        const filteredIndex = idx;
                         const isUnavailable = track.available === false;
                         const isSelected = selectedIds.has(track.id);
                         const isCurrentTrack = track.id === currentTrackId;
                         const animationStyle = shouldShowAnimation
                           ? { animation: `fadeInUp 0.3s ease-out ${filteredIndex * 0.03}s both` }
                           : undefined;

                         return (
                           <div
                             key={track.id}
                             ref={idx === 0 ? rowMeasureRef : undefined}
                             data-track-index={filteredIndex}
  onClick={() => {
                             if (isEditMode || isUnavailable) return;
                             const realIndex = displayIndexMap.get(track.id) ?? -1;
                             if (realIndex >= 0) onTrackSelect(realIndex);
                           }}
                             className="grid gap-4 px-4 py-3 rounded-xl transition-all items-center relative z-10 grid-cols-[48px_1fr_1fr_120px]"
                            style={{
                              ...animationStyle,
                              opacity: isUnavailable ? 0.4 : 1,
                              backgroundColor: isSelected ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
                              border: isSelected ? `1px solid ${colors.error}30` : '1px solid transparent',
                              color: isCurrentTrack ? colors.primary : colors.textPrimary,
                              cursor: (isEditMode || isUnavailable) ? 'default' : 'pointer',
                            }}
                            onMouseEnter={e => { if (!isUnavailable && !isSelected && !isEditMode) e.currentTarget.style.backgroundColor = colors.backgroundCardHover; }}
                            onMouseLeave={e => { if (!isUnavailable && !isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                           <div className="text-sm font-medium opacity-50">
                             {isEditMode && !isUnavailable ? (
                               <input
                                 type="checkbox"
                                 checked={isSelected}
                                 onChange={() => toggleSelectOne(track.id)}
                                 onClick={(e) => e.stopPropagation()}
                                 className="w-4 h-4 rounded cursor-pointer"
                                 style={{ accentColor: colors.primary }}
                               />
                             ) : (
                               filteredIndex + 1
                             )}
                           </div>
                           <div className="flex items-center gap-3 min-w-0">
                             <TrackCover
                               trackId={track.id}
                               filePath={track.filePath}
                               fallbackUrl={track.coverUrl}
                               className="size-10 rounded-lg object-cover"
                             />
                             <div className="min-w-0 flex-1">
                               <p className="text-sm font-semibold truncate">
                                 {track.title}
                                 {isUnavailable && <span className="text-xs text-yellow-400 ml-2">{i18n.t('library.needReimport')}</span>}
                               </p>
                               <p className="text-xs opacity-50 truncate">{track.artist}</p>
                             </div>
                           </div>
                           <div className="text-sm opacity-50 truncate pl-8">{track.album}</div>
                           {isEditMode ? (
                             <div className="flex items-center justify-end gap-2">
                               <button
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   openMetadataEditor(track);
                                 }}
                                 className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                                 style={{ color: colors.textMuted }}
                                 title={i18n.t('sidebar.metadata')}
                                 onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.primary; }}
                                 onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.textMuted; }}
                               >
                                 <span className="material-symbols-outlined text-lg">description</span>
                               </button>
                               <button
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   confirmDelete(track.id);
                                 }}
                                 className="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all"
                               >
                                 <span className="material-symbols-outlined text-lg">delete</span>
                               </button>
                             </div>
                           ) : (
                             <div className="text-sm opacity-50 text-right tabular-nums">
                               {Math.floor(track.duration / 60)}:{Math.floor(track.duration % 60).toString().padStart(2, '0')}
                             </div>
                           )}
                         </div>
                       );
                     })}
                  </div>
                ) : (
                  <div className="py-20 text-center opacity-40">
                    <span className="material-symbols-outlined text-6xl mb-4 block">music_note</span>
                    <p className="text-xl font-medium">{i18n.t(filterType === 'artist' ? 'library.selectArtist' : 'library.selectAlbum')}</p>
                  </div>
                )}
              </div>
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
          className="absolute right-28 w-9 h-9 rounded-lg shadow-md flex items-center justify-center transition-all z-30 animate-fadeIn"
          style={{ backgroundColor: colors.backgroundCard, color: colors.textSecondary, bottom: glassUI ? bottomInset + 24 : 24 }}
          title={i18n.t('library.locateToCurrent')}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.textPrimary; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textSecondary; }}
        >
          <span className="material-symbols-outlined text-lg">my_location</span>
        </button>
      )}

      {/* Delete confirmation dialog */}
      <GsapModal
        isOpen={showDeleteConfirm}
        overlayClassName="z-50"
        overlayStyle={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        panelClassName="rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
        panelStyle={{ backgroundColor: colors.backgroundDark, border: `1px solid ${colors.borderLight}` }}
      >
            <h3 className="text-lg font-semibold mb-2" style={{ color: colors.textPrimary }}>{i18n.t('library.deleteConfirmTitle')}</h3>
            <p className="mb-4" style={{ color: colors.textSecondary }}>{i18n.t('library.deleteConfirmMessage')}</p>
            {dataSource === 'local' && (
              <label className="flex items-center gap-2 mb-4 cursor-pointer select-none" style={{ color: colors.textSecondary }}>
                <input
                  type="checkbox"
                  checked={deleteFileOption}
                  onChange={(e) => setDeleteFileOption(e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 rounded cursor-pointer"
                  style={{ accentColor: colors.error }}
                />
                <span className="text-sm">{i18n.t('library.deleteFileOption')}</span>
              </label>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setTrackToDelete(null);
                }}
                className="px-4 py-2 rounded-lg transition-all"
                style={{ color: colors.textSecondary }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {i18n.t('common.cancel')}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-lg transition-all"
                style={{ backgroundColor: `${colors.error}20`, color: colors.error }}
              >
                {i18n.t('common.delete')}
              </button>
            </div>
      </GsapModal>

      {/* Batch delete confirmation dialog */}
      <GsapModal
        isOpen={showBatchDeleteConfirm}
        overlayClassName="z-50"
        overlayStyle={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        panelClassName="rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
        panelStyle={{ backgroundColor: colors.backgroundDark, border: `1px solid ${colors.borderLight}` }}
      >
            <h3 className="text-lg font-semibold mb-2" style={{ color: colors.textPrimary }}>{i18n.t('library.deleteConfirmTitle')}</h3>
            <p className="mb-4" style={{ color: colors.textSecondary }}>
              {i18n.t('library.deleteSelectedConfirmMessage').replace('{count}', String(selectedIds.size))}
            </p>
            {dataSource === 'local' && (
              <label className="flex items-center gap-2 mb-4 cursor-pointer select-none" style={{ color: colors.textSecondary }}>
                <input
                  type="checkbox"
                  checked={deleteFileOption}
                  onChange={(e) => setDeleteFileOption(e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 rounded cursor-pointer"
                  style={{ accentColor: colors.error }}
                />
                <span className="text-sm">{i18n.t('library.deleteFileOption')}</span>
              </label>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowBatchDeleteConfirm(false)}
                className="px-4 py-2 rounded-lg transition-all"
                style={{ color: colors.textSecondary }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {i18n.t('common.cancel')}
              </button>
              <button
                onClick={handleConfirmBatchDelete}
                className="px-4 py-2 rounded-lg transition-all"
                style={{ backgroundColor: `${colors.error}20`, color: colors.error }}
              >
                {i18n.t('common.delete')}
              </button>
            </div>
      </GsapModal>

      {/* Metadata editor popup */}
      {editingTrack && (
        <MetadataEditorPopup
          track={editingTrack}
          isOpen={isMetadataEditorOpen}
          onUpdateTrack={(updatedTrack) => {
            onUpdateTrack?.(updatedTrack);
          }}
          onClose={() => setIsMetadataEditorOpen(false)}
          onExited={() => setEditingTrack(null)}
        />
      )}
    </div>
  );
});

LibraryView.displayName = 'LibraryView';

export default LibraryView;
