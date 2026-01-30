import React, { useState } from 'react';
import { Track } from '../types';

interface LibraryViewProps {
  tracks: Track[];
  currentTrackIndex: number;
  onTrackSelect: (index: number) => void;
  onRemoveTrack: (trackId: string) => void;
  onDropFiles?: (files: File[]) => void; // New: Handle dropped files
}

const LibraryView: React.FC<LibraryViewProps> = ({
  tracks,
  currentTrackIndex,
  onTrackSelect,
  onRemoveTrack,
  onDropFiles
}) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false); // New: Drag state

  // Handle drag events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (!onDropFiles) return;

    // Get dropped files
    const droppedFiles = Array.from(e.dataTransfer.files);

    // Filter for audio files only
    const audioExtensions = ['.flac', '.mp3', '.m4a', '.wav'];
    const audioFiles = droppedFiles.filter(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      return audioExtensions.includes(ext);
    });

    if (audioFiles.length === 0) {
      console.warn('[LibraryView] No audio files dropped');
      return;
    }

    console.log(`[LibraryView] Dropped ${audioFiles.length} audio file(s)`);

    // Call parent handler with dropped files
    onDropFiles(audioFiles);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === tracks.length) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Select all
      setSelectedIds(new Set(tracks.map(t => t.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleRemoveSelected = async () => {
    // Convert Set to Array and remove tracks one by one to avoid race conditions
    const idsToRemove = Array.from(selectedIds);

    console.log(`[LibraryView] Removing ${idsToRemove.length} tracks sequentially...`);

    // Remove tracks sequentially to avoid state update conflicts
    for (let i = 0; i < idsToRemove.length; i++) {
      const id = idsToRemove[i];
      console.log(`[LibraryView] Removing track ${i + 1}/${idsToRemove.length}`);
      await onRemoveTrack(id);
    }

    console.log('[LibraryView] All tracks removed successfully');

    // Clear selection and exit edit mode
    setSelectedIds(new Set());
    setIsEditMode(false);
  };

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
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm rounded-2xl border-2 border-dashed border-primary animate-pulse">
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
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {tracks.length > 0 ? (
          <div className="grid gap-2">
            {tracks.map((track, idx) => {
              const isUnavailable = track.available === false;
              const isSelected = selectedIds.has(track.id);

              return (
                <div
                  key={track.id}
                  onClick={() => !isEditMode && !isUnavailable && onTrackSelect(idx)}
                  style={{
                    animation: `fadeInUp 0.3s ease-out ${idx * 0.03}s both`
                  }}
                  className={`grid gap-4 px-4 py-3 rounded-xl transition-all items-center ${
                    isEditMode ? 'grid-cols-[48px_1fr_1fr_100px_48px_48px]' : 'grid-cols-[48px_1fr_1fr_100px]'
                  } ${
                    isUnavailable
                      ? 'opacity-40 bg-white/5'
                      : isSelected
                      ? 'bg-red-500/10 border border-red-500/30'
                      : idx === currentTrackIndex
                      ? 'bg-primary/20 text-primary'
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
  );
};

export default LibraryView;