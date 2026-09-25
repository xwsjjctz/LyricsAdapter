import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { onlineSongToTrack, trackToOnlineSong } from '../../domain/trackFactory';
import { useGlobalSearch } from '../../hooks/useGlobalSearch';
import { getDesktopAPI } from '../../services/desktopAdapter';
import type { OnlineSong, OnlineSource } from '../../services/onlineMusicProvider';
import type { Track } from '../../types';
import LibraryTrackRow from '../LibraryTrackRow';
import { MACOS_PLAYER_BOTTOM_INSET } from '../playerLayout';
import { useCurrentTheme } from '../settings/shared';
import TrackMenu, { type TrackMenuPosition } from '../TrackMenu';
import { buildTrackMenuItems, downloadQualityOf, type TrackDownloadQuality } from '../trackMenuItems';
import { SearchSectionLabel } from './SearchSectionLabel';

type SearchGroupId = 'local' | 'cloud' | 'online';
type SearchTab = 'all' | SearchGroupId;

/** Rows per group on the All tab before "show all" switches to that group. */
const ALL_TAB_PREVIEW = 5;
const PAGE_ONLINE_LIMIT = 30;

interface SearchViewProps {
  query: string;
  localTracks: Track[];
  cloudTracks: Track[];
  currentTrackId?: string | undefined;
  searchBox: React.ReactNode;
  onNavigateToTrack: (track: Track) => void;
  onOnlineStreamPlay: (song: OnlineSong, source: OnlineSource) => void;
  onDownloadTrack: (track: Track, quality: TrackDownloadQuality) => void;
  onlineProgress: Record<string, { type: 'download' | 'upload'; percent: number }>;
}

interface SearchGroup {
  id: SearchGroupId;
  icon: string;
  labelKey: string;
  tracks: Track[];
  total: number;
  loading: boolean;
}

