import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Track } from '../../types';
import TrackCover from '../TrackCover';
import type { WallTile } from './wallLayout';
import { isPlainEnter } from '../../shared/keyboard';

interface PosterTileProps {
  track: Track;
  tile: WallTile;
  /** Playing now: marked in place, never moved. */
  isCurrent: boolean;
  hasMenu: boolean;
  onSelect: (index: number) => void;
  onOpenMenu: (track: Track, x: number, y: number, trigger: HTMLElement) => void;
  /** Multi-select mode: a click toggles the tile instead of playing it. */
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: ((track: Track) => void) | undefined;
  /** Drag-to-swap is available for this list. */
  draggable?: boolean;
  dragState?: 'source' | 'target' | undefined;
  onDragStartTile?: ((index: number, event: React.DragEvent) => void) | undefined;
  onDragOverTile?: ((index: number, event: React.DragEvent) => void) | undefined;
  onDropTile?: ((index: number, event: React.DragEvent) => void) | undefined;
  onDragEndTile?: (() => void) | undefined;
}

/** Cover thumbnails are cached at 128/256/512; pick the bucket for ~2x DPR. */
const thumbSizeFor = (width: number): number => {
  const needed = width * 2;
  if (needed <= 128) return 128;
  if (needed <= 256) return 256;
  return 512;
};

/** One poster on the wall. Position comes from the layout; GSAP animates the inner element. */
const PosterTile: React.FC<PosterTileProps> = memo(({
  track, tile, isCurrent, hasMenu, onSelect, onOpenMenu,
  selecting = false, selected = false, onToggleSelect,
  draggable = false, dragState, onDragStartTile, onDragOverTile, onDropTile, onDragEndTile,
}) => {
  const { t } = useTranslation();
  const unavailable = track.available === false;
  const large = tile.cols >= 4 && tile.rows >= 3;
  const classes = [
    'wall-tile',
    isCurrent ? 'wall-tile--current' : '',
    large ? 'wall-tile--lg' : '',
    unavailable ? 'wall-tile--unavailable' : '',
    selecting ? 'wall-tile--selecting' : '',
    selected ? 'wall-tile--selected' : '',
    dragState ? `wall-tile--drag-${dragState}` : '',
  ].filter(Boolean).join(' ');

  const activate = () => {
    if (selecting) onToggleSelect?.(track);
    else if (!unavailable) onSelect(tile.index);
  };

  // Tiles sit edge to edge, so snap both edges to whole pixels; fractional
  // offsets would let the background bleed through as hairline seams.
  const left = Math.round(tile.x);
  const top = Math.round(tile.y);
  const snappedWidth = Math.round(tile.x + tile.width) - left;
  const snappedHeight = Math.round(tile.y + tile.height) - top;

  return (
    <div
      className={classes}
      role={selecting ? 'checkbox' : 'button'}
      tabIndex={0}
      aria-checked={selecting ? selected : undefined}
      aria-label={t('wall.tileLabel', { title: track.title, artist: track.artist })}
      aria-current={isCurrent ? 'true' : undefined}
      aria-disabled={unavailable || undefined}
      data-track-id={track.id}
      style={{
        transform: `translate(${left}px, ${top}px)`,
        width: snappedWidth,
        height: snappedHeight,
      }}
      draggable={draggable && !selecting}
      onDragStart={draggable ? event => onDragStartTile?.(tile.index, event) : undefined}
      onDragOver={draggable ? event => onDragOverTile?.(tile.index, event) : undefined}
      onDrop={draggable ? event => onDropTile?.(tile.index, event) : undefined}
      onDragEnd={draggable ? onDragEndTile : undefined}
      onClick={activate}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        // Space stays the global play/pause shortcut; see isPlainEnter for modifiers.
        if (isPlainEnter(event)) {
          event.preventDefault();
          activate();
        } else if (hasMenu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(track, rect.left + rect.width / 2, rect.top + rect.height / 2, event.currentTarget);
        }
      }}
      onContextMenu={event => {
        if (!hasMenu || selecting) return;
        event.preventDefault();
        onOpenMenu(track, event.clientX, event.clientY, event.currentTarget);
      }}
    >
      <div className="wall-tile__inner" data-wall-tile-inner>
        <TrackCover
          trackId={track.id}
          filePath={track.filePath}
          fallbackUrl={track.coverUrl}
          className="wall-tile__cover"
          thumbSize={thumbSizeFor(tile.width)}
        />
        <div className="wall-tile__scrim" aria-hidden="true" />
        {isCurrent && <span className="wall-tile__badge">{t('library.nowPlaying')}</span>}
        {selecting && (
          <span className="wall-tile__check" aria-hidden="true">
            <span className="material-symbols-outlined">{selected ? 'check_circle' : 'radio_button_unchecked'}</span>
          </span>
        )}
        <div className="wall-tile__text">
          <p className="wall-tile__title">{track.title}</p>
          <p className="wall-tile__artist">
            {unavailable ? t('library.needReimport') : track.artist}
          </p>
        </div>
      </div>
    </div>
  );
});

PosterTile.displayName = 'PosterTile';

export default PosterTile;
