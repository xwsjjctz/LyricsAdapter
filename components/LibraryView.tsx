import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { Track } from '../types';
import { logger } from '../services/logger';
import { getDesktopAPI } from '../services/desktopAdapter';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';
import { webdavClient } from '../services/webdavClient';
import { useWebDAV } from '../hooks/useWebDAV';
import { notify } from '../services/notificationService';
import TrackCover from './TrackCover';

interface LibraryViewProps {
  tracks: Track[];
  currentTrackIndex: number;
  currentTrackId?: string;
  onTrackSelect: (index: number) => void;
  onCloudTrackSelect?: (index: number) => void;
  onRemoveTrack: (trackId: string) => void;
  onRemoveMultipleTracks?: (trackIds: string[]) => void;
  onDropFiles?: (files: File[]) => void;
  onDropFilePaths?: (filePaths: { path: string; name: string }[]) => void;
  onReorderTracks?: (fromIndex: number, toIndex: number) => void;
  isFocusMode?: boolean;
  inputValue?: string;
  searchTrigger?: number;
  savedScrollPosition?: number;
  onScrollPositionChange?: (position: number, source: 'local' | 'cloud') => void;
  isFirstLoad?: boolean;
  autoLocateToken?: number;
  onNavigateToSettings?: (section?: string) => void;
  importProgress?: { loaded: number; total: number } | null;
  dataSource: 'local' | 'cloud';
  filterType: 'default' | 'album' | 'artist';
  categorySelection: string | null;
  onDataSourceChange: (source: 'local' | 'cloud') => void;
  onFilterTypeChange: (filterType: 'default' | 'album' | 'artist') => void;
  onCategoryChange: (selection: string | null) => void;
  onCloudLoad: (webdavTracks: Track[]) => Promise<void>;
  onLocalRestore: () => Promise<void>;
  webdavTracks: Track[];
  onWebdavTracksChange: (tracks: Track[]) => void;
}

