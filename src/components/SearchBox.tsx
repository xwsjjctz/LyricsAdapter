import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { onlineSongToTrack, trackToOnlineSong } from '../domain/trackFactory';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { useCurrentTheme } from './settings/shared';
import type { OnlineSong, OnlineSource } from '../services/onlineMusicProvider';
import type { Track } from '../types';
import SearchResultRow from './search/SearchResultRow';
import { SearchSectionLabel } from './search/SearchSectionLabel';
import TrackMenu, { type TrackMenuPosition } from './TrackMenu';
import { buildTrackMenuItems, downloadQualityOf, type TrackDownloadQuality } from './trackMenuItems';

/** The dropdown is a quick peek; the results page shows everything. */
const DROPDOWN_LIBRARY_LIMIT = 4;
const DROPDOWN_ONLINE_LIMIT = 4;

interface SearchBoxProps {
  isWindowFocused?: boolean;
  localTracks: Track[];
  cloudTracks: Track[];
  /** Query to show when the box mounts, e.g. on the results page. */
  initialQuery?: string;
  onNavigateToTrack: (track: Track) => void;
  onOnlineStreamPlay: (song: OnlineSong, source: OnlineSource) => void;
  onDownloadTrack: (track: Track, quality: TrackDownloadQuality) => void;
  onlineProgress: Record<string, { type: 'download' | 'upload'; percent: number }>;
  onOpenResults: (query: string) => void;
}

interface DropdownEntry {
  key: string;
  track: Track;
  activate: () => void;
}

