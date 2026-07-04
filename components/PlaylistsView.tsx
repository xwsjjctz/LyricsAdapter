import React from 'react';
import { Track } from '../types';
import { i18n } from '../services/i18n';
import { ThemeConfig } from '../types/theme';
import { logger } from '../services/logger';
import { themeManager } from '../services/themeManager';
import { resolveThemeAppearance } from '../services/themeAppearance';
import { qqMusicApi } from '../services/qqMusicApi';
import { neteaseMusicApi } from '../services/neteaseMusicApi';
import { cookieManager, neteaseCookieManager } from '../services/cookieManager';
import { type PlaylistInfo, type OnlineSong } from '../services/onlineMusicProvider';
import type { PlaylistsViewPersistence } from '../services/libraryStorage';
import LibraryTrackRow from './LibraryTrackRow';
import { useLibraryVirtualScroll } from '../hooks/useLibraryVirtualScroll';

/**
 * 第三方音源歌单浏览器。
 *
 * 歌曲列表复用 LibraryTrackRow + useLibraryVirtualScroll，与本地/云端音频列表
 * 使用同一套样式、虚拟滚动（≈15 行加载窗口）与「定位到当前播放」能力。
 *
 * 数据按页加载（QQ/网易云每页 PAGE_SIZE 首，滚到底部自动续拉）。
 *
 * 在歌单中点歌播放时，整个歌单会被加载为独立的 playlist 播放队列，因此
 * 上一首/下一首在歌单内顺序切换。
 */

const PAGE_SIZE = 15;
/** Distance from the bottom (px) at which the next page starts loading. */
const SCROLL_LOAD_THRESHOLD = 400;

interface PlaylistsViewProps {
  colors: ThemeConfig['colors'];
  /** Currently playing track id — highlights + auto-locates the matching row. */
  currentTrackId?: string;
  onOpenSettings?: () => void;
  /** Play `songs[clickedIndex]` and use the whole list as the next/prev queue. */
  onPlayPlaylist: (source: 'qq' | 'netease', songs: OnlineSong[], clickedIndex: number) => void;
  initialState: PlaylistsViewPersistence;
  onPersistenceChange: (state: PlaylistsViewPersistence) => void;
}