/** Full search results: every local/cloud match plus a larger online page. */
export default function SearchView({
  query,
  localTracks,
  cloudTracks,
  currentTrackId,
  searchBox,
  onNavigateToTrack,
  onOnlineStreamPlay,
  onDownloadTrack,
  onlineProgress,
}: SearchViewProps) {
  const { t } = useTranslation();
  const { colors } = useCurrentTheme();
  const [tab, setTab] = useState<SearchTab>('all');
  const [trackMenu, setTrackMenu] = useState<TrackMenuPosition | null>(null);
  const { local, cloud, online, onlineLoading, onlineEnabled } = useGlobalSearch({
    query,
    active: true,
    localTracks,
    cloudTracks,
    onlineLimit: PAGE_ONLINE_LIMIT,
  });

  useEffect(() => {
    setTab('all');
    setTrackMenu(null);
  }, [query]);

  const onlineTracks = useMemo(
    () => online.map(({ source, song }) => ({ track: onlineSongToTrack(song, source), song, source })),
    [online],
  );
  const groups = useMemo(() => ([
    { id: 'local', icon: 'hard_drive', labelKey: 'sidebar.local', tracks: local.items, total: local.total, loading: false },
    { id: 'cloud', icon: 'cloud', labelKey: 'sidebar.cloud', tracks: cloud.items, total: cloud.total, loading: false },
    {
      id: 'online', icon: 'language', labelKey: 'search.thirdPartySource',
      tracks: onlineTracks.map(hit => hit.track), total: onlineTracks.length, loading: onlineLoading,
    },
  ] satisfies SearchGroup[]).filter(group => group.total > 0 || (group.id === 'online' && onlineEnabled && group.loading)), [
    cloud, local, onlineEnabled, onlineLoading, onlineTracks,
  ]);

  const activate = useCallback((groupId: SearchGroupId, track: Track) => {
    if (groupId !== 'online') {
      onNavigateToTrack(track);
      return;
    }
    const hit = onlineTracks.find(entry => entry.track.id === track.id);
    if (hit) onOnlineStreamPlay(hit.song, hit.source);
  }, [onNavigateToTrack, onOnlineStreamPlay, onlineTracks]);

  const openTrackMenu = useCallback((track: Track, x: number, y: number, trigger: HTMLElement) => {
    setTrackMenu({ trackId: track.id, x, y, trigger });
  }, []);
  const closeTrackMenu = useCallback(() => setTrackMenu(null), []);
  const menuTrack = trackMenu ? onlineTracks.find(hit => hit.track.id === trackMenu.trackId)?.track : undefined;

  const bottomInset = getDesktopAPI()?.platform === 'darwin' ? MACOS_PLAYER_BOTTOM_INSET : 24;
  const visibleGroups = tab === 'all' ? groups : groups.filter(group => group.id === tab);
  const isEmpty = groups.length === 0;

  const renderRows = (group: SearchGroup, tracks: Track[]) => tracks.map((track, index) => {
    const isOnline = group.id === 'online';
    return (
      <LibraryTrackRow
        key={track.id}
        track={track}
        filteredIndex={index}
        realTrackIndex={index}
        isCurrentTrack={track.id === currentTrackId}
        isSelecting={false}
        isSelected={false}
        isDragged={false}
        hasMenu={isOnline}
        canReorder={false}
        shouldShowAnimation={false}
        colors={colors}
        progress={isOnline && track.songmid ? onlineProgress[track.songmid]?.percent : undefined}
        onTrackSelect={() => activate(group.id, track)}
        onToggleSelect={() => undefined}
        onOpenMenu={openTrackMenu}
      />
    );
  });

  return (
    <div className="library-view h-full flex flex-col">
      <div className="library-toolbar mb-4 flex-shrink-0 flex items-center justify-between">
        <div className="library-toolbar-leading min-w-0">
          <h1 className="text-3xl truncate" style={{ color: colors.textPrimary, fontWeight: 'var(--theme-text-heading-weight)', letterSpacing: 'var(--theme-heading-letter-spacing)' }}>
            “{query}”
          </h1>
          <p style={{ color: colors.textMuted }}>{t('search.resultsSubtitle')}</p>
        </div>
        <div className="library-toolbar-actions flex items-center gap-2">{searchBox}</div>
      </div>

      <div role="tablist" aria-label={t('search.resultsSubtitle')} className="search-tabs mb-3 flex-shrink-0">
        {(['all', ...groups.map(group => group.id)] as SearchTab[]).map(id => {
          const group = groups.find(entry => entry.id === id);
          const selected = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`search-tab${selected ? ' search-tab--selected' : ''}`}
              style={selected ? { color: colors.textPrimary, backgroundColor: colors.backgroundCardHover } : { color: colors.textMuted }}
              onClick={() => setTab(id)}
            >
              {t(group ? group.labelKey : 'search.tabAll')}
              {group && <span className="search-tab__count">{group.loading && group.total === 0 ? '…' : group.total}</span>}
            </button>
          );
        })}
      </div>

      <div className="library-track-scroll no-scrollbar flex-1 min-h-0 overflow-y-auto" style={{ paddingBottom: bottomInset }}>
        {isEmpty ? (
          <div className="py-20 text-center" style={{ color: colors.textMuted }}>
            <span className="material-symbols-outlined text-5xl mb-3 block" aria-hidden="true">search_off</span>
            <p>{t('search.noResults')}</p>
          </div>
        ) : visibleGroups.map(group => {
          const preview = tab === 'all' ? group.tracks.slice(0, ALL_TAB_PREVIEW) : group.tracks;
          return (
            <section key={group.id} aria-label={t(group.labelKey)} className="search-page-section">
              <div className="flex items-center justify-between px-4 pb-2">
                <SearchSectionLabel icon={group.icon} label={t(group.labelKey)} count={group.total}
                  isLoading={group.loading} colors={colors} />
                {tab === 'all' && group.total > ALL_TAB_PREVIEW && (
                  <button type="button" className="search-show-all" style={{ color: colors.primary }}
                    onClick={() => setTab(group.id)}>
                    {t('search.showAll', { count: group.total })}
                  </button>
                )}
              </div>
              {group.loading && group.tracks.length === 0 ? (
                <p className="px-4 py-3 text-sm" style={{ color: colors.textMuted }}>{t('search.searching')}...</p>
              ) : (
                <div className="grid" style={{ gap: 'var(--theme-list-item-gap)' }}>{renderRows(group, preview)}</div>
              )}
            </section>
          );
        })}
      </div>

      {trackMenu && menuTrack && (
        <TrackMenu
          position={trackMenu}
          colors={colors}
          items={buildTrackMenuItems({ dataSource: 'search', canEdit: false, canDownload: trackToOnlineSong(menuTrack) !== null })}
          onClose={closeTrackMenu}
          onAction={id => {
            const quality = downloadQualityOf(id);
            if (quality) onDownloadTrack(menuTrack, quality);
          }}
        />
      )}
    </div>
  );
}