const LibraryView: React.FC<LibraryViewProps> = memo(({
  tracks,
  currentTrackIndex,
  currentTrackId,
  onTrackSelect,
  onCloudTrackSelect,
  onRemoveTrack,
  onRemoveMultipleTracks,
  onDropFiles,
  onDropFilePaths,
  onReorderTracks,
  isFocusMode = false,
  inputValue: externalInputValue = '',
  searchTrigger = 0,
  savedScrollPosition = 0,
  onScrollPositionChange,
  isFirstLoad = false,
  autoLocateToken = 0,
  onNavigateToSettings,
  importProgress,
  dataSource,
  filterType,
  categorySelection,
  onDataSourceChange,
  onFilterTypeChange,
  onCategoryChange,
  onCloudLoad,
  onLocalRestore,
  webdavTracks,
  onWebdavTracksChange
}) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false); // New: Drag state for file drop
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null); // Track being reordered
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null); // Drop target
  const [insertPosition, setInsertPosition] = useState<{ index: number; position: 'before' | 'after' } | null>(null); // Where to insert the dragged item
  const [originalIndex, setOriginalIndex] = useState<number | null>(null); // Remember where the item started
  const [executedSearchQuery, setExecutedSearchQuery] = useState(''); // Local executed search query
  // Force re-render when language changes
  const [, setLanguageVersion] = useState(0);
  const [highlightStyle, setHighlightStyle] = useState<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 0,
    opacity: 0
  });
  const [scrollTop, setScrollTop] = useState(0);
  const { isLoading: webdavLoading, error: webdavError, loadProgress, loadWebDAVFiles, cancelLoad } = useWebDAV();

  // Auto-load WebDAV on startup if dataSource is 'cloud'
  useEffect(() => {
    if (isFirstLoad && dataSource === 'cloud' && webdavTracks.length === 0 && !webdavLoading && webdavClient.hasConfig()) {
      (async () => {
        try {
          const loadedTracks = await loadWebDAVFiles();
          onWebdavTracksChange(loadedTracks);
          await onCloudLoad(loadedTracks);
        } catch (err) {
          logger.warn('[LibraryView] Auto WebDAV load failed:', err);
        }
      })();
    }
  }, [isFirstLoad, dataSource]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayTracks = dataSource === 'cloud' ? webdavTracks : tracks;
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(0);
  const [rowGap, setRowGap] = useState(8);
  const [showLocateButton, setShowLocateButton] = useState(false);
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const previousTrigger = useRef(searchTrigger);

  const selectedArtist = filterType === 'artist' ? categorySelection : null;
  const selectedAlbum = filterType === 'album' ? categorySelection : null;

  // Execute search when trigger changes (from Enter key in Sidebar)
  useEffect(() => {
    if (searchTrigger !== previousTrigger.current) {
      previousTrigger.current = searchTrigger;
      setExecutedSearchQuery(externalInputValue);
    }
  }, [searchTrigger, externalInputValue]);

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = i18n.subscribe(() => {
      setLanguageVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

  // Subscribe to theme changes
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  // Track if animation has already played for current tracks
  const hasAnimatedRef = useRef(false);
  const previousTracksRef = useRef<Track[]>([]);
  const isInitialMountRef = useRef(true);

  // Filter tracks based on executed search query
  const filteredTracks = useMemo(() => {
    if (!executedSearchQuery.trim()) return displayTracks;
    const query = executedSearchQuery.toLowerCase();
    return displayTracks.filter(track =>
      track.title.toLowerCase().includes(query) ||
      track.artist.toLowerCase().includes(query) ||
      track.album.toLowerCase().includes(query)
    );
  }, [displayTracks, executedSearchQuery]);

  const uniqueArtists = useMemo(() => {
    const artistMap = new Map<string, { name: string; coverUrl?: string }>();
    displayTracks.forEach(track => {
      const artists = track.artist.split(/[/&、]/).map(a => a.trim()).filter(a => a);
      artists.forEach(artist => {
        if (!artistMap.has(artist)) {
          artistMap.set(artist, {
            name: artist,
            coverUrl: track.coverUrl
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
          coverUrl: track.coverUrl
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
  const didTracksChange = useCallback((prevTracks: Track[], newTracks: Track[]) => {
    if (prevTracks.length !== newTracks.length) return true;
    return prevTracks.some((track, index) => track.id !== newTracks[index]?.id);
  }, []);

  // Ref for the scrollable container
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousTrackIndexRef = useRef<number>(-1);
  const lastHandledAutoLocateTokenRef = useRef<number>(autoLocateToken);
  const highlightUpdateIdRef = useRef(0);
  const overscan = 6;

  const baseRowHeight = rowHeight || 64;
  const rowStride = baseRowHeight + rowGap;

  // Theme colors
  const colors = currentTheme.colors;

  // Determine which tracks to use for calculations
  const activeTracks = filterType === 'default' ? filteredTracks : categoryFilteredTracks;

  const totalHeight = activeTracks.length > 0
    ? (activeTracks.length - 1) * rowStride + baseRowHeight
    : 0;
  const shouldVirtualize = activeTracks.length > 200 && viewportHeight > 0;
  const startIndex = shouldVirtualize
    ? Math.max(0, Math.floor(scrollTop / rowStride) - overscan)
    : 0;
  const endIndex = shouldVirtualize
    ? Math.min(activeTracks.length, Math.ceil((scrollTop + viewportHeight) / rowStride) + overscan)
    : activeTracks.length;
  const visibleTracks = shouldVirtualize ? activeTracks.slice(startIndex, endIndex) : activeTracks;
  const visibleCount = visibleTracks.length;
  const paddingTop = shouldVirtualize ? startIndex * rowStride : 0;
  const visibleHeight = visibleCount > 0
    ? (visibleCount - 1) * rowStride + baseRowHeight
    : 0;
  const paddingBottom = shouldVirtualize
    ? Math.max(0, totalHeight - paddingTop - visibleHeight)
    : 0;

  // Animation is disabled for better performance
  const shouldShowAnimation = false;

  const rowMeasureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const nextHeight = node.getBoundingClientRect().height;
    if (nextHeight > 0 && nextHeight !== rowHeight) {
      setRowHeight(nextHeight);
    }
  }, [rowHeight]);

  // Initialize viewport size
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const update = () => {
      setViewportHeight(container.clientHeight || 0);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Handle scroll position restoration and scroll to playing track on first load
  useEffect(() => {
    if (!isInitialMountRef.current) return;
    
    // Defer to after render when row height is known
    const timer = setTimeout(() => {
      if (!scrollContainerRef.current) return;
      
      if (isFirstLoad && currentTrackIndex >= 0 && currentTrackIndex < tracks.length) {
        // First app load: scroll to the currently playing track
        const container = scrollContainerRef.current;
        const itemTop = currentTrackIndex * rowStride;
        const itemBottom = itemTop + baseRowHeight;
        const targetTop = itemBottom - container.clientHeight / 2; // Center the track
        const maxTop = Math.max(0, totalHeight - container.clientHeight);
        const clampedTop = Math.max(0, Math.min(targetTop, maxTop));
        
        container.scrollTop = clampedTop;
        setScrollTop(clampedTop);
        logger.debug(`[LibraryView] First load - scrolled to playing track ${currentTrackIndex + 1} at position ${clampedTop}`);
      } else if (savedScrollPosition > 0) {
        // From other view: restore saved scroll position
        scrollContainerRef.current.scrollTop = savedScrollPosition;
        setScrollTop(savedScrollPosition);
        logger.debug(`[LibraryView] Returned from other view - restored scroll position: ${savedScrollPosition}`);
      }

      isInitialMountRef.current = false;
    }, 50); // Small delay to ensure row height is calculated

    return () => clearTimeout(timer);
  }, [isFirstLoad, currentTrackIndex, tracks.length, rowStride, baseRowHeight, totalHeight, savedScrollPosition]);

  // Save scroll position on unmount
  useEffect(() => {
    return () => {
      if (scrollContainerRef.current) {
        const finalScrollPosition = scrollContainerRef.current.scrollTop;
        onScrollPositionChange?.(finalScrollPosition, dataSource);
        logger.debug(`[LibraryView] Saved scroll position on unmount: ${finalScrollPosition} (${dataSource})`);
      }
    };
  }, [onScrollPositionChange, dataSource]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const style = window.getComputedStyle(list);
    const gapValue = parseFloat(style.rowGap || style.gap || '0');
    if (!Number.isNaN(gapValue) && gapValue !== rowGap) {
      setRowGap(gapValue);
    }
  }, [isEditMode, rowGap, tracks.length]);

  useEffect(() => {
    setRowHeight(0);
  }, [isEditMode]);

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
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;
      const itemTop = currentTrackInFilteredIndex * rowStride;
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
        targetTop = itemTop < viewTop ? itemTop : itemBottom - container.clientHeight;
      } else {
        targetTop = isNext ? itemBottom - container.clientHeight : itemTop;
      }

      const maxTop = Math.max(0, totalHeight - container.clientHeight);
      const clampedTop = Math.max(0, Math.min(targetTop, maxTop));

      logger.debug(`[LibraryView] Auto-locating to track ${currentTrackInFilteredIndex + 1}`);
      container.scrollTo({ top: clampedTop, behavior: 'smooth' });
      previousTrackIndexRef.current = currentTrackInFilteredIndex;
      setShowLocateButton(false);
    }, 0);

    return () => clearTimeout(timer);
  }, [autoLocateToken, currentTrackInFilteredIndex, rowStride, baseRowHeight, totalHeight, isFocusMode]);

  // Update sliding highlight position when current track changes
  useEffect(() => {
    if (isEditMode || !currentTrackId || displayTracks.length === 0) {
      setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
      return;
    }

    const updateHighlight = () => {
      let currentTrackElement: HTMLElement | null = null;

      if (filterType === 'default') {
        currentTrackElement = listRef.current?.querySelector(
          `[data-track-index="${currentTrackInDisplayIndex}"]`
        ) as HTMLElement | null;
      } else {
        const isCurrentInCategory = categoryFilteredTracks.some(t => t.id === currentTrackId);
        if (isCurrentInCategory && listRef.current) {
          const element = listRef.current.querySelector(
            `[data-track-index="${currentTrackInDisplayIndex}"]`
          ) as HTMLElement | null;
          if (element) {
            currentTrackElement = element;
          }
        }
      }

      if (currentTrackElement) {
        setHighlightStyle({
          top: currentTrackElement.offsetTop,
          height: currentTrackElement.offsetHeight,
          opacity: 1
        });
        return;
      }

      setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
    };

    const timer = setTimeout(() => {
      requestAnimationFrame(updateHighlight);
    }, filterType !== 'default' ? 150 : 0);

    return () => clearTimeout(timer);
  }, [currentTrackId, currentTrackInDisplayIndex, displayTracks.length, isEditMode, rowStride, baseRowHeight, filterType, categoryFilteredTracks]);

  // Hide highlight immediately when leaving default view
  useEffect(() => {
    if (filterType !== 'default') {
      logger.debug(`[LibraryView] Filter type changed to ${filterType}, hiding highlight temporarily`);
      setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
    } else {
    }
  }, [filterType]);

  // Update sliding highlight position when current track changes
  useEffect(() => {
    if (isEditMode || !currentTrackId || displayTracks.length === 0) {
      setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
      return;
    }

    // Increment the update ID
    const currentUpdateId = ++highlightUpdateIdRef.current;

    const updateHighlight = (retryCount = 0) => {
      // Check if this is still the latest update
      if (currentUpdateId !== highlightUpdateIdRef.current) {
        return;
      }

      let currentTrackElement: HTMLElement | null = null;

      if (filterType === 'default') {
        // Default mode: use listRef
        currentTrackElement = listRef.current?.querySelector(
          `[data-track-index="${currentTrackInDisplayIndex}"]`
        ) as HTMLElement | null;
      } else {
        // Album/Artist mode: search in scrollContainer instead
        const isCurrentInCategory = categoryFilteredTracks.some(t => t.id === currentTrackId);
        if (isCurrentInCategory && scrollContainerRef.current) {
          // Search in scrollContainer instead of listRef
          const element = scrollContainerRef.current.querySelector(
            `[data-track-index="${currentTrackInDisplayIndex}"]`
          ) as HTMLElement | null;
          if (element) {
            currentTrackElement = element;
          }
        }
      }

      // Double-check this is still the latest update before setting state
      if (currentUpdateId !== highlightUpdateIdRef.current) {
        return;
      }

      if (currentTrackElement) {
        setHighlightStyle({
          top: currentTrackElement.offsetTop,
          height: currentTrackElement.offsetHeight,
          opacity: 1
        });
        return;
      }

      // If not found and in category mode, try again after a delay
      if (filterType !== 'default' && retryCount < 30) {
        const nextRetry = retryCount + 1;
        const delay = 50 * nextRetry;
        setTimeout(() => {
          requestAnimationFrame(() => updateHighlight(nextRetry));
        }, delay);
      } else {
        setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
      }
    };

    // Delay execution to ensure DOM is ready
    const delay = filterType !== 'default' ? 150 : 0;
    const timer = setTimeout(() => {
      requestAnimationFrame(() => updateHighlight(0));
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [currentTrackId, currentTrackInDisplayIndex, displayTracks.length, isEditMode, filterType, categoryFilteredTracks]);

  // Check if current track is visible in viewport
  const isCurrentTrackVisible = useCallback(() => {
    if (currentTrackInFilteredIndex < 0 || !scrollContainerRef.current) return false;
    const container = scrollContainerRef.current;
    const itemTop = currentTrackInFilteredIndex * rowStride;
    const itemBottom = itemTop + baseRowHeight;
    const viewportTop = scrollTop;
    const viewportBottom = scrollTop + container.clientHeight;
    return itemBottom >= viewportTop && itemTop <= viewportBottom;
  }, [currentTrackInFilteredIndex, rowStride, baseRowHeight, scrollTop]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = e.currentTarget.scrollTop;
    setScrollTop(newScrollTop);
    // Notify parent of scroll position change
    onScrollPositionChange?.(newScrollTop, dataSource);
    
    // Check if current playing track is visible (only if it's in filtered results)
    const targetTracks = filterType === 'default' ? filteredTracks : categoryFilteredTracks;
    if (currentTrackInFilteredIndex >= 0 && targetTracks.length > 0) {
      const container = scrollContainerRef.current;
      if (container) {
        const itemTop = currentTrackInFilteredIndex * rowStride;
        const itemBottom = itemTop + baseRowHeight;
        const viewportTop = newScrollTop;
        const viewportBottom = newScrollTop + container.clientHeight;
        
        // Show locate button if current track is out of viewport
        const isVisible = itemBottom >= viewportTop && itemTop <= viewportBottom;
        setShowLocateButton(!isVisible);
      }
    } else {
      setShowLocateButton(false);
    }
  }, [onScrollPositionChange, currentTrackInFilteredIndex, filteredTracks.length, categoryFilteredTracks.length, rowStride, baseRowHeight, filterType]);

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
    const targetTracks = executedSearchQuery ? filteredTracks : tracks;
    
    if (selectedIds.size === targetTracks.length) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Select all (filtered tracks or all tracks)
      setSelectedIds(new Set(targetTracks.map(t => t.id)));
    }
  }, [selectedIds.size, tracks, filteredTracks, executedSearchQuery]);

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
    setShowDeleteConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (trackToDelete) {
      await onRemoveTrack(trackToDelete);
      setShowDeleteConfirm(false);
      setTrackToDelete(null);
    }
  }, [trackToDelete, onRemoveTrack]);

  const confirmBatchDelete = useCallback(() => {
    setShowBatchDeleteConfirm(true);
  }, []);

  const handleConfirmBatchDelete = useCallback(async () => {
    const idsToRemove = Array.from(selectedIds);

    logger.debug(`[LibraryView] Removing ${idsToRemove.length} tracks...`);

    if (onRemoveMultipleTracks) {
      await onRemoveMultipleTracks(idsToRemove);
      logger.debug('[LibraryView] ✓ Batch removal complete');
    } else {
      logger.debug('[LibraryView] Using sequential removal (fallback)...');
      for (let i = 0; i < idsToRemove.length; i++) {
        const id = idsToRemove[i];
        logger.debug(`[LibraryView] Removing track ${i + 1}/${idsToRemove.length}`);
        await onRemoveTrack(id);
      }
      logger.debug('[LibraryView] Sequential removal complete');
    }

    setSelectedIds(new Set());
    setIsEditMode(false);
    setShowBatchDeleteConfirm(false);
  }, [selectedIds, onRemoveMultipleTracks, onRemoveTrack]);

  const handleRemoveSelected = useCallback(() => {
    if (selectedIds.size > 0) {
      confirmBatchDelete();
    }
  }, [selectedIds, confirmBatchDelete]);

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
    if (currentTrackInFilteredIndex < 0 || !scrollContainerRef.current) return;
    
    const container = scrollContainerRef.current;
    const itemTop = currentTrackInFilteredIndex * rowStride;
    const itemBottom = itemTop + baseRowHeight;
    const targetTop = itemBottom - container.clientHeight / 2; // Center the track
    const maxTop = Math.max(0, totalHeight - container.clientHeight);
    const clampedTop = Math.max(0, Math.min(targetTop, maxTop));
    
    container.scrollTo({
      top: clampedTop,
      behavior: 'smooth'
    });
    setShowLocateButton(false);
    logger.debug(`[LibraryView] Located to current track ${currentTrackIndex + 1} (filtered index: ${currentTrackInFilteredIndex})`);
  }, [currentTrackInFilteredIndex, currentTrackIndex, rowStride, baseRowHeight, totalHeight]);

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

      {/* 固定的标题部分 */}
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold mb-2" style={{ color: 'var(--theme-text-primary, #fff)' }}>{i18n.t('library.title')}</h1>
          <p style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>
            {importProgress ? (
              `${i18n.t('library.importing')} ${importProgress.loaded}/${importProgress.total}`
            ) : dataSource === 'cloud' && loadProgress ? (
              `${i18n.t('library.loadingMetadata')} ${loadProgress.loaded}/${loadProgress.total}`
            ) : (
              <>
                {filteredTracks.length} {i18n.t('library.trackCount')}
                {executedSearchQuery && filteredTracks.length !== displayTracks.length && ` (${i18n.t('library.of')} ${displayTracks.length})`}
              </>
            )}
          </p>
          {(importProgress || (dataSource === 'cloud' && loadProgress)) && (
            <div className="mt-2 w-48 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.backgroundCard }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${((importProgress || loadProgress)!.loaded / (importProgress || loadProgress)!.total) * 100}%`,
                  backgroundColor: colors.primary,
                }}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isEditMode && (
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectAll}
                className="px-3 py-2 rounded-lg text-sm transition-all"
                style={{ color: colors.textSecondary, backgroundColor: 'transparent' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textPrimary; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.textSecondary; }}
              >
                {selectedIds.size === tracks.length ? i18n.t('library.cancel') : i18n.t('library.selectAll')}
              </button>
              {selectedIds.size > 0 && (
                <button
                  onClick={handleRemoveSelected}
                  className="px-3 py-2 rounded-lg text-sm transition-all"
                  style={{ backgroundColor: `${colors.error}20`, color: colors.error }}
                >
                  {i18n.t('library.deleteSelected')} ({selectedIds.size})
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => {
              setIsEditMode(!isEditMode);
              if (!isEditMode) setSelectedIds(new Set());
            }}
            className="w-10 h-10 rounded-xl transition-all flex items-center justify-center"
            style={{
              backgroundColor: isEditMode ? colors.primary : colors.backgroundCard,
              color: isEditMode ? '#fff' : colors.textSecondary,
              boxShadow: isEditMode ? `0 0 20px ${colors.glowColor}` : 'none',
            }}
          >
            <span className="material-symbols-outlined">{isEditMode ? 'check' : 'edit'}</span>
          </button>
          <div className="flex items-center rounded-xl border" style={{ borderColor: colors.borderLight, backgroundColor: colors.backgroundCard }}>
            <button
              onClick={() => {
                onFilterTypeChange('default');
                onCategoryChange(null);
              }}
              className="w-10 h-[38px] rounded-l-lg text-sm transition-all flex items-center justify-center"
              style={{
                backgroundColor: filterType === 'default' ? colors.primary : 'transparent',
                color: filterType === 'default' ? '#fff' : colors.textSecondary,
                boxShadow: filterType === 'default' ? `0 0 20px ${colors.glowColor}` : 'none',
              }}
            >
              <span className="material-symbols-outlined text-xl">list</span>
            </button>
            <button
              onClick={() => {
                onFilterTypeChange('album');
                onCategoryChange(uniqueAlbums.length > 0 ? uniqueAlbums[0].name : null);
              }}
              className="w-10 h-[38px] text-sm transition-all flex items-center justify-center"
              style={{
                backgroundColor: filterType === 'album' ? colors.primary : 'transparent',
                color: filterType === 'album' ? '#fff' : colors.textSecondary,
                boxShadow: filterType === 'album' ? `0 0 20px ${colors.glowColor}` : 'none',
              }}
            >
              <span className="material-symbols-outlined text-xl">album</span>
            </button>
            <button
              onClick={() => {
                onFilterTypeChange('artist');
                onCategoryChange(uniqueArtists.length > 0 ? uniqueArtists[0].name : null);
              }}
              className="w-10 h-[38px] rounded-r-lg text-sm transition-all flex items-center justify-center"
              style={{
                backgroundColor: filterType === 'artist' ? colors.primary : 'transparent',
                color: filterType === 'artist' ? '#fff' : colors.textSecondary,
                boxShadow: filterType === 'artist' ? `0 0 20px ${colors.glowColor}` : 'none',
              }}
            >
              <span className="material-symbols-outlined text-xl">artist</span>
            </button>
          </div>
          <div className="flex items-center rounded-xl border" style={{ borderColor: colors.borderLight, backgroundColor: colors.backgroundCard }}>
            <button
              onClick={() => {
                if (dataSource !== 'local') {
                  onFilterTypeChange('default');
                  onCategoryChange(null);
                  onLocalRestore();
                  onDataSourceChange('local');
                }
              }}
              className="w-10 h-[38px] rounded-l-lg text-xs transition-all flex items-center justify-center"
              style={{
                backgroundColor: dataSource === 'local' ? colors.primary : 'transparent',
                color: dataSource === 'local' ? '#fff' : colors.textSecondary,
                boxShadow: dataSource === 'local' ? `0 0 20px ${colors.glowColor}` : 'none',
              }}
            >
              <span className="material-symbols-outlined text-lg">hard_drive</span>
            </button>
            <button
              onClick={async () => {
                if (dataSource === 'cloud') return;
                if (!webdavClient.hasConfig()) {
                  notify(i18n.t('settingsDialog.webdavTitle'), i18n.t('settingsDialog.webdavFillAll'));
                  onNavigateToSettings?.('webdav');
                  return;
                }
                onDataSourceChange('cloud');
                const loadedTracks = await loadWebDAVFiles();
                onWebdavTracksChange(loadedTracks);
                onCloudLoad(loadedTracks);
              }}
              className="w-10 h-[38px] rounded-r-lg text-xs transition-all flex items-center justify-center"
              style={{
                backgroundColor: dataSource === 'cloud' ? colors.primary : 'transparent',
                color: dataSource === 'cloud' ? '#fff' : colors.textSecondary,
                boxShadow: dataSource === 'cloud' ? `0 0 20px ${colors.glowColor}` : 'none',
              }}
            >
              <span className="material-symbols-outlined text-lg">cloud</span>
            </button>
          </div>
        </div>
      </div>

      {filterType === 'default' && (
        <div className="flex-shrink-0">
          <div className="grid gap-4 px-4 py-2 text-xs font-bold uppercase tracking-widest border-b mb-2 grid-cols-[48px_1fr_1fr_100px]" style={{ color: colors.textMuted, borderColor: colors.borderLight }}>
            <span>#</span><span>{i18n.t('library.titleCol')}</span><span className="pl-8">{i18n.t('library.albumCol')}</span><span className="text-right">{isEditMode ? i18n.t('library.actionCol') : i18n.t('library.timeCol')}</span>
          </div>
        </div>
      )}

      {/* 可滚动的歌曲列表 */}
      {filterType === 'default' ? (
        <div
          className="flex-1 relative min-h-0 overflow-hidden"
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
                style={{ paddingTop, paddingBottom }}
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
                  const isUnavailable = track.available === false;
                  const isSelected = selectedIds.has(track.id);
                  const isCurrentTrack = track.id === currentTrackId;
                  const isDragged = draggedIndex === filteredIndex;
                  const isDragOver = dragOverIndex === filteredIndex;
                  const canDrag = isEditMode && !isUnavailable && !executedSearchQuery; // Only allow drag when not searching
                  // Only apply animation when shouldShowAnimation is true
                  const animationStyle = shouldShowAnimation
                    ? { animation: `fadeInUp 0.3s ease-out ${filteredIndex * 0.03}s both` }
                    : undefined;

                  return (
                    <div
                      key={track.id}
                      ref={idx === 0 ? rowMeasureRef : undefined}
                        data-track-index={filteredIndex}
                        draggable={canDrag}
                        onDragStart={(e) => handleTrackDragStart(e, filteredIndex)}
                        onDragOver={(e) => handleTrackDragOver(e, filteredIndex)}
                        onDragEnd={handleTrackDragEnd}
                        onClick={() => {
                          if (isEditMode || isUnavailable) return;
                          if (dataSource === 'cloud' && onCloudTrackSelect) {
                            onCloudTrackSelect(filteredIndex);
                          } else {
                            onTrackSelect(filteredIndex);
                          }
                        }}
                        style={{
                          ...animationStyle,
                          backgroundColor: isDragged ? 'transparent' : isUnavailable ? 'transparent' : isSelected ? `${colors.error}1a` : isCurrentTrack ? `${colors.primary}15` : 'transparent',
                         border: isSelected ? `1px solid ${colors.error}30` : '1px solid transparent',
                       }}
                       className={`grid gap-4 px-4 py-3 rounded-xl transition-all items-center relative z-10 grid-cols-[48px_1fr_1fr_100px] ${
                           isDragged ? 'opacity-40' : canDrag ? 'cursor-move' : isEditMode || isUnavailable ? 'cursor-default' : 'cursor-pointer'
                         }`}
                       onMouseEnter={e => {
                         if (!isDragged && !isUnavailable && !isSelected && !isCurrentTrack) {
                           e.currentTarget.style.backgroundColor = colors.backgroundCard;
                         }
                       }}
                       onMouseLeave={e => {
                         if (!isDragged && !isUnavailable && !isSelected && !isCurrentTrack) {
                           e.currentTarget.style.backgroundColor = 'transparent';
                         }
                       }}
                     >
                      <div className="text-sm font-medium" style={{ opacity: 0.5, color: isCurrentTrack ? colors.primary : colors.textSecondary }}>
                        {isEditMode && !isUnavailable ? (
                          <span className="material-symbols-outlined">drag_handle</span>
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
                          <p className="text-sm font-semibold truncate" style={{ color: isCurrentTrack ? colors.primary : colors.textPrimary }}>
                            {track.title}
                            {isUnavailable && <span className="text-xs ml-2" style={{ color: '#facc15' }}>{i18n.t('library.needReimport')}</span>}
                          </p>
                          <p className="text-xs truncate" style={{ color: colors.textMuted }}>{track.artist}</p>
                        </div>
                      </div>
                      <div className="text-sm truncate pl-8" style={{ color: colors.textMuted }}>{track.album}</div>
                      {isEditMode ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              confirmDelete(track.id);
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                            style={{ color: colors.error }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = `${colors.error}1a`; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <span className="material-symbols-outlined text-lg">delete</span>
                          </button>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectOne(track.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded cursor-pointer"
                            style={{ accentColor: colors.primary }}
                          />
                        </div>
                      ) : (
                        <div className="text-sm text-right tabular-nums" style={{ color: colors.textMuted }}>
                          {Math.floor(track.duration / 60)}:{Math.floor(track.duration % 60).toString().padStart(2, '0')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : executedSearchQuery ? (
              <div className="py-20 text-center" style={{ opacity: 0.4, color: colors.textSecondary }}>
                <span className="material-symbols-outlined text-6xl mb-4 block">search_off</span>
                <p className="text-xl font-medium">{i18n.t('library.noMatchingTracks')}</p>
                <p className="text-sm mt-2">{i18n.t('library.tryAdjustingSearch')}</p>
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
          <div className="w-64 flex-shrink-0 overflow-y-auto no-scrollbar">
            <div className="text-xs font-bold uppercase tracking-widest mb-2 px-2" style={{ color: colors.textMuted }}>
              {filterType === 'artist' ? '歌手' : '专辑'}
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
                        src={artist.coverUrl}
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
                        src={album.coverUrl}
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
               <div className="grid gap-4 px-4 py-2 text-xs font-bold uppercase tracking-widest border-b mb-2 grid-cols-[48px_1fr_1fr_100px]" style={{ color: colors.textMuted, borderColor: colors.borderLight }}>
                 <span>#</span><span>{i18n.t('library.titleCol')}</span><span className="pl-8">{i18n.t('library.albumCol')}</span><span className="text-right">{isEditMode ? i18n.t('library.actionCol') : i18n.t('library.timeCol')}</span>
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
                     style={{ paddingTop, paddingBottom }}
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
                           if (dataSource === 'cloud' && onCloudTrackSelect) {
                             onCloudTrackSelect(filteredIndex);
                           } else {
                             onTrackSelect(filteredIndex);
                           }
                         }}
                             className="grid gap-4 px-4 py-3 rounded-xl transition-all items-center relative z-10 grid-cols-[48px_1fr_1fr_100px]"
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
                               <span className="material-symbols-outlined text-sm">block</span>
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
                                   confirmDelete(track.id);
                                 }}
                                 className="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all"
                               >
                                 <span className="material-symbols-outlined text-lg">delete</span>
                               </button>
<input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSelectOne(track.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-4 h-4 rounded cursor-pointer"
                                  style={{ accentColor: colors.primary, borderColor: colors.borderLight, backgroundColor: colors.backgroundCard }}
                                />
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
                    <p className="text-xl font-medium">{filterType === 'artist' ? '请选择歌手' : '请选择专辑'}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating locate button - shows when current track is out of viewport */}
      {showLocateButton && currentTrackInFilteredIndex >= 0 && (
        <button
          onClick={handleLocateToCurrentTrack}
          className="absolute bottom-6 right-28 w-9 h-9 rounded-lg shadow-md flex items-center justify-center transition-all z-20 animate-fadeIn"
          style={{ backgroundColor: colors.backgroundCard, color: colors.textSecondary }}
          title={i18n.t('library.locateToCurrent')}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.textPrimary; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textSecondary; }}
        >
          <span className="material-symbols-outlined text-lg">my_location</span>
        </button>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl" style={{ backgroundColor: colors.backgroundDark, border: `1px solid ${colors.borderLight}` }}>
            <h3 className="text-lg font-semibold mb-2" style={{ color: colors.textPrimary }}>{i18n.t('library.deleteConfirmTitle')}</h3>
            <p className="mb-6" style={{ color: colors.textSecondary }}>{i18n.t('library.deleteConfirmMessage')}</p>
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
          </div>
        </div>
      )}

      {/* Batch delete confirmation dialog */}
      {showBatchDeleteConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl" style={{ backgroundColor: colors.backgroundDark, border: `1px solid ${colors.borderLight}` }}>
            <h3 className="text-lg font-semibold mb-2" style={{ color: colors.textPrimary }}>{i18n.t('library.deleteConfirmTitle')}</h3>
            <p className="mb-6" style={{ color: colors.textSecondary }}>
              {i18n.t('library.deleteSelectedConfirmMessage').replace('{count}', String(selectedIds.size))}
            </p>
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
          </div>
        </div>
      )}
    </div>
  );
});

LibraryView.displayName = 'LibraryView';

export default LibraryView;
