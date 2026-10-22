import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Track } from '../types';
import TrackCover from './TrackCover';

/** What the list shows: a source (local, cloud, history) or an online playlist. */
export interface LibraryCollection {
  title: string;
  /** The playlist's own artwork; sources without one show their first covers. */
  coverUrl: string | null;
  /** Songs in the collection, which a playlist may not have loaded yet. */
  trackCount: number;
}

interface LibraryCollectionHeaderProps {
  collection: LibraryCollection;
  tracks: readonly Track[];
  onDoubleClick?: () => void;
}

const MOSAIC_SIZE = 4;

/** The collection's length in minutes, or hours and minutes past an hour. */
function totalDuration(tracks: readonly Track[], t: TFunction): string {
  // Under a minute still reads as one, never "0 minutes".
  const minutes = Math.max(1, Math.round(tracks.reduce((sum, track) => sum + (track.duration || 0), 0) / 60));
  if (minutes < 60) return t('library.totalMinutes', { count: minutes });
  return t('library.totalHours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/**
 * Apple Music's playlist header above the song list: the artwork (or a mosaic
 * of the first covers), the name and a short count. It scrolls with the list.
 */
const LibraryCollectionHeader = forwardRef<HTMLDivElement, LibraryCollectionHeaderProps>(({ collection, tracks, onDoubleClick }, ref) => {
  const { t } = useTranslation();
  const mosaic = !collection.coverUrl && tracks.length >= MOSAIC_SIZE ? tracks.slice(0, MOSAIC_SIZE) : null;
  const first = tracks[0];
  const complete = tracks.length >= collection.trackCount;
  const details = [
    t('library.playlistSongCount', { count: collection.trackCount }),
    ...(complete && tracks.length > 0 ? [totalDuration(tracks, t)] : []),
  ].join(' · ');
  return (
    <div ref={ref} className="library-collection-header" onDoubleClick={onDoubleClick}>
      <div className="library-collection-header__art" aria-hidden="true">
        {collection.coverUrl ? (
          <img src={collection.coverUrl} alt="" draggable={false} />
        ) : mosaic ? (
          <div className="library-collection-header__mosaic">
            {mosaic.map(track => (
              <TrackCover key={track.id} trackId={track.id} filePath={track.filePath} fallbackUrl={track.coverUrl} className="h-full w-full object-cover" />
            ))}
          </div>
        ) : first ? (
          <TrackCover trackId={first.id} filePath={first.filePath} fallbackUrl={first.coverUrl} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="library-collection-header__text">
        <h2 className="library-collection-header__title">{collection.title}</h2>
        <p className="library-collection-header__details">{details}</p>
      </div>
    </div>
  );
});
LibraryCollectionHeader.displayName = 'LibraryCollectionHeader';

export default LibraryCollectionHeader;
