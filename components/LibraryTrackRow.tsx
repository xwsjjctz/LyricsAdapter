import React, { memo } from 'react';
import { Track } from '../types';
import { i18n } from '../services/i18n';
import { ThemeColors } from '../types/theme';
import TrackCover from './TrackCover';

interface LibraryTrackRowProps {
  track: Track;
  filteredIndex: number;
  isCurrentTrack: boolean;
  isEditMode: boolean;
  isSelected: boolean;
  isDragged: boolean;
  shouldShowAnimation: boolean;
  colors: ThemeColors;
  /** 当前播放指示器形态：'inline' 时当前行用实色背景，不依赖浮动滑块。 */
  playingIndicator?: 'floating' | 'inline';
  measureRef?: ((node: HTMLDivElement | null) => void) | undefined;
  realTrackIndex: number;
  onTrackSelect: (index: number) => void;
  onToggleSelect: (id: string) => void;
  onEditMetadata: (track: Track) => void;
  onDelete: (trackId: string) => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
}

/**
 * A single row in the (virtualized) track list.
 *
 * Memoized — the parent must pass stable callbacks (useCallback) so that only
 * rows whose props actually change re-render. measureRef is attached only to
 * the first visible row so the virtual-scroll hook can sample row height.
 */
const LibraryTrackRow: React.FC<LibraryTrackRowProps> = memo(({
  track,
  filteredIndex,
  isCurrentTrack,
  isEditMode,
  isSelected,
  isDragged,
  shouldShowAnimation,
  colors,
  playingIndicator = 'floating',
  measureRef,
  realTrackIndex,
  onTrackSelect,
  onToggleSelect,
  onEditMetadata,
  onDelete,
  onDragStart,
  onDragOver,
  onDragEnd,
}) => {
  const isUnavailable = track.available === false;
  const canDrag = isEditMode && !isUnavailable;
  const animationStyle = shouldShowAnimation
    ? { animation: `fadeInUp 0.3s ease-out ${filteredIndex * 0.03}s both` }
    : undefined;

  return (
    <div
      key={track.id}
      ref={measureRef}
      data-track-index={filteredIndex}
      draggable={canDrag}
      onDragStart={(e) => onDragStart(e, filteredIndex)}
      onDragOver={(e) => onDragOver(e, filteredIndex)}
      onDragEnd={onDragEnd}
      onClick={() => {
        if (isEditMode || isUnavailable) return;
        if (realTrackIndex >= 0) onTrackSelect(realTrackIndex);
      }}
      style={{
        ...animationStyle,
        backgroundColor: isDragged ? 'transparent' : isUnavailable ? 'transparent' : isSelected ? `${colors.error}1a` : isCurrentTrack ? (playingIndicator === 'inline' ? colors.primary : `${colors.primary}15`) : 'transparent',
        border: isSelected ? `var(--theme-control-border-width) solid ${colors.error}` : `var(--theme-control-border-width) solid var(--theme-list-item-border)`,
        borderBottom: 'none',
        borderRadius: 'var(--theme-control-radius)',
        paddingTop: 'var(--theme-list-item-padding-y)',
        paddingBottom: 'var(--theme-list-item-padding-y)',
      }}
      className={`grid gap-4 px-4 transition-all items-center relative z-10 grid-cols-[48px_1fr_1fr_120px] ${
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
      <div className="text-sm font-medium" style={{ opacity: 0.5, color: isCurrentTrack ? 'var(--theme-control-current-track-fg)' : colors.textSecondary }}>
        {isEditMode && !isUnavailable ? (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(track.id)}
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
          className="size-10 object-cover"
          style={{ borderRadius: 'var(--theme-media-radius-sm)' }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm truncate" style={{ color: isCurrentTrack ? 'var(--theme-control-current-track-fg)' : colors.textPrimary, fontWeight: 'var(--theme-text-heading-weight)' }}>
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
              onEditMetadata(track);
            }}
            className="w-8 h-8 flex items-center justify-center transition-all"
            style={{ color: colors.textMuted, borderRadius: 'var(--theme-button-radius)' }}
            title={i18n.t('sidebar.metadata')}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.primary; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.textMuted; }}
          >
            <span className="material-symbols-outlined text-lg">description</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(track.id);
            }}
            className="w-8 h-8 flex items-center justify-center transition-all"
            style={{ color: colors.error, borderRadius: 'var(--theme-button-radius)' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = `${colors.error}1a`; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <span className="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
      ) : (
        <div className="text-sm text-right tabular-nums" style={{ color: colors.textMuted }}>
          {Math.floor(track.duration / 60)}:{Math.floor(track.duration % 60).toString().padStart(2, '0')}
        </div>
      )}
    </div>
  );
});

export default LibraryTrackRow;