const SearchBox: React.FC<SearchBoxProps> = ({
  isWindowFocused,
  localTracks,
  cloudTracks,
  initialQuery = '',
  onNavigateToTrack,
  onOnlineStreamPlay,
  onDownloadTrack,
  onlineProgress,
  onOpenResults,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [trackMenu, setTrackMenu] = useState<TrackMenuPosition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const { t } = useTranslation();
  const { colors } = useCurrentTheme();

  const isExpanded = isFocused && query.trim().length > 0;
  const { local, cloud, online, onlineLoading, onlineEnabled } = useGlobalSearch({
    query,
    active: isExpanded,
    localTracks,
    cloudTracks,
    libraryLimit: DROPDOWN_LIBRARY_LIMIT,
    onlineLimit: DROPDOWN_ONLINE_LIMIT,
  });

  const collapse = useCallback(() => {
    setIsFocused(false);
    setQuery('');
    setSelectedIndex(-1);
    setTrackMenu(null);
  }, []);

  const openResults = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsFocused(false);
    setSelectedIndex(-1);
    inputRef.current?.blur();
    onOpenResults(trimmed);
  }, [onOpenResults, query]);

  const sections = useMemo(() => {
    const libraryEntries = (tracks: Track[]): DropdownEntry[] => tracks.map(track => ({
      key: track.id,
      track,
      activate: () => { onNavigateToTrack(track); collapse(); },
    }));
    const onlineEntries: DropdownEntry[] = online.map(({ source, song }) => ({
      key: `${source}-${song.songmid}`,
      track: onlineSongToTrack(song, source),
      activate: () => onOnlineStreamPlay(song, source),
    }));
    return { local: libraryEntries(local.items), cloud: libraryEntries(cloud.items), online: onlineEntries };
  }, [cloud.items, collapse, local.items, onNavigateToTrack, onOnlineStreamPlay, online]);

  const entries = useMemo(
    () => [...sections.local, ...sections.cloud, ...sections.online],
    [sections],
  );
  // The trailing "see all results" option sits after every track entry.
  const viewAllIndex = entries.length;

  useEffect(() => {
    setSelectedIndex(-1);
    setTrackMenu(null);
  }, [query]);

  useEffect(() => {
    if (!isExpanded) return;
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Element;
      if (containerRef.current?.contains(target) || target.closest?.('[role="menu"]')) return;
      setIsFocused(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isExpanded]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      collapse();
      inputRef.current?.blur();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries[selectedIndex];
      if (entry) entry.activate();
      else openResults();
      return;
    }
    if (!isExpanded) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex(previous => Math.min(previous + 1, viewAllIndex));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex(previous => Math.max(previous - 1, 0));
    }
  }, [collapse, entries, isExpanded, openResults, selectedIndex, viewAllIndex]);

  const openTrackMenu = useCallback((track: Track, x: number, y: number, trigger: HTMLElement) => {
    setTrackMenu({ trackId: track.id, x, y, trigger });
  }, []);
  const closeTrackMenu = useCallback(() => setTrackMenu(null), []);
  const menuTrack = trackMenu ? sections.online.find(entry => entry.track.id === trackMenu.trackId)?.track : undefined;

  const optionId = (index: number) => `${listboxId}-option-${index}`;
  const renderRows = (list: DropdownEntry[], offset: number, withMenu: boolean) => list.map((entry, index) => {
    const songmid = entry.track.songmid;
    const progress = songmid && withMenu ? onlineProgress[songmid]?.percent : undefined;
    return (
      <SearchResultRow
        key={entry.key}
        id={optionId(offset + index)}
        track={entry.track}
        isSelected={selectedIndex === offset + index}
        colors={colors}
        progress={progress}
        onActivate={entry.activate}
        onOpenMenu={withMenu ? openTrackMenu : undefined}
      />
    );
  });

  const hasLocal = sections.local.length > 0;
  const hasCloud = sections.cloud.length > 0;
  const hasOnline = onlineEnabled && (sections.online.length > 0 || onlineLoading);
  const hasAny = hasLocal || hasCloud || hasOnline;
  const cloudOffset = sections.local.length;
  const onlineOffset = cloudOffset + sections.cloud.length;

  return (
    <div ref={containerRef} className="global-search-box">
      <div
        className={`global-search-surface${isExpanded ? ' global-search-surface--expanded' : ''}`}
        style={{
          '--search-background': colors.backgroundDark,
          '--search-border': colors.borderLight,
          '--search-shadow': 'var(--theme-elevated-shadow)',
        } as React.CSSProperties}
      >
        <div className="global-search-bar">
          <span className="material-symbols-outlined global-search-bar__icon" style={{ color: colors.textSecondary }}>search</span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={isExpanded}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={isExpanded && selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
            aria-label={t('search.typeToSearch')}
            placeholder={t('search.typeToSearch')}
            value={query}
            onChange={event => { setQuery(event.target.value); setIsFocused(true); }}
            onFocus={() => setIsFocused(true)}
            onKeyDown={handleKeyDown}
            className="global-search-bar__input"
            style={{ color: isWindowFocused ? colors.textPrimary : colors.textSecondary }}
          />
          {query && (
            <button type="button" onClick={collapse} aria-label={t('common.close')}
              className="global-search-bar__close" style={{ color: colors.textMuted }}>
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>

        <div className="global-search-results" aria-hidden={!isExpanded}>
          <div id={listboxId} role="listbox" className="global-search-results__scroll no-scrollbar">
            {!hasAny ? (
              <div className="global-search-empty" style={{ color: colors.textMuted }}>
                <span className="material-symbols-outlined">search_off</span>
                <p>{t('search.noResults')}</p>
              </div>
            ) : (
              <div className="search-result-sections">
                {hasLocal && (
                  <section className="search-result-section" role="group" aria-label={t('sidebar.local')}>
                    <SearchSectionLabel icon="hard_drive" label={t('sidebar.local')} count={local.total} colors={colors} />
                    {renderRows(sections.local, 0, false)}
                  </section>
                )}
                {hasCloud && (
                  <section className="search-result-section" role="group" aria-label={t('sidebar.cloud')}>
                    <SearchSectionLabel icon="cloud" label={t('sidebar.cloud')} count={cloud.total} colors={colors} />
                    {renderRows(sections.cloud, cloudOffset, false)}
                  </section>
                )}
                {hasOnline && (
                  <section className="search-result-section" role="group" aria-label={t('search.thirdPartySource')}>
                    <SearchSectionLabel icon="language" label={t('search.thirdPartySource')} isLoading={onlineLoading} colors={colors} />
                    {sections.online.length === 0
                      ? <div className="search-result-loading" style={{ color: colors.textMuted }}>{t('search.searching')}...</div>
                      : renderRows(sections.online, onlineOffset, true)}
                  </section>
                )}
              </div>
            )}
            <div
              id={optionId(viewAllIndex)}
              role="option"
              aria-selected={selectedIndex === viewAllIndex}
              tabIndex={-1}
              className={`search-view-all${selectedIndex === viewAllIndex ? ' search-view-all--selected' : ''}`}
              style={{ color: colors.primary, borderColor: colors.borderLight }}
              onClick={openResults}
            >
              <span>{t('search.viewAll')}</span>
              <span className="material-symbols-outlined" aria-hidden="true">keyboard_return</span>
            </div>
          </div>
        </div>
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
};

export default SearchBox;
