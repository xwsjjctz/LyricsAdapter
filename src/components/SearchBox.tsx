import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { match } from 'pinyin-pro';
import { useTranslation } from 'react-i18next';
import { cookieManager } from '../services/cookieManager';
import { i18n } from '../services/i18n';
import { logger } from '../services/logger';
import { neteaseMusicApi } from '../services/neteaseMusicApi';
import { type OnlineSong } from '../services/onlineMusicProvider';
import { qqMusicApi } from '../services/qqMusicApi';
import { settingsManager } from '../services/settingsManager';
import { themeManager } from '../services/themeManager';
import type { Track } from '../types';
import type { ThemeConfig } from '../types/theme';
import { OnlineSearchCard, SearchSectionLabel, TrackSearchCard } from './search/SearchResultCards';

const ONLINE_SEARCH_DEBOUNCE_MS = 500;
const MAX_RESULTS = 8;

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function trackMatchesSearch(track: Track, query: string): boolean {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return false;

  const searchText = [track.title, track.artist, track.album, track.fileName].filter(Boolean).join(' ');
  if (normalizeSearchText(searchText).includes(normalizeSearchText(trimmedQuery))) return true;

  return match(searchText, trimmedQuery, {
    insensitive: true,
    continuous: true,
    space: 'ignore',
  }) !== null;
}

interface SearchBoxProps {
  isWindowFocused?: boolean;
  localTracks: Track[];
  cloudTracks: Track[];
  onNavigateToTrack: (track: Track) => void;
  onOnlineDownload: (song: OnlineSong, quality: '128' | '320' | 'flac') => void;
  onOnlineUpload: (song: OnlineSong, quality: '128' | '320' | 'flac') => void;
  onOnlineStreamPlay: (song: OnlineSong, source: 'qq' | 'netease') => void;
  onlineProgress: Record<string, { type: 'download' | 'upload'; percent: number }>;
}

