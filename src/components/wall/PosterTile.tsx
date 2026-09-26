import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Track } from '../../types';
import TrackCover from '../TrackCover';
import type { WallTile } from './wallLayout';

interface PosterTileProps {
  track: Track;
  tile: WallTile;
  /** Playing now: marked in place, never moved. */
  isCurrent: boolean;
  hasMenu: boolean;
  onSelect: (index: number) => void;
  onOpenMenu: (track: Track, x: number, y: number, trigger: HTMLElement) => void;
}

/** Cover thumbnails are cached at 128/256/512; pick the bucket for ~2x DPR. */
const thumbSizeFor = (width: number): number => {
  const needed = width * 2;
  if (needed <= 128) return 128;
  if (needed <= 256) return 256;
  return 512;
};

/** One poster on the wall. Position comes from the layout; GSAP animates the inner element. */
const PosterTile: React.FC<PosterTileProps> = memo(({ track, tile, isCurrent, hasMenu, onSelect, onOpenMenu }) => {
  const { t } = useTranslation();
  const unavailable = track.available === false;
  const large = tile.cols >= 4 && tile.rows >= 3;
  const classes = [
    'wall-tile',
    isCurrent ? 'wall-tile--current' : '',
    large ? 'wall-tile--lg' : '',
    unavailable ? 'wall-tile--unavailable' : '',
  ].filter(Boolean).join(' ');

  const activate = () => {
    if (!unavailable) onSelect(tile.index);
  };

  return (
    <div
      className={classes}
      role="button"
      tabIndex={0}
      aria-label={t('wall.tileLabel', { title: track.title, artist: track.artist })}
      aria-current={isCurrent ? 'true' : undefined}
      aria-disabled={unavailable || undefined}
      data-track-id={track.id}
      style={{
        transform: `translate(${tile.x}px, ${tile.y}px)`,
        width: tile.width,
        height: tile.height,
      }}
      onClick={activate}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        } else if (hasMenu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(track, rect.left + rect.width / 2, rect.top + rect.height / 2, event.currentTarget);
        }
      }}
      onContextMenu={event => {
        if (!hasMenu) return;
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
        {isCurrent ? (
          <span className="wall-tile__badge">{t('library.nowPlaying')}</span>
        ) : (
          <span className="wall-tile__index" aria-hidden="true">
            {String(tile.index + 1).padStart(2, '0')}
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
