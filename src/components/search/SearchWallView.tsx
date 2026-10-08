import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { onlineSongToTrack, trackToOnlineSong } from '../../domain/trackFactory';
import { useGlobalSearch } from '../../hooks/useGlobalSearch';
import type { OnlineSong, OnlineSource } from '../../services/onlineMusicProvider';
import type { Track } from '../../types';
import type { OnlineProgress } from '../../types/onlineProgress';
import PosterWall from '../wall/PosterWall';
import { useCurrentTheme } from '../settings/shared';
import TrackMenu, { type TrackMenuPosition } from '../TrackMenu';
import { buildTrackMenuItems, downloadQualityOf, type TrackDownloadQuality } from '../trackMenuItems';

type SearchGroupId = 'local' | 'cloud' | 'online';
type SearchTab = 'all' | SearchGroupId;

const ONLINE_LIMIT = 30;

const GROUP_LABEL_KEYS: Record<SearchGroupId, string> = {
  local: 'sidebar.local',
  cloud: 'sidebar.cloud',
  online: 'search.thirdPartySource',
};

interface SearchWallViewProps {
  downloadProgress?: OnlineProgress;
  query: string;
  localTracks: Track[];
  cloudTracks: Track[];
  currentTrackId?: string | undefined;
  onNavigateToTrack: (track: Track) => void;
  onOnlineStreamPlay: (song: OnlineSong, source: OnlineSource) => void;
  onDownloadTrack: (track: Track, quality: TrackDownloadQuality) => void;
  /** Reopen the palette on this query to refine it. */
  onEditQuery: () => void;
  onClose: () => void;
}

interface SearchGroup {
  id: SearchGroupId;
  tracks: Track[];
  loading: boolean;
}

/**
 * Full search results as a poster wall. A floating glass header carries the
 * query and the source filter; clicking a poster plays it, online posters
 * offer download from the context menu.
 */
export default function SearchWallView({
  downloadProgress,
  query,
  localTracks,
  cloudTracks,
  currentTrackId,
  onNavigateToTrack,
  onOnlineStreamPlay,
  onDownloadTrack,
  onEditQuery,
  onClose,
}: SearchWallViewProps) {
  const { t } = useTranslation();
  const { colors } = useCurrentTheme();
  const [tab, setTab] = useState<SearchTab>('all');
  const [trackMenu, setTrackMenu] = useState<TrackMenuPosition | null>(null);
  const { local, cloud, online, onlineLoading, onlineEnabled } = useGlobalSearch({
    query,
    active: true,
    localTracks,
    cloudTracks,
    onlineLimit: ONLINE_LIMIT,
  });

  useEffect(() => {
    setTab('all');
    setTrackMenu(null);
  }, [query]);

  // Esc returns to the library wall once nothing above the results consumed it.
  useEffect(() => {
    if (trackMenu) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose, trackMenu]);

  const onlineHits = useMemo(
    () => online.map(({ source, song }) => ({ track: onlineSongToTrack(song, source), song, source })),
    [online],
  );
  const groups = useMemo<SearchGroup[]>(() => [
    { id: 'local' as const, tracks: local.items, loading: false },
    { id: 'cloud' as const, tracks: cloud.items, loading: false },
    { id: 'online' as const, tracks: onlineHits.map(hit => hit.track), loading: onlineLoading },
  ].filter(group => group.tracks.length > 0 || (group.id === 'online' && onlineEnabled && group.loading)), [
    cloud.items, local.items, onlineEnabled, onlineHits, onlineLoading,
  ]);

  const shownTracks = useMemo(
    () => (tab === 'all' ? groups : groups.filter(group => group.id === tab)).flatMap(group => group.tracks),
    [groups, tab],
  );
  const groupOf = useMemo(() => {
    const map = new Map<string, SearchGroupId>();
    for (const group of groups) for (const track of group.tracks) map.set(track.id, group.id);
    return map;
  }, [groups]);

  const play = useCallback((index: number) => {
    const track = shownTracks[index];
    if (!track) return;
    if (groupOf.get(track.id) !== 'online') {
      onNavigateToTrack(track);
      return;
    }
    const hit = onlineHits.find(entry => entry.track.id === track.id);
    if (hit) onOnlineStreamPlay(hit.song, hit.source);
  }, [groupOf, onNavigateToTrack, onOnlineStreamPlay, onlineHits, shownTracks]);

  const hasMenu = useCallback((track: Track) => groupOf.get(track.id) === 'online' && trackToOnlineSong(track) !== null, [groupOf]);
  const openTrackMenu = useCallback((track: Track, x: number, y: number, trigger: HTMLElement) => {
    setTrackMenu({ trackId: track.id, x, y, trigger });
  }, []);
  const menuTrack = trackMenu ? onlineHits.find(hit => hit.track.id === trackMenu.trackId)?.track : undefined;

  const tabs: SearchTab[] = ['all', ...groups.map(group => group.id)];

  return (
    <div className="search-wall-view relative flex h-full w-full flex-col">
      <PosterWall
        downloadProgress={downloadProgress}
        tracks={shownTracks}
        sourceKey={`search:${query}:${tab}`}
        currentTrackId={currentTrackId}
        loading={onlineLoading && shownTracks.length === 0}
        emptyLabel={t('search.noResults')}
        loadingLabel={`${t('search.searching')}…`}
        onTrackSelect={play}
        hasMenu={hasMenu}
        onOpenMenu={openTrackMenu}
      />

      <div className="wall-float search-wall-header">
        <button type="button" className="wall-float__button search-wall-header__query" onClick={onEditQuery}
          aria-label={t('search.editQuery')}>
          <span className="material-symbols-rounded" aria-hidden="true">search</span>
          <span className="search-wall-header__text">{query}</span>
        </button>
        <div role="tablist" aria-label={t('search.resultsSubtitle')} className="search-wall-header__tabs">
          {tabs.map(id => {
            const group = groups.find(entry => entry.id === id);
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className="search-wall-header__tab"
                onClick={() => setTab(id)}
              >
                {t(group ? GROUP_LABEL_KEYS[group.id] : 'search.tabAll')}
                {group && <span className="search-wall-header__count">{group.loading && group.tracks.length === 0 ? '…' : group.tracks.length}</span>}
              </button>
            );
          })}
        </div>
        <button type="button" className="wall-float__button search-wall-header__close" onClick={onClose} aria-label={t('common.close')}>
          <span className="material-symbols-rounded" aria-hidden="true">close</span>
        </button>
      </div>


      {trackMenu && menuTrack && (
        <TrackMenu
          position={trackMenu}
          colors={colors}
          items={buildTrackMenuItems({ dataSource: 'search', canEdit: false, canDownload: trackToOnlineSong(menuTrack) !== null })}
          onClose={() => setTrackMenu(null)}
          onAction={id => {
            const quality = downloadQualityOf(id);
            if (quality) onDownloadTrack(menuTrack, quality);
          }}
        />
      )}
    </div>
  );
}
