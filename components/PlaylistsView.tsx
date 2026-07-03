import React from 'react';
import { Track } from '../types';
import { i18n } from '../services/i18n';
import { ThemeConfig } from '../types/theme';
import { logger } from '../services/logger';
import { qqMusicApi } from '../services/qqMusicApi';
import { neteaseMusicApi } from '../services/neteaseMusicApi';
import { cookieManager, neteaseCookieManager } from '../services/cookieManager';
import { type PlaylistInfo, type OnlineSong } from '../services/onlineMusicProvider';
import LibraryTrackRow from './LibraryTrackRow';

/**
 * 第三方音源歌单浏览器。
 *
 * 布局：
 * 1. 按源分组（QQ 音乐 / 网易云），每源一行横向滚动歌单卡片（≈4 个可见）。
 * 2. 每个卡片 = 封面 + 歌名。
 * 3. 点歌单 → 进入歌曲列表（左上角「← 返回」按钮）。
 * 4. 点歌曲 → 流式播放（复用 Branch A）→ 自动入 online LRU。
 *
 * 歌曲列表复用 LibraryTrackRow，与本地/云端音频列表保持一致的样式、
 * 滚动条与「定位到当前播放」能力。
 */

interface PlaylistsViewProps {
  colors: ThemeConfig['colors'];
  /** Currently playing track id — used to highlight + auto-locate rows in the detail list. */
  currentTrackId?: string;
  onOpenSettings?: () => void;
  onStreamPlay: (song: {
    songmid: string; title: string; artist: string; album: string;
    coverUrl?: string; duration: number;
  }, source: 'qq' | 'netease') => void;
}

interface TrackRow {
  songmid: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
}

type ViewState =
  | { phase: 'grid' }
  | { phase: 'detail'; playlist: PlaylistInfo; tracks: TrackRow[]; loading: boolean; error?: string };

/**
 * Remembers the last-opened playlist detail for the lifetime of the app
 * session. Re-entering the Playlists tab via the sidebar button restores this
 * view; only the in-detail back button clears it and returns to the grid list.
 * (PlaylistsView unmounts on every view switch, so this survives in module
 * scope rather than component state.)
 */
let lastDetail: { playlist: PlaylistInfo; tracks: TrackRow[] } | null = null;

/** Build a synthetic Track whose id matches the one handleOnlineStreamPlay assigns. */
const toTrack = (row: TrackRow, source: 'qq' | 'netease'): Track => ({
  id: `online-${source}-${row.songmid}`,
  title: row.title,
  artist: row.artist,
  album: row.album,
  duration: row.duration,
  coverUrl: row.coverUrl || undefined,
  audioUrl: '',
  source,
  songmid: row.songmid,
});