const SearchBox: React.FC<SearchBoxProps> = ({
  isWindowFocused,
  localTracks,
  cloudTracks,
  onNavigateToTrack,
  onOnlineDownload,
  onOnlineUpload,
  onOnlineStreamPlay,
  onlineProgress,
}) => {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [onlineResults, setOnlineResults] = useState<{ source: 'qq' | 'netease'; song: OnlineSong }[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [openQualityId, setOpenQualityId] = useState<string | null>(null);
  const [openUploadQualityId, setOpenUploadQualityId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());

  useEffect(() => themeManager.subscribe(() => setCurrentTheme(themeManager.getCurrentTheme())), []);

  const colors = currentTheme.colors;
  const isExpanded = isFocused && query.trim().length > 0;

  const filteredLocal = useMemo(() => {
    if (!query.trim()) return [];
    return localTracks.filter(track => trackMatchesSearch(track, query)).slice(0, MAX_RESULTS);
  }, [localTracks, query]);

  const filteredCloud = useMemo(() => {
    if (!query.trim()) return [];
    return cloudTracks.filter(track => trackMatchesSearch(track, query)).slice(0, MAX_RESULTS);
  }, [cloudTracks, query]);

  useEffect(() => {
    if (!query.trim() || !isExpanded || !settingsManager.getQqMusicEnabled()) {
      setOnlineResults([]);
      setOnlineLoading(false);
      return;
    }

    let isCurrentSearch = true;
    const searchQuery = query.trim();
    setOnlineResults([]);
    setOnlineLoading(true);
    const debounceTimer = setTimeout(async () => {
      const [qqResult, neteaseResult] = await Promise.allSettled([
        cookieManager.hasCookie() ? qqMusicApi.searchMusic(searchQuery, MAX_RESULTS) : Promise.resolve([] as OnlineSong[]),
        neteaseMusicApi.searchMusic(searchQuery, MAX_RESULTS),
      ]);

      if (!isCurrentSearch) return;

      if (qqResult.status === 'rejected') logger.warn('[SearchBox] QQ search failed:', qqResult.reason);
      if (neteaseResult.status === 'rejected') logger.warn('[SearchBox] NetEase search failed:', neteaseResult.reason);

      const qqSongs = qqResult.status === 'fulfilled' ? qqResult.value : [];
      const neteaseSongs = neteaseResult.status === 'fulfilled' ? neteaseResult.value : [];
      setOnlineResults([
        ...qqSongs.map(song => ({ source: 'qq' as const, song })),
        ...neteaseSongs.map(song => ({ source: 'netease' as const, song })),
      ]);
      setOnlineLoading(false);
    }, ONLINE_SEARCH_DEBOUNCE_MS);

    return () => {
      isCurrentSearch = false;
      clearTimeout(debounceTimer);
    };
  }, [query, isExpanded]);

  useEffect(() => {
    setSelectedIndex(-1);
    setOpenQualityId(null);
    setOpenUploadQualityId(null);
  }, [query]);

  useEffect(() => {
    if (!isExpanded) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsFocused(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isExpanded]);

  const collapse = useCallback(() => {
    setIsFocused(false);
    setQuery('');
    setSelectedIndex(-1);
  }, []);

  const totalItems = filteredLocal.length + filteredCloud.length + onlineResults.length;
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      collapse();
      inputRef.current?.blur();
      return;
    }
    if (!isExpanded || totalItems === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex(previous => Math.min(previous + 1, totalItems - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex(previous => Math.max(previous - 1, 0));
    } else if (event.key === 'Enter' && selectedIndex >= 0) {
      event.preventDefault();
      if (selectedIndex < filteredLocal.length) {
        onNavigateToTrack(filteredLocal[selectedIndex]!);
        collapse();
        return;
      }

      const cloudIndex = selectedIndex - filteredLocal.length;
      if (cloudIndex < filteredCloud.length) {
        onNavigateToTrack(filteredCloud[cloudIndex]!);
        collapse();
        return;
      }

      const onlineResult = onlineResults[cloudIndex - filteredCloud.length];
      if (onlineResult) onOnlineStreamPlay(onlineResult.song, onlineResult.source);
    }
  }, [collapse, filteredCloud, filteredLocal, isExpanded, onNavigateToTrack, onOnlineStreamPlay, onlineResults, selectedIndex, totalItems]);

  const hasLocal = filteredLocal.length > 0;
  const hasCloud = filteredCloud.length > 0;
  const onlineEnabled = settingsManager.getQqMusicEnabled();
  const hasOnline = onlineEnabled && (onlineResults.length > 0 || onlineLoading);
  const hasAny = hasLocal || hasCloud || hasOnline;
  const cloudOffset = filteredLocal.length;
  const onlineOffset = cloudOffset + filteredCloud.length;

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
            placeholder={t('search.typeToSearch')}
            value={query}
            onChange={event => { setQuery(event.target.value); setIsFocused(true); }}
            onFocus={() => setIsFocused(true)}
            onKeyDown={handleKeyDown}
            className="global-search-bar__input"
            style={{ color: isWindowFocused ? colors.textPrimary : colors.textSecondary }}
          />
          {query && (
            <button type="button" onClick={collapse} className="global-search-bar__close" style={{ color: colors.textMuted }}>
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>

        <div className="global-search-results" aria-hidden={!isExpanded}>
          <div className="global-search-results__scroll no-scrollbar">
            {!hasAny ? (
              <div className="global-search-empty" style={{ color: colors.textMuted }}>
                <span className="material-symbols-outlined">search_off</span>
                <p>{t('search.noResults')}</p>
              </div>
            ) : (
              <div className="search-result-sections">
                {hasLocal && (
                  <section className="search-result-section">
                    <SearchSectionLabel icon="hard_drive" label={t('sidebar.local')} count={filteredLocal.length} colors={colors} />
                    <div className="search-result-grid">
                      {filteredLocal.map((track, index) => (
                        <TrackSearchCard
                          key={track.id}
                          track={track}
                          source="local"
                          isSelected={selectedIndex === index}
                          colors={colors}
                          onClick={() => { onNavigateToTrack(track); collapse(); }}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {hasCloud && (
                  <section className="search-result-section">
                    <SearchSectionLabel icon="cloud" label={t('sidebar.cloud')} count={filteredCloud.length} colors={colors} />
                    <div className="search-result-grid">
                      {filteredCloud.map((track, index) => (
                        <TrackSearchCard
                          key={track.id}
                          track={track}
                          source="cloud"
                          isSelected={selectedIndex === cloudOffset + index}
                          colors={colors}
                          onClick={() => { onNavigateToTrack(track); collapse(); }}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {hasOnline && (
                  <section className="search-result-section">
                    <SearchSectionLabel
                      icon="language"
                      label={i18n.t('search.thirdPartySource')}
                      {...(onlineResults.length > 0 ? { count: onlineResults.length } : {})}
                      isLoading={onlineLoading}
                      colors={colors}
                    />
                    {onlineResults.length === 0 ? (
                      <div className="search-result-loading" style={{ color: colors.textMuted }}>{t('search.searching')}...</div>
                    ) : (
                      <div className="search-result-grid">
                        {onlineResults.map(({ source, song }, index) => (
                          <OnlineSearchCard
                            key={`${source}-${song.songmid}`}
                            song={song}
                            source={source}
                            isSelected={selectedIndex === onlineOffset + index}
                            colors={colors}
                            {...(onlineProgress[song.songmid] ? { progress: onlineProgress[song.songmid] } : {})}
                            isDownloadMenuOpen={openQualityId === song.songmid}
                            isUploadMenuOpen={openUploadQualityId === song.songmid}
                            onToggleDownloadMenu={() => {
                              setOpenUploadQualityId(null);
                              setOpenQualityId(previous => previous === song.songmid ? null : song.songmid);
                            }}
                            onToggleUploadMenu={() => {
                              setOpenQualityId(null);
                              setOpenUploadQualityId(previous => previous === song.songmid ? null : song.songmid);
                            }}
                            onDownload={quality => { onOnlineDownload(song, quality); setOpenQualityId(null); }}
                            onUpload={quality => { onOnlineUpload(song, quality); setOpenUploadQualityId(null); }}
                            onStreamPlay={() => onOnlineStreamPlay(song, source)}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchBox;