type DetailState = {
  phase: 'detail';
  playlist: PlaylistInfo;
  songs: OnlineSong[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error?: string;
};

type ViewState = { phase: 'grid' } | DetailState;

/**
 * Remembers the last-opened playlist detail for the lifetime of the app session.
 * Re-entering the Playlists tab via the sidebar button restores this view; only
 * the in-detail back button clears it. (PlaylistsView unmounts on every view
 * switch, so this lives in module scope.)
 */
let lastDetail: { playlist: PlaylistInfo; songs: OnlineSong[]; total: number; scrollPosition: number } | null = null;

/** Build a synthetic Track whose id matches the one assigned to online-slot tracks. */
const songToTrack = (s: OnlineSong, source: 'qq' | 'netease'): Track => ({
  id: `online-${source}-${s.songmid}`,
  title: s.songname,
  artist: s.singer?.map(a => a.name).join(' & ') || 'Unknown Artist',
  album: s.albumname || 'Unknown Album',
  duration: s.interval || 0,
  coverUrl: s.coverUrl || undefined,
  audioUrl: '',
  source,
  songmid: s.songmid,
});

/** Third-party playlist providers support offset/limit paging here. */
const supportsPaging = (_s: 'qq' | 'netease'): boolean => true;

const PlaylistsView: React.FC<PlaylistsViewProps> = ({ colors, currentTrackId, onOpenSettings, onPlayPlaylist, initialState, onPersistenceChange }) => {
  const restoredDetailRef = React.useRef(
    lastDetail ??
    (initialState.phase === 'detail' && initialState.playlist && initialState.songs
      ? {
          playlist: initialState.playlist,
          songs: initialState.songs,
          total: initialState.total ?? initialState.songs.length,
          scrollPosition: initialState.scrollPosition,
        }
      : null)
  );
  const [state, setState] = React.useState<ViewState>(() => {
    const restoredDetail = restoredDetailRef.current;
    return restoredDetail
      ? { phase: 'detail', playlist: restoredDetail.playlist, songs: restoredDetail.songs, total: restoredDetail.total, loading: false, loadingMore: false }
      : { phase: 'grid' };
  });
  const [playlists, setPlaylists] = React.useState<PlaylistInfo[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = React.useState(false);
  const [scrollTop, setScrollTop] = React.useState(restoredDetailRef.current?.scrollPosition ?? 0);
  const [gridScrollTop, setGridScrollTop] = React.useState(initialState.phase === 'grid' ? initialState.scrollPosition : 0);
  const [showLocate, setShowLocate] = React.useState(false);
  const [currentTheme, setCurrentTheme] = React.useState<ThemeConfig>(themeManager.getCurrentTheme());
  // Floating highlight band ("滑块") position — same model as LibraryView.
  const [highlightStyle, setHighlightStyle] = React.useState<{ top: number; height: number; opacity: number }>({ top: 0, height: 0, opacity: 0 });

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const gridScrollRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const pendingDetailScrollRestoreRef = React.useRef<number | null>(restoredDetailRef.current?.scrollPosition ?? null);
  const pendingGridScrollRestoreRef = React.useRef<number | null>(initialState.phase === 'grid' ? initialState.scrollPosition : null);

  // Keep the playing-indicator mode in sync with the active theme (floating vs inline).
  React.useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => setCurrentTheme(themeManager.getCurrentTheme()));
    return unsubscribe;
  }, []);
  const playingIndicator = resolveThemeAppearance(currentTheme).playingIndicator;

  // On mount, load playlists from all logged-in providers.
  React.useEffect(() => {
    const load = async () => {
      setLoadingPlaylists(true);
      const results: PlaylistInfo[] = [];
      try {
        if (cookieManager.hasCookie()) {
          const qq = await qqMusicApi.getPlaylists();
          results.push(...qq.map(p => ({ ...p, source: 'qq' as const })));
        }
      } catch (e) {
        logger.warn('[PlaylistsView] QQ playlists failed:', e);
      }
      try {
        if (neteaseCookieManager.hasCookie()) {
          const netease = await neteaseMusicApi.getPlaylists();
          results.push(...netease.map(p => ({ ...p, source: 'netease' as const })));
        }
      } catch (e) {
        logger.warn('[PlaylistsView] NetEase playlists failed:', e);
      }
      setPlaylists(results);
      setLoadingPlaylists(false);
    };
    load();
  }, []);

  const grouped = React.useMemo(() => {
    const map = new Map<'qq' | 'netease', PlaylistInfo[]>();
    for (const p of playlists) {
      const arr = map.get(p.source) ?? [];
      arr.push(p);
      map.set(p.source, arr);
    }
    return map;
  }, [playlists]);

  const sourceLabel = (s: 'qq' | 'netease'): string =>
    s === 'qq' ? 'QQ 音乐' : '网易云音乐';

  const fetchPage = async (pl: PlaylistInfo, offset: number): Promise<OnlineSong[]> => {
    if (pl.source === 'qq') return qqMusicApi.getPlaylistSongs(pl.id, offset, PAGE_SIZE);
    return neteaseMusicApi.getPlaylistSongs(pl.id, offset, PAGE_SIZE);
  };

  /** Load the first page and transition to detail. */
  const handlePlaylistClick = async (pl: PlaylistInfo) => {
    setState({ phase: 'detail', playlist: pl, songs: [], total: Math.max(pl.songCount, 0), loading: true, loadingMore: false });
    setScrollTop(0);
    pendingDetailScrollRestoreRef.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    try {
      const first = await fetchPage(pl, 0);
      const total = supportsPaging(pl.source) ? Math.max(pl.songCount, first.length) : first.length;
      lastDetail = { playlist: pl, songs: first, total, scrollPosition: 0 };
      setState({ phase: 'detail', playlist: pl, songs: first, total, loading: false, loadingMore: false });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '加载失败';
      logger.error('[PlaylistsView] load songs failed:', e);
      setState({ phase: 'detail', playlist: pl, songs: [], total: 0, loading: false, loadingMore: false, error: message });
    }
  };

  // ── Detail-derived values ──
  const source = state.phase === 'detail' ? state.playlist.source : 'qq';
  const detailSongs = state.phase === 'detail' ? state.songs : [];
  const loadingMore = state.phase === 'detail' ? state.loadingMore : false;
  const total = state.phase === 'detail' ? state.total : 0;
  const hasMore = state.phase === 'detail' && supportsPaging(source) && detailSongs.length < total;

  React.useEffect(() => {
    if (state.phase === 'detail') {
      lastDetail = {
        playlist: state.playlist,
        songs: state.songs,
        total: state.total,
        scrollPosition: scrollTop,
      };
      onPersistenceChange({
        phase: 'detail',
        playlist: state.playlist,
        songs: state.songs,
        total: state.total,
        scrollPosition: scrollTop,
      });
      return;
    }

    onPersistenceChange({
      phase: 'grid',
      scrollPosition: gridScrollTop,
    });
  }, [state, scrollTop, gridScrollTop, onPersistenceChange]);

  React.useLayoutEffect(() => {
    if (state.phase !== 'detail') return;
    const target = pendingDetailScrollRestoreRef.current;
    const el = scrollRef.current;
    if (target === null || !el) return;
    el.scrollTop = target;
    setScrollTop(target);
    pendingDetailScrollRestoreRef.current = null;
  }, [state.phase, detailSongs.length]);

  React.useLayoutEffect(() => {
    if (state.phase !== 'grid') return;
    const target = pendingGridScrollRestoreRef.current;
    const el = gridScrollRef.current;
    if (target === null || !el) return;
    el.scrollTop = target;
    setGridScrollTop(target);
    pendingGridScrollRestoreRef.current = null;
  }, [state.phase, playlists.length, loadingPlaylists]);

  const tracksAsTracks = React.useMemo<Track[]>(
    () => detailSongs.map(s => songToTrack(s, source)),
    [detailSongs, source]
  );
  const currentRowIndex = currentTrackId
    ? detailSongs.findIndex(s => `online-${source}-${s.songmid}` === currentTrackId)
    : -1;

  const {
    baseRowHeight,
    rowStride,
    startIndex,
    endIndex,
    paddingTop,
    paddingBottom,
    rowMeasureRef,
  } = useLibraryVirtualScroll({
    itemCount: tracksAsTracks.length,
    scrollTop,
    scrollContainerRef: scrollRef,
    listRef,
    isEditMode: false,
    topInset: 0,
  });

  // Position the floating highlight band purely from the index (idx * rowStride),
  // mirroring LibraryView's default-mode math. Index-based means the band stays
  // put even when the current row is virtualized out of the rendered window, and
  // it rides the scroll via the translateY(top - scrollTop) transform in JSX.
  React.useEffect(() => {
    if (currentRowIndex < 0 || detailSongs.length === 0) {
      setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
      return;
    }
    setHighlightStyle({ top: currentRowIndex * rowStride, height: baseRowHeight, opacity: 1 });
  }, [currentRowIndex, rowStride, baseRowHeight, detailSongs.length]);

  // Locate math is index-based (no DOM query) so it stays correct even when the
  // current row is virtualized out of the rendered window.
  const isCurrentVisible = React.useCallback(() => {
    const container = scrollRef.current;
    if (currentRowIndex < 0 || !container) return true;
    const itemTop = currentRowIndex * rowStride;
    const itemBottom = itemTop + baseRowHeight;
    return itemTop >= container.scrollTop && itemBottom <= container.scrollTop + container.clientHeight;
  }, [currentRowIndex, rowStride, baseRowHeight]);

  const scrollToCurrent = React.useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = scrollRef.current;
    if (!container || currentRowIndex < 0 || rowStride <= 0) return;
    const target = currentRowIndex * rowStride - (container.clientHeight / 2 - baseRowHeight / 2);
    const max = container.scrollHeight - container.clientHeight;
    container.scrollTo({ top: Math.max(0, Math.min(target, max)), behavior });
  }, [currentRowIndex, rowStride, baseRowHeight]);

  // Auto-locate when the current track changes.
  React.useEffect(() => {
    if (currentRowIndex < 0) {
      setShowLocate(false);
      return;
    }
    const id = requestAnimationFrame(() => {
      if (!isCurrentVisible()) scrollToCurrent('smooth');
      setShowLocate(!isCurrentVisible());
    });
    return () => cancelAnimationFrame(id);
  }, [currentRowIndex, isCurrentVisible, scrollToCurrent]);

  /** Append the next page when scrolling near the bottom. */
  const loadMore = React.useCallback(async () => {
    const s = stateRef.current;
    if (s.phase !== 'detail') return;
    if (!supportsPaging(s.playlist.source) || s.loading || s.loadingMore) return;
    if (s.songs.length >= s.total) return;
    setState(prev => (prev.phase === 'detail' ? { ...prev, loadingMore: true } : prev));
    try {
      const next = await fetchPage(s.playlist, s.songs.length);
      if (next.length === 0) {
        setState(prev => (prev.phase === 'detail' ? { ...prev, loadingMore: false, total: s.songs.length } : prev));
        return;
      }
      const songs = [...s.songs, ...next];
      lastDetail = { playlist: s.playlist, songs, total: s.total, scrollPosition: scrollRef.current?.scrollTop ?? scrollTop };
      setState(prev => (prev.phase === 'detail' ? { ...prev, songs, loadingMore: false } : prev));
    } catch (e) {
      logger.warn('[PlaylistsView] load more failed:', e);
      setState(prev => (prev.phase === 'detail' ? { ...prev, loadingMore: false } : prev));
    }
  }, []);

  React.useEffect(() => {
    if (!hasMore || loadingMore) return;
    const container = scrollRef.current;
    if (!container) return;
    if (container.scrollHeight <= container.clientHeight + SCROLL_LOAD_THRESHOLD) {
      void loadMore();
    }
  }, [detailSongs.length, hasMore, loadingMore, loadMore]);

  /**
   * Play the clicked row immediately using whatever songs are already loaded.
   * Previously this blocked on a serial while-loop that fetched the ENTIRE
   * playlist (page by page) before starting playback — a 660-song playlist
   * meant ~44 sequential network round-trips (~22s) of frozen UI. Remaining
   * songs are still loaded lazily by scrolling (loadMore), and a user who
   * wants the full queue can scroll to load more then replay.
   */
  const handleRowSelect = React.useCallback((idx: number) => {
    const s = stateRef.current;
    if (s.phase !== 'detail') return;
    onPlayPlaylist(s.playlist.source, s.songs, idx);
  }, [onPlayPlaylist]);

  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_LOAD_THRESHOLD) {
      void loadMore();
    }
    setShowLocate(currentRowIndex >= 0 && !isCurrentVisible());
  }, [loadMore, currentRowIndex, isCurrentVisible]);

  const noop = React.useCallback(() => {}, []);

  // ── Detail view ──
  if (state.phase === 'detail') {
    const { playlist, loading, error } = state;
    const visibleTracks = tracksAsTracks.slice(startIndex, endIndex);
    const showList = (!loading || detailSongs.length > 0) && !error;
    return (
      <div className="w-full flex flex-col h-full" style={{ color: colors.textPrimary }}>
        <div className="mb-4 flex-shrink-0 flex items-center gap-3">
          <button
            onClick={() => {
              lastDetail = null;
              setState({ phase: 'grid' });
              setGridScrollTop(0);
              pendingGridScrollRestoreRef.current = 0;
            }}
            className="flex items-center gap-1 transition-opacity hover:opacity-80"
            style={{ color: colors.textSecondary }}
          >
            <span className="material-symbols-outlined text-xl">arrow_back</span>
          </button>
          <h1 className="text-3xl truncate" style={{ color: 'var(--theme-text-primary, #fff)', fontWeight: 'var(--theme-text-heading-weight)', letterSpacing: 'var(--theme-heading-letter-spacing)' }}>
            {playlist.name}
          </h1>
        </div>
        {loading && detailSongs.length === 0 && (
          <div className="flex-1 flex items-center justify-center" style={{ color: colors.textMuted }}>
            <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
            {i18n.t('browse.loading')}
          </div>
        )}
        {error && detailSongs.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-sm" style={{ color: colors.textMuted }}>
            {error}
          </div>
        )}
        {!loading && !error && detailSongs.length === 0 && !hasMore && (
          <div className="flex-1 flex items-center justify-center text-sm" style={{ color: colors.textMuted }}>
            暂无歌曲
          </div>
        )}
        {showList && (
          <>
            <div className="flex-shrink-0">
              <div
                className="grid gap-4 px-4 py-2 text-xs font-bold uppercase tracking-widest grid-cols-[48px_1fr_1fr_120px] select-none mb-2"
                style={{ color: colors.textMuted, borderBottom: `1px solid ${colors.borderLight}` }}
              >
                <span>#</span>
                <span>{i18n.t('library.titleCol')}</span>
                <span className="pl-8">{i18n.t('library.albumCol')}</span>
                <span className="text-right">{i18n.t('library.timeCol')}</span>
              </div>
            </div>
            <div className="relative flex-1 min-h-0 overflow-hidden">
              {/* Floating current-track highlight band ("滑块") — same markup/style
                  as LibraryView. Rendered as a sibling of the scroll container so it
                  isn't clipped, and translated by (top - scrollTop) to track the row. */}
              <div className="absolute inset-0 pointer-events-none">
                {playingIndicator === 'floating' && highlightStyle.opacity > 0 && (
                  <div
                    className="absolute pointer-events-none transition-[transform,height] duration-150 ease-out"
                    style={{
                      transform: `translateY(${highlightStyle.top - scrollTop}px)`,
                      height: `${highlightStyle.height}px`,
                      opacity: highlightStyle.opacity,
                      left: 0,
                      right: 0,
                      backgroundColor: 'color-mix(in srgb, var(--theme-control-current-track-band-tint) 15%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--theme-control-current-track-band-tint) 25%, transparent)',
                      boxShadow: 'var(--theme-elevated-shadow)',
                      borderRadius: 'var(--theme-control-radius)',
                    }}
                  />
                )}
              </div>
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="h-full min-h-0 overflow-y-auto no-scrollbar"
              >
                <div
                  ref={listRef}
                  className="grid relative"
                  style={{ gap: 'var(--theme-list-item-gap)', paddingTop, paddingBottom, paddingRight: playingIndicator === 'inline' ? 6 : undefined }}
                >
                  {visibleTracks.map((track, i) => {
                    const idx = startIndex + i;
                    return (
                      <LibraryTrackRow
                        key={`${track.id}-${idx}`}
                        track={track}
                        filteredIndex={idx}
                        realTrackIndex={idx}
                        isCurrentTrack={idx === currentRowIndex}
                        isEditMode={false}
                        isSelected={false}
                        isDragged={false}
                        shouldShowAnimation={false}
                        colors={colors}
                        playingIndicator={playingIndicator}
                        measureRef={i === 0 ? rowMeasureRef : undefined}
                        onTrackSelect={handleRowSelect}
                        onToggleSelect={noop}
                        onEditMetadata={noop}
                        onDelete={noop}
                        onDragStart={noop}
                        onDragOver={noop}
                        onDragEnd={noop}
                      />
                    );
                  })}
                </div>
                {(loadingMore || hasMore) && (
                  <div className="flex items-center justify-center py-4" style={{ color: colors.textMuted }}>
                    <span className="material-symbols-outlined animate-spin mr-2 text-lg">progress_activity</span>
                    <span className="text-xs">
                      {loadingMore
                        ? '加载更多…'
                        : `已加载 ${detailSongs.length}/${total}`}
                    </span>
                  </div>
                )}
              </div>
              {showLocate && currentRowIndex >= 0 && (
                <button
                  onClick={() => scrollToCurrent('smooth')}
                  className="absolute right-6 bottom-4 w-9 h-9 rounded-lg shadow-md flex items-center justify-center transition-all z-30"
                  style={{ backgroundColor: colors.backgroundCard, color: colors.textSecondary }}
                  title={i18n.t('library.locateToCurrent')}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.textPrimary; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textSecondary; }}
                >
                  <span className="material-symbols-outlined text-lg">my_location</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Grid view ──
  return (
    <div className="w-full flex flex-col h-full" style={{ color: colors.textPrimary }}>
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-3xl" style={{ color: 'var(--theme-text-primary, #fff)', fontWeight: 'var(--theme-text-heading-weight)', letterSpacing: 'var(--theme-heading-letter-spacing)' }}>
            {i18n.t('playlists.title')}
          </h1>
        </div>
      </div>

      <div
        ref={gridScrollRef}
        className="flex-1 overflow-y-auto"
        onScroll={() => setGridScrollTop(gridScrollRef.current?.scrollTop ?? 0)}
      >
        {loadingPlaylists && (
          <div className="flex items-center gap-2 py-20 justify-center" style={{ color: colors.textMuted }}>
            <span className="material-symbols-outlined animate-spin">progress_activity</span>
            <span>{i18n.t('browse.loading')}</span>
          </div>
        )}
        {!loadingPlaylists && playlists.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-20" style={{ color: colors.textMuted }}>
            <span className="material-symbols-outlined text-6xl">queue_music</span>
            <span className="text-sm">{i18n.t('playlists.emptyLoginHint')}</span>
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-all"
                style={{
                  backgroundColor: colors.backgroundCard,
                  color: colors.textSecondary,
                  borderRadius: 'var(--theme-control-radius)',
                  border: `1px solid ${colors.borderLight}`,
                }}
              >
                <span className="material-symbols-outlined text-lg">settings</span>
                <span>{i18n.t('browse.openSettings')}</span>
              </button>
            )}
          </div>
        )}
        {[...grouped.entries()].map(([src, list]) => (
          <div key={src} className="mb-6">
            <h2 className="text-base font-semibold mb-3" style={{ color: colors.textSecondary }}>
              {sourceLabel(src)}
            </h2>
            <div className="flex gap-3 overflow-x-auto p-2 no-scrollbar">
              {list.map((pl) => (
                <button
                  key={pl.id}
                  className="flex-shrink-0 w-[140px] text-left transition-transform hover:scale-105"
                  onClick={() => handlePlaylistClick(pl)}
                >
                  <div
                    className="w-[140px] h-[140px] rounded-xl overflow-hidden bg-cover bg-center shadow-md"
                    style={{ backgroundImage: pl.coverUrl ? `url(${pl.coverUrl})` : undefined, backgroundColor: colors.backgroundCard }}
                  >
                    {!pl.coverUrl && (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="material-symbols-outlined text-5xl" style={{ color: colors.textMuted }}>music_note</span>
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm font-medium truncate" style={{ color: colors.textPrimary }}>{pl.name}</p>
                  <p className="text-xs" style={{ color: colors.textMuted }}>{pl.songCount} 首</p>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PlaylistsView;
