import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { Track } from '../types';
import { logger } from '../services/logger';
import { getDesktopAPI } from '../services/desktopAdapter';
import TrackCover from './TrackCover';

interface LibraryViewProps {
  tracks: Track[];
  currentTrackIndex: number;
  onTrackSelect: (index: number) => void;
  onRemoveTrack: (trackId: string) => void;
  onRemoveMultipleTracks?: (trackIds: string[]) => void; // Batch removal
  onDropFiles?: (files: File[]) => void; // Handle dropped files (Web mode or fallback)
  onDropFilePaths?: (filePaths: { path: string; name: string }[]) => void; // Handle dropped file paths (Electron mode)
  isFocusMode?: boolean; // Check if focus mode (lyrics overlay) is active
  inputValue?: string; // Search input value from parent (shared between views)
  searchTrigger?: number; // Trigger to execute search
  savedScrollPosition?: number; // Saved scroll position from parent
  onScrollPositionChange?: (position: number) => void; // Callback to save scroll position
  isFirstLoad?: boolean; // Whether this is the initial app load (should scroll to playing track)
  autoLocateToken?: number; // Trigger auto-locate only when track switch action occurs
}

const LibraryView: React.FC<LibraryViewProps> = memo(({
  tracks,
  currentTrackIndex,
  onTrackSelect,
  onRemoveTrack,
  onRemoveMultipleTracks,
  onDropFiles,
  onDropFilePaths,
  isFocusMode = false,
  inputValue: externalInputValue = '',
  searchTrigger = 0,
  savedScrollPosition = 0,
  onScrollPositionChange,
  isFirstLoad = false,
  autoLocateToken = 0
}) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false); // New: Drag state
  const [executedSearchQuery, setExecutedSearchQuery] = useState(''); // Local executed search query
  const [highlightStyle, setHighlightStyle] = useState<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 0,
    opacity: 0
  });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(0);
  const [rowGap, setRowGap] = useState(8);
  const [showLocateButton, setShowLocateButton] = useState(false);
  const previousTrigger = useRef(searchTrigger);

  // Execute search when trigger changes (from Enter key in Sidebar)
  useEffect(() => {
    if (searchTrigger !== previousTrigger.current) {
      previousTrigger.current = searchTrigger;
      setExecutedSearchQuery(externalInputValue);
    }
  }, [searchTrigger, externalInputValue]);

  // Track if animation has already played for current tracks
  const hasAnimatedRef = useRef(false);
  const previousTracksRef = useRef<Track[]>([]);
  const isInitialMountRef = useRef(true);

  // Filter tracks based on executed search query
  const filteredTracks = useMemo(() => {
    if (!executedSearchQuery.trim()) return tracks;
    const query = executedSearchQuery.toLowerCase();
    return tracks.filter(track =>
      track.title.toLowerCase().includes(query) ||
      track.artist.toLowerCase().includes(query) ||
      track.album.toLowerCase().includes(query)
    );
  }, [tracks, executedSearchQuery]);

  // Check if tracks actually changed (by comparing IDs)
  const didTracksChange = useCallback((prevTracks: Track[], newTracks: Track[]) => {
    if (prevTracks.length !== newTracks.length) return true;
    return prevTracks.some((track, index) => track.id !== newTracks[index]?.id);
  }, []);

  // Ref for the scrollable container
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousTrackIndexRef = useRef<number>(-1); // Track previous track index
  const lastHandledAutoLocateTokenRef = useRef<number>(autoLocateToken);
  const overscan = 6;

  const baseRowHeight = rowHeight || 64;
  const rowStride = baseRowHeight + rowGap;
  const totalHeight = filteredTracks.length > 0
    ? (filteredTracks.length - 1) * rowStride + baseRowHeight
    : 0;
  const shouldVirtualize = filteredTracks.length > 200 && viewportHeight > 0;
  const startIndex = shouldVirtualize
    ? Math.max(0, Math.floor(scrollTop / rowStride) - overscan)
    : 0;
  const endIndex = shouldVirtualize
    ? Math.min(filteredTracks.length, Math.ceil((scrollTop + viewportHeight) / rowStride) + overscan)
    : filteredTracks.length;
  const visibleTracks = shouldVirtualize ? filteredTracks.slice(startIndex, endIndex) : filteredTracks;
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
        onScrollPositionChange?.(finalScrollPosition);
        logger.debug(`[LibraryView] Saved scroll position on unmount: ${finalScrollPosition}`);
      }
    };
  }, [onScrollPositionChange]);

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
    if (currentTrackIndex < 0) return -1;
    const currentTrackId = tracks[currentTrackIndex]?.id;
    return filteredTracks.findIndex(t => t.id === currentTrackId);
  }, [currentTrackIndex, tracks, filteredTracks]);

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
    if (isEditMode || currentTrackIndex < 0 || tracks.length === 0) {
      setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
      return;
    }

    const updateHighlight = () => {
      const currentTrackElement = listRef.current?.querySelector(
        `[data-track-index="${currentTrackIndex}"]`
      ) as HTMLElement | null;

      if (currentTrackElement) {
        setHighlightStyle({
          top: currentTrackElement.offsetTop,
          height: currentTrackElement.offsetHeight,
          opacity: 1
        });
        return;
      }

      setHighlightStyle({
        top: currentTrackIndex * rowStride,
        height: baseRowHeight,
        opacity: 1
      });
    };

    const raf = requestAnimationFrame(updateHighlight);
    return () => cancelAnimationFrame(raf);
  }, [currentTrackIndex, tracks.length, isEditMode, rowStride, baseRowHeight]);

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
    onScrollPositionChange?.(newScrollTop);
    
    // Check if current playing track is visible (only if it's in filtered results)
    if (currentTrackInFilteredIndex >= 0 && filteredTracks.length > 0) {
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
  }, [onScrollPositionChange, currentTrackInFilteredIndex, filteredTracks.length, rowStride, baseRowHeight]);

  // Handle drag events
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) {
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

  const handleRemoveSelected = useCallback(async () => {
    // Convert Set to Array
    const idsToRemove = Array.from(selectedIds);

    logger.debug(`[LibraryView] Removing ${idsToRemove.length} tracks...`);

    // Use batch removal if available (much faster and avoids state inconsistencies)
    if (onRemoveMultipleTracks) {
      await onRemoveMultipleTracks(idsToRemove);
      logger.debug('[LibraryView] ✓ Batch removal complete');
    } else {
      // Fallback to sequential removal
      logger.debug('[LibraryView] Using sequential removal (fallback)...');
      for (let i = 0; i < idsToRemove.length; i++) {
        const id = idsToRemove[i];
        logger.debug(`[LibraryView] Removing track ${i + 1}/${idsToRemove.length}`);
        await onRemoveTrack(id);
      }
      logger.debug('[LibraryView] Sequential removal complete');
    }

    // Clear selection and exit edit mode
    setSelectedIds(new Set());
    setIsEditMode(false);
  }, [selectedIds, onRemoveMultipleTracks, onRemoveTrack]);

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
  }, [currentTrackIndex, showLocateButton, isCurrentTrackVisible]);

  return (
    <div
      className={`max-w-5xl mx-auto w-full flex flex-col h-full relative transition-all duration-300 ${
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
            <p className="text-2xl font-bold text-primary mb-2">拖放音频文件到此处</p>
            <p className="text-sm text-white/60">支持 FLAC, MP3, M4A, WAV 格式</p>
          </div>
        </div>
      )}

      {/* 固定的标题部分 */}
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold mb-2">Library</h1>
          <p className="text-white/40">
            {filteredTracks.length} Tracks in your collection
            {executedSearchQuery && filteredTracks.length !== tracks.length && ` (of ${tracks.length})`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEditMode && (
            <>
              <button
                onClick={toggleSelectAll}
                className="px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/10 transition-all"
              >
                {selectedIds.size === tracks.length ? 'Cancel' : 'Select All'}
              </button>
              {selectedIds.size > 0 && (
                <button
                  onClick={handleRemoveSelected}
                  className="px-3 py-2 rounded-lg text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
                >
                  Delete Selected ({selectedIds.size})
                </button>
              )}
            </>
          )}
          <button
            onClick={() => {
              setIsEditMode(!isEditMode);
              if (!isEditMode) setSelectedIds(new Set());
            }}
            className={`w-10 h-10 rounded-xl transition-all flex items-center justify-center ${
              isEditMode
                ? 'bg-primary text-white shadow-lg shadow-primary/25'
                : 'bg-white/10 text-white/60 hover:bg-primary/20 hover:text-primary'
            }`}
            title={isEditMode ? 'Completed' : 'Edit Mode'}
          >
            <span className="material-symbols-outlined">{isEditMode ? 'check' : 'edit'}</span>
          </button>
        </div>
      </div>

      <div className="flex-shrink-0">
        <div className="grid gap-4 px-4 py-2 text-xs font-bold text-white/30 uppercase tracking-widest border-b border-white/5 mb-2 grid-cols-[48px_1fr_1fr_100px]">
        <span>#</span><span>Title</span><span className="pl-8">Album</span><span className="text-right">Time</span>
        </div>
      </div>
      

      {/* 可滚动的歌曲列表 */}
      <div
        className="flex-1 relative min-h-0 overflow-hidden"
        style={{ marginLeft: -24, marginRight: -24, paddingLeft: 24, paddingRight: 24 }}
      >
        {/* Sliding highlight overlay (outside scroll clipping) */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute rounded-xl pointer-events-none transition-[transform,height,opacity] duration-150 ease-out glass-soft shadow-xl border border-white/10"
            style={{
              transform: `translateY(${highlightStyle.top - scrollTop}px)`,
              height: `${highlightStyle.height}px`,
              opacity: highlightStyle.opacity,
              left: 24,
              right: 24,
              backgroundColor: 'rgba(59, 130, 246, 0.15)'
            }}
          />
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
              {visibleTracks.map((track, idx) => {
                const filteredIndex = startIndex + idx;
                const originalIndex = tracks.findIndex(t => t.id === track.id);
                const isUnavailable = track.available === false;
                const isSelected = selectedIds.has(track.id);
                const isCurrentTrack = originalIndex === currentTrackIndex;
                // Only apply animation when shouldShowAnimation is true
                const animationStyle = shouldShowAnimation 
                  ? { animation: `fadeInUp 0.3s ease-out ${filteredIndex * 0.03}s both` } 
                  : undefined;

                return (
                  <div
                    key={track.id}
                    ref={idx === 0 ? rowMeasureRef : undefined}
                    data-track-index={originalIndex}  // Use original index for auto-scroll
                    onClick={() => !isEditMode && !isUnavailable && onTrackSelect(originalIndex)}
                    style={animationStyle}
                    className={`grid gap-4 px-4 py-3 rounded-xl transition-all items-center relative z-10 ${
                      isEditMode ? 'grid-cols-[48px_1fr_1fr_100px_48px_48px]' : 'grid-cols-[48px_1fr_1fr_100px]'
                    } ${
                      isUnavailable
                        ? 'opacity-40 bg-white/5'
                        : isSelected
                        ? 'bg-red-500/10 border border-red-500/30'
                        : isCurrentTrack
                        ? 'text-primary'
                        : 'hover:bg-white/5'
                    } ${isEditMode || isUnavailable ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                  <div className="text-sm font-medium opacity-50">
                    {filteredIndex + 1}
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
                        {isUnavailable && <span className="text-xs text-yellow-400 ml-2">(需要重新导入)</span>}
                      </p>
                      <p className="text-xs opacity-50 truncate">{track.artist}</p>
                    </div>
                  </div>
                  <div className="text-sm opacity-50 truncate pl-8">{track.album}</div>
                  <div className="text-sm opacity-50 text-right tabular-nums">
                    {Math.floor(track.duration / 60)}:{Math.floor(track.duration % 60).toString().padStart(2, '0')}
                  </div>
                  {isEditMode && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveTrack(track.id);
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
                        className="w-4 h-4 rounded border-white/20 bg-white/10 checked:bg-primary checked:border-primary cursor-pointer"
                      />
                    </>
                  )}
                </div>
              );
              })}
            </div>
          ) : executedSearchQuery ? (
            <div className="py-20 text-center opacity-40">
              <span className="material-symbols-outlined text-6xl mb-4 block">search_off</span>
              <p className="text-xl font-medium">No matching tracks</p>
              <p className="text-sm mt-2">Try adjusting your search query</p>
            </div>
          ) : (
            <div className="py-20 text-center opacity-20 border-2 border-dashed border-white/10 rounded-2xl">
              <span className="material-symbols-outlined text-6xl mb-4 block">library_music</span>
              <p className="text-xl font-medium">No tracks imported yet</p>
              <p className="text-sm">Use the sidebar to import your audio files</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating locate button - shows when current track is out of viewport */}
      {showLocateButton && currentTrackInFilteredIndex >= 0 && (
        <button
          onClick={handleLocateToCurrentTrack}
          className="absolute bottom-6 right-28 w-9 h-9 rounded-lg bg-white/10 text-white/60 shadow-md flex items-center justify-center hover:bg-white/20 hover:text-white transition-all z-20 animate-fadeIn"
          title="定位到当前播放"
        >
          <span className="material-symbols-outlined text-lg">my_location</span>
        </button>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for React.memo
  // Only re-render if these critical props change
  return (
    prevProps.tracks === nextProps.tracks &&
    prevProps.currentTrackIndex === nextProps.currentTrackIndex &&
    prevProps.onTrackSelect === nextProps.onTrackSelect &&
    prevProps.onRemoveTrack === nextProps.onRemoveTrack &&
    prevProps.onRemoveMultipleTracks === nextProps.onRemoveMultipleTracks &&
    prevProps.onDropFiles === nextProps.onDropFiles &&
    prevProps.onDropFilePaths === nextProps.onDropFilePaths &&
    prevProps.isFocusMode === nextProps.isFocusMode &&
    prevProps.inputValue === nextProps.inputValue &&
    prevProps.searchTrigger === nextProps.searchTrigger &&
    prevProps.savedScrollPosition === nextProps.savedScrollPosition &&
    prevProps.isFirstLoad === nextProps.isFirstLoad &&
    prevProps.autoLocateToken === nextProps.autoLocateToken
  );
});

LibraryView.displayName = 'LibraryView';

export default LibraryView;
