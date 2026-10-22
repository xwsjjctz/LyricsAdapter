import React, { memo } from 'react';
import { Track } from '../types';
import { useTranslation } from 'react-i18next';
import { ThemeColors } from '../types/theme';
import TrackCover from './TrackCover';
import NowPlayingBars from './NowPlayingBars';
import { formatDuration } from '../shared/formatDuration';
import { isPlainEnter } from '../shared/keyboard';

interface LibraryTrackRowProps {
  track: Track;
  filteredIndex: number;
  realTrackIndex: number;
  isCurrentTrack: boolean;
  isSelecting: boolean;
  isSelected: boolean;
  isDragged: boolean;
  /** A context menu has at least one action for this row. */
  hasMenu: boolean;
  canReorder: boolean;
  shouldShowAnimation: boolean;
  colors: ThemeColors;
  playingIndicator?: 'floating' | 'inline';
  /** The current track is playing (and visible), so its bars move. */
  nowPlayingAnimated?: boolean;
  measureRef?: ((node: HTMLDivElement | null) => void) | undefined;
  onTrackSelect: (index: number) => void;
  onToggleSelect: (id: string) => void;
  onOpenMenu: (track: Track, x: number, y: number, trigger: HTMLElement) => void;
  onDragStart?: ((e: React.DragEvent, index: number) => void) | undefined;
  onDragOver?: ((e: React.DragEvent, index: number) => void) | undefined;
  onDrop?: ((e: React.DragEvent, index: number) => void) | undefined;
  onDragEnd?: (() => void) | undefined;
  /** Download progress 0–100; replaces the duration while set. */
  progress?: number | undefined;
}

/** Shared by the default list and artist/album lists. Selection never plays audio. */
const LibraryTrackRow: React.FC<LibraryTrackRowProps> = memo(({
  track, filteredIndex, realTrackIndex, isCurrentTrack, isSelecting, isSelected,
  isDragged, hasMenu, canReorder, shouldShowAnimation, colors,
  playingIndicator = 'floating', nowPlayingAnimated = false, measureRef, onTrackSelect, onToggleSelect,
  onOpenMenu, onDragStart, onDragOver, onDrop, onDragEnd, progress,
}) => {
  const { t } = useTranslation();
  const isUnavailable = track.available === false;
  const canDrag = canReorder && !isSelecting;
  const activate = () => {
    if (isSelecting) onToggleSelect(track.id);
    else if (!isUnavailable && realTrackIndex >= 0) onTrackSelect(realTrackIndex);
  };
  const inlineCurrent = !isSelecting && isCurrentTrack && playingIndicator === 'inline';
  return (
    <div
      ref={measureRef}
      data-track-index={realTrackIndex}
      data-track-id={track.id}
      tabIndex={0}
      draggable={canDrag}
      onDragStart={e => { if (canDrag && onDragStart) onDragStart(e, filteredIndex); else e.preventDefault(); }}
      onDragOver={e => onDragOver?.(e, filteredIndex)}
      onDrop={e => onDrop?.(e, filteredIndex)}
      onDragEnd={onDragEnd}
      onClick={activate}
      onContextMenu={e => {
        if (!hasMenu || isSelecting) return;
        e.preventDefault();
        onOpenMenu(track, e.clientX, e.clientY, e.currentTarget);
      }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        // Space stays the global play/pause shortcut; see isPlainEnter for modifiers.
        if (isPlainEnter(e)) { e.preventDefault(); activate(); }
        if (hasMenu && !isSelecting && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          onOpenMenu(track, rect.right - 220, rect.bottom, e.currentTarget);
        }
      }}
      style={{
        animation: shouldShowAnimation ? `fadeInUp 0.3s ease-out ${Math.min(filteredIndex, 15) * 0.03}s both` : undefined,
        // The floating band marks the current track in the default themes; inline themes fill the row.
        backgroundColor: isSelected ? 'var(--library-selected)' : inlineCurrent ? colors.primary : undefined,
        border: `var(--theme-control-border-width) solid ${isSelected ? 'var(--library-accent)' : 'var(--theme-list-item-border)'}`,
        borderBottom: 'none', borderRadius: 'var(--library-row-radius)',
        paddingTop: 'var(--theme-list-item-padding-y)', paddingBottom: 'var(--theme-list-item-padding-y)',
        boxShadow: inlineCurrent ? 'var(--theme-elevated-shadow)' : undefined,
        zIndex: inlineCurrent ? 20 : undefined,
      }}
      data-current={isCurrentTrack && !isSelecting ? 'true' : undefined}
      className={`library-track-grid library-track-row grid gap-4 px-4 transition-colors items-center relative z-10 ${isDragged ? 'opacity-40 cursor-grabbing' : 'cursor-default'}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {isSelecting ? (
          <div className="library-track-row__cover size-10 shrink-0 flex items-center justify-center">
            <input type="checkbox" checked={isSelected}
              aria-label={t('library.selectTrack', { title: track.title })}
              onChange={() => onToggleSelect(track.id)} onClick={e => e.stopPropagation()}
              className="w-5 h-5 cursor-pointer" style={{ accentColor: 'var(--library-accent)' }} />
          </div>
        ) : (
          <span className="library-track-row__art">
            <TrackCover trackId={track.id} filePath={track.filePath} fallbackUrl={track.coverUrl}
              className="library-track-row__cover size-10 shrink-0 object-cover" style={{ borderRadius: 'var(--library-cover-radius)' }} />
            {isCurrentTrack && <NowPlayingBars animated={nowPlayingAnimated} />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="library-track-row__title text-sm truncate" style={inlineCurrent ? { color: 'var(--theme-control-current-track-fg)' } : undefined}>
            {track.title}
            {isUnavailable && <span className="text-xs ml-2" style={{ color: '#facc15' }}>{t('library.needReimport')}</span>}
          </p>
          {/* Like Apple Music: the album rides on the artist line instead of taking a column. */}
          <p className="library-track-row__subtitle text-xs truncate" style={inlineCurrent ? { color: 'var(--theme-control-current-track-fg)' } : undefined}>
            {[track.artist, track.album].filter(Boolean).join(' — ')}
          </p>
        </div>
      </div>
      <div className="library-track-row__time text-sm text-right tabular-nums"
        style={progress != null ? { color: colors.primary } : inlineCurrent ? { color: 'var(--theme-control-current-track-fg)' } : undefined}>
        {progress != null ? `${Math.round(progress)}%` : formatDuration(track.duration)}
      </div>
    </div>
  );
});
export default LibraryTrackRow;
