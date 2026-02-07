import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Track } from '../types';

interface LibraryViewProps {
  tracks: Track[];
  currentTrackIndex: number;
  onTrackSelect: (index: number) => void;
  onRemoveTrack: (trackId: string) => void;
  onRemoveMultipleTracks?: (trackIds: string[]) => void; // Batch removal
  onDropFiles?: (files: File[]) => void; // Handle dropped files
  isFocusMode?: boolean; // Check if focus mode (lyrics overlay) is active
}

const LibraryView: React.FC<LibraryViewProps> = memo(({
  tracks,
  currentTrackIndex,
  onTrackSelect,
  onRemoveTrack,
  onRemoveMultipleTracks,
  onDropFiles,
  isFocusMode = false
}) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false); // New: Drag state
  const [highlightStyle, setHighlightStyle] = useState<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 0,
    opacity: 0
  });
  const [scrollTop, setScrollTop] = useState(0);

  // Ref for the scrollable container
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousTrackIndexRef = useRef<number>(-1); // Track previous track index

  // Auto-scroll to current track when currentTrackIndex changes
  useEffect(() => {
    // Skip if index is invalid (e.g., during or after batch deletion)
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length || !scrollContainerRef.current) {
      return;
    }

    // Use setTimeout to ensure DOM is fully updated before querying elements
    const timer = setTimeout(() => {
      // Double-check bounds after timeout (in case tracks changed during deletion)
      if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length || !scrollContainerRef.current) {
        console.log(`[LibraryView] Skip auto-scroll: index ${currentTrackIndex} out of bounds [0, ${tracks.length})`);
        return;
      }

      try {
        // Find the current track element
        const trackElements = scrollContainerRef.current.querySelectorAll('[data-track-index]');

        // Safety check: ensure we have enough elements
        if (currentTrackIndex >= trackElements.length) {
          console.warn(`[LibraryView] Skip auto-scroll: only ${trackElements.length} elements available, need index ${currentTrackIndex}`);
          return;
        }

        const currentTrackElement = trackElements[currentTrackIndex] as HTMLElement;

        if (!currentTrackElement) {
          console.warn(`[LibraryView] Skip auto-scroll: element at index ${currentTrackIndex} is null`);
          return;
        }

        // Check if the track is already visible in the viewport
        const containerRect = scrollContainerRef.current.getBoundingClientRect();
        const trackRect = currentTrackElement.getBoundingClientRect();
        const isVisible = (
          trackRect.top >= containerRect.top &&
          trackRect.bottom <= containerRect.bottom
        );

        if (isVisible) {
          console.log(`[LibraryView] Track ${currentTrackIndex + 1} is already visible, no scroll needed`);
          previousTrackIndexRef.current = currentTrackIndex;
          return;
        }

        // Determine scroll direction based on index change
        const isNext = currentTrackIndex > previousTrackIndexRef.current;

        // In focus mode, use 'nearest' to avoid aggressive scrolling that pushes the layout up
        // This provides a smoother, more controlled scroll behavior
        const blockPosition = isFocusMode ? 'nearest' : (isNext ? 'end' : 'start'); // Focus mode: gentle, Next: bottom, Previous: top
        const directionText = isFocusMode ? 'gentle' : (isNext ? 'bottom' : 'top');

        console.log(`[LibraryView] Auto-scrolling to track ${currentTrackIndex + 1} (${directionText}${isFocusMode ? ' (focus mode)' : ''})`);

        // Scroll the track into view with smooth animation
        currentTrackElement.scrollIntoView({
          behavior: 'smooth',
          block: blockPosition,
          inline: 'nearest'
        });

        previousTrackIndexRef.current = currentTrackIndex;
      } catch (error) {
        console.error('[LibraryView] Error during auto-scroll:', error);
        // Don't throw - let the component continue rendering
      }
    }, 0); // Execute in next event loop after DOM update

    return () => clearTimeout(timer);
  }, [currentTrackIndex, tracks.length]);

  // Update sliding highlight position when current track changes
  useEffect(() => {
    if (isEditMode || currentTrackIndex < 0 || !listRef.current) {
      setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
      return;
    }

    const updateHighlight = () => {
      const currentTrackElement = listRef.current?.querySelector(
        `[data-track-index="${currentTrackIndex}"]`
      ) as HTMLElement | null;

      if (!currentTrackElement || !listRef.current) {
        setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
        return;
      }

      const top = currentTrackElement.offsetTop;
      const height = currentTrackElement.offsetHeight;

      setHighlightStyle({
        top,
        height,
        opacity: 1
      });
    };

    // Use rAF to ensure DOM is ready
    const raf = requestAnimationFrame(updateHighlight);
    return () => cancelAnimationFrame(raf);
  }, [currentTrackIndex, tracks.length, isEditMode]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Handle drag events
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) {
      console.log('[LibraryView] Drag over - enabling dragging state');
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
    if (relatedTarget && !currentTarget.contains(relatedTarget)) {
      console.log('[LibraryView] Drag leave - disabling dragging state');
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[LibraryView] Drop event triggered');
    setIsDragging(false);

    if (!onDropFiles) {
      console.warn('[LibraryView] No drop handler available');
      return;
    }

    // Get dropped files
    const droppedFiles = Array.from(e.dataTransfer.files);
    console.log(`[LibraryView] Total files dropped: ${droppedFiles.length}`);

    // Filter for audio files only
    const audioExtensions = ['.flac', '.mp3', '.m4a', '.wav'];
    const audioFiles = droppedFiles.filter(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      return audioExtensions.includes(ext);
    });

    console.log(`[LibraryView] Audio files after filtering: ${audioFiles.length}`);

    if (audioFiles.length === 0) {
      console.warn('[LibraryView] No audio files dropped');
      return;
    }

    console.log(`[LibraryView] Dropped ${audioFiles.length} audio file(s)`);

    // Call parent handler with dropped files
    onDropFiles(audioFiles);
  }, [onDropFiles]);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === tracks.length) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Select all
      setSelectedIds(new Set(tracks.map(t => t.id)));
    }
  }, [selectedIds.size, tracks.length]);

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

    console.log(`[LibraryView] Removing ${idsToRemove.length} tracks...`);

    // Use batch removal if available (much faster and avoids state inconsistencies)
    if (onRemoveMultipleTracks) {
      await onRemoveMultipleTracks(idsToRemove);
      console.log('[LibraryView] ✓ Batch removal complete');
    } else {
      // Fallback to sequential removal
      console.log('[LibraryView] Using sequential removal (fallback)...');
      for (let i = 0; i < idsToRemove.length; i++) {
        const id = idsToRemove[i];
        console.log(`[LibraryView] Removing track ${i + 1}/${idsToRemove.length}`);
        await onRemoveTrack(id);
      }
      console.log('[LibraryView] Sequential removal complete');
    }

    // Clear selection and exit edit mode
    setSelectedIds(new Set());
    setIsEditMode(false);
  }, [selectedIds, onRemoveMultipleTracks, onRemoveTrack]);

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
          <p className="text-white/40">{tracks.length} Tracks in your collection</p>
        </div>
        <div className="flex items-center gap-2">
          {isEditMode && (
            <>
              <button
                onClick={toggleSelectAll}
                className="px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/10 transition-all"
              >
                {selectedIds.size === tracks.length ? '取消全选' : '全选'}
              </button>
              {selectedIds.size > 0 && (
                <button
                  onClick={handleRemoveSelected}
                  className="px-3 py-2 rounded-lg text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
                >
                  删除选中 ({selectedIds.size})
                </button>
              )}
            </>
          )}
          <button
            onClick={() => {
              setIsEditMode(!isEditMode);
              if (!isEditMode) setSelectedIds(new Set());
            }}
            className={`p-2 rounded-lg transition-all flex items-center justify-center ${
              isEditMode
                ? 'bg-primary text-white shadow-lg shadow-primary/25'
                : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
            title={isEditMode ? '完成' : '编辑'}
          >
            <span className="material-symbols-outlined">{isEditMode ? 'check' : 'edit'}</span>
          </button>
        </div>
      </div>

      {/* 固定的表头 */}
      <div className="flex-shrink-0">
        <div className={`grid gap-4 px-4 py-2 text-xs font-bold text-white/30 uppercase tracking-widest border-b border-white/5 mb-2 ${
          isEditMode ? 'grid-cols-[48px_1fr_1fr_100px_48px_48px]' : 'grid-cols-[48px_1fr_1fr_100px]'
        }`}>
          <span>#</span>
          <span>Title</span>
          <span>Album</span>
          <span className="text-right">Time</span>
          {isEditMode && (
            <>
              <span></span>
              <span className="text-center">选择</span>
            </>
          )}
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
            className="absolute rounded-xl pointer-events-none transition-[transform,height,opacity] duration-300 ease-out glass-soft shadow-2xl"
            style={{
              transform: `translateY(${highlightStyle.top - scrollTop}px)`,
              height: `${highlightStyle.height}px`,
              opacity: highlightStyle.opacity,
              left: 24,
              right: 24
            }}
          />
        </div>

        <div
          ref={scrollContainerRef}
          className="h-full min-h-0 overflow-y-auto no-scrollbar"
          onScroll={handleScroll}
        >
          {tracks.length > 0 ? (
            <div ref={listRef} className="grid gap-2 relative">
              {tracks.map((track, idx) => {
                const isUnavailable = track.available === false;
                const isSelected = selectedIds.has(track.id);

                return (
                  <div
                    key={track.id}
                    data-track-index={idx}  // Add identifier for auto-scroll
                    onClick={() => !isEditMode && !isUnavailable && onTrackSelect(idx)}
                    style={{
                      animation: `fadeInUp 0.3s ease-out ${idx * 0.03}s both`
                    }}
                    className={`grid gap-4 px-4 py-3 rounded-xl transition-all items-center relative z-10 ${
                      isEditMode ? 'grid-cols-[48px_1fr_1fr_100px_48px_48px]' : 'grid-cols-[48px_1fr_1fr_100px]'
                    } ${
                      isUnavailable
                        ? 'opacity-40 bg-white/5'
                        : isSelected
                        ? 'bg-red-500/10 border border-red-500/30'
                        : idx === currentTrackIndex
                        ? 'text-primary'
                        : 'hover:bg-white/5'
                    } ${isEditMode || isUnavailable ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                  <div className="text-sm font-medium opacity-50">
                    {idx + 1}
                  </div>
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={track.coverUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%23222"/></svg>'}
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
                  <div className="text-sm opacity-50 truncate">{track.album}</div>
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
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg p-1 transition-all"
                      >
                        <span className="material-symbols-outlined">delete</span>
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
          ) : (
            <div className="py-20 text-center opacity-20 border-2 border-dashed border-white/10 rounded-2xl">
              <span className="material-symbols-outlined text-6xl mb-4 block">library_music</span>
              <p className="text-xl font-medium">No tracks imported yet</p>
              <p className="text-sm">Use the sidebar to import your audio files</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for React.memo
  // Only re-render if these critical props change
  return (
    prevProps.tracks.length === nextProps.tracks.length &&
    prevProps.currentTrackIndex === nextProps.currentTrackIndex &&
    prevProps.onTrackSelect === nextProps.onTrackSelect &&
    prevProps.onRemoveTrack === nextProps.onRemoveTrack &&
    prevProps.onRemoveMultipleTracks === nextProps.onRemoveMultipleTracks &&
    prevProps.onDropFiles === nextProps.onDropFiles
  );
});

LibraryView.displayName = 'LibraryView';

export default LibraryView;