const PlaylistsView: React.FC<PlaylistsViewProps> = ({ colors, currentTrackId, onOpenSettings, onStreamPlay }) => {
  const [state, setState] = React.useState<ViewState>(() =>
    lastDetail
      ? { phase: 'detail', playlist: lastDetail.playlist, tracks: lastDetail.tracks, loading: false }
      : { phase: 'grid' }
  );
  const [playlists, setPlaylists] = React.useState<PlaylistInfo[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = React.useState(false);

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

  /** Load songs for a playlist and transition to detail. */
  const handlePlaylistClick = async (pl: PlaylistInfo) => {
    setState({ phase: 'detail', playlist: pl, tracks: [], loading: true });
    try {
      const provider = pl.source === 'qq' ? qqMusicApi : neteaseMusicApi;
      const songs: OnlineSong[] = await provider.getPlaylistSongs(pl.id);
      const tracks: TrackRow[] = songs.map(s => ({
        songmid: s.songmid,
        title: s.songname,
        artist: s.singer?.map(a => a.name).join(' & ') || 'Unknown Artist',
        album: s.albumname || 'Unknown Album',
        coverUrl: s.coverUrl || '',
        duration: s.interval || 0,
      }));
      lastDetail = { playlist: pl, tracks };
      setState({ phase: 'detail', playlist: pl, tracks, loading: false });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '加载失败';
      logger.error('[PlaylistsView] load songs failed:', e);
      setState({ phase: 'detail', playlist: pl, tracks: [], loading: false, error: message });
    }
  };

  // ── Detail list state ──
  const source = state.phase === 'detail' ? state.playlist.source : 'qq';
  const detailRows = state.phase === 'detail' ? state.tracks : [];

  const tracksAsTracks = React.useMemo<Track[]>(
    () => detailRows.map(r => toTrack(r, source)),
    [detailRows, source]
  );

  const currentRowIndex = currentTrackId
    ? detailRows.findIndex(r => `online-${source}-${r.songmid}` === currentTrackId)
    : -1;

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [showLocate, setShowLocate] = React.useState(false);

  const isCurrentVisible = React.useCallback(() => {
    const container = scrollRef.current;
    if (currentRowIndex < 0 || !container) return true;
    const node = container.querySelector(`[data-track-index="${currentRowIndex}"]`) as HTMLElement | null;
    if (!node) return false;
    const c = container.getBoundingClientRect();
    const n = node.getBoundingClientRect();
    return n.top >= c.top && n.bottom <= c.bottom;
  }, [currentRowIndex]);

  const scrollToCurrent = React.useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = scrollRef.current;
    if (!container || currentRowIndex < 0) return;
    const node = container.querySelector(`[data-track-index="${currentRowIndex}"]`) as HTMLElement | null;
    if (!node) return;
    const c = container.getBoundingClientRect();
    const n = node.getBoundingClientRect();
    // Delta from the row's current position to a centered position within the viewport.
    const delta = (n.top - c.top) - (container.clientHeight / 2 - n.height / 2);
    container.scrollBy({ top: delta, behavior });
  }, [currentRowIndex]);

  // Auto-locate when the current track changes (a song in this list starts
  // playing, or the user enters a playlist that contains the playing song).
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

  const handleScroll = React.useCallback(() => {
    setShowLocate(currentRowIndex >= 0 && !isCurrentVisible());
  }, [currentRowIndex, isCurrentVisible]);

  // Stable row handlers (refs keep them identity-stable so LibraryTrackRow's
  // memo isn't busted every render).
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const handleRowSelect = React.useCallback((idx: number) => {
    const s = stateRef.current;
    if (s.phase !== 'detail') return;
    const row = s.tracks[idx];
    if (!row) return;
    onStreamPlay(row, s.playlist.source);
  }, [onStreamPlay]);
  const noop = React.useCallback(() => {}, []);

  // ── Detail view ──
  if (state.phase === 'detail') {
    const { playlist, tracks, loading, error } = state;
    return (
      <div className="w-full flex flex-col h-full" style={{ color: colors.textPrimary }}>
        <div className="mb-4 flex-shrink-0 flex items-center gap-3">
          <button
            onClick={() => { lastDetail = null; setState({ phase: 'grid' }); }}
            className="flex items-center gap-1 transition-opacity hover:opacity-80"
            style={{ color: colors.textSecondary }}
          >
            <span className="material-symbols-outlined text-xl">arrow_back</span>
          </button>
          <h1 className="text-3xl truncate" style={{ color: 'var(--theme-text-primary, #fff)', fontWeight: 'var(--theme-text-heading-weight)', letterSpacing: 'var(--theme-heading-letter-spacing)' }}>
            {playlist.name}
          </h1>
        </div>
        {loading && (
          <div className="flex-1 flex items-center justify-center" style={{ color: colors.textMuted }}>
            <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
            {i18n.t('browse.loading')}
          </div>
        )}
        {error && (
          <div className="flex-1 flex items-center justify-center text-sm" style={{ color: colors.textMuted }}>
            {error}
          </div>
        )}
        {!loading && !error && tracks.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-sm" style={{ color: colors.textMuted }}>
            暂无歌曲
          </div>
        )}
        {!loading && !error && tracks.length > 0 && (
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
            <div className="relative flex-1 min-h-0">
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="h-full overflow-y-auto new-ux-scrollbar"
              >
                <div className="grid relative" style={{ gap: 'var(--theme-list-item-gap)' }}>
                  {tracksAsTracks.map((track, idx) => (
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
                      playingIndicator="inline"
                      onTrackSelect={handleRowSelect}
                      onToggleSelect={noop}
                      onEditMetadata={noop}
                      onDelete={noop}
                      onDragStart={noop}
                      onDragOver={noop}
                      onDragEnd={noop}
                    />
                  ))}
                </div>
              </div>
              {showLocate && currentRowIndex >= 0 && (
                <button
                  onClick={() => scrollToCurrent('smooth')}
                  className="absolute right-6 bottom-4 w-9 h-9 rounded-lg shadow-md flex items-center justify-center transition-all z-30 animate-fadeIn"
                  style={{
                    backgroundColor: colors.backgroundCard,
                    color: colors.textSecondary,
                  }}
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
      {/* Header — matches LibraryToolbar title style */}
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-3xl" style={{ color: 'var(--theme-text-primary, #fff)', fontWeight: 'var(--theme-text-heading-weight)', letterSpacing: 'var(--theme-heading-letter-spacing)' }}>
            {i18n.t('playlists.title')}
          </h1>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
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
