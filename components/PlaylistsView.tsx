import React from 'react';
import { i18n } from '../services/i18n';
import { ThemeConfig } from '../types/theme';
import { logger } from '../services/logger';
import { qqMusicApi } from '../services/qqMusicApi';
import { neteaseMusicApi } from '../services/neteaseMusicApi';
import { cookieManager, neteaseCookieManager } from '../services/cookieManager';
import { type PlaylistInfo, type OnlineSong } from '../services/onlineMusicProvider';

/**
 * 第三方音源歌单浏览器。
 *
 * 布局：
 * 1. 按源分组（QQ 音乐 / 网易云），每源一行横向滚动歌单卡片（≈4 个可见）。
 * 2. 每个卡片 = 封面 + 歌名。
 * 3. 点歌单 → 进入歌曲列表（左上角「← 返回」按钮）。
 * 4. 点歌曲 → 流式播放（复用 Branch A）→ 自动入 online LRU。
 */

interface PlaylistsViewProps {
  colors: ThemeConfig['colors'];
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

const PlaylistsView: React.FC<PlaylistsViewProps> = ({ colors, onStreamPlay }) => {
  const [state, setState] = React.useState<ViewState>({ phase: 'grid' });
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
      setState({ phase: 'detail', playlist: pl, tracks, loading: false });
    } catch (e: any) {
      logger.error('[PlaylistsView] load songs failed:', e);
      setState({ phase: 'detail', playlist: pl, tracks: [], loading: false, error: e.message || '加载失败' });
    }
  };

  const renderTrackList = (tracks: TrackRow[]) => (
    <div className="flex-1 overflow-y-auto no-scrollbar space-y-0.5">
      {tracks.map((tr, idx) => (
        <button
          key={`${tr.songmid}-${idx}`}
          onClick={() => onStreamPlay(tr, state.phase === 'detail' ? state.playlist.source : 'qq')}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors text-left hover:bg-[var(--theme-control-item-bg-hover)]"
          style={{ color: colors.textPrimary }}
        >
          <span className="text-xs w-6 text-center flex-shrink-0" style={{ color: colors.textMuted }}>
            {idx + 1}
          </span>
          <div
            className="size-10 rounded-lg bg-cover bg-center flex-shrink-0"
            style={{ backgroundImage: tr.coverUrl ? `url(${tr.coverUrl})` : undefined, backgroundColor: colors.backgroundCard }}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{tr.title}</div>
            <div className="text-xs truncate" style={{ color: colors.textMuted }}>{tr.artist}</div>
          </div>
          <span className="text-xs tabular-nums flex-shrink-0" style={{ color: colors.textMuted }}>
            {Math.floor(tr.duration / 60)}:{String(Math.floor(tr.duration % 60)).padStart(2, '0')}
          </span>
        </button>
      ))}
    </div>
  );

  // ── Detail view ──
  if (state.phase === 'detail') {
    const { playlist, tracks, loading, error } = state;
    return (
      <div className="px-6 py-4 h-full flex flex-col" style={{ color: colors.textPrimary }}>
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => setState({ phase: 'grid' })}
            className="flex items-center gap-1 text-sm transition-opacity hover:opacity-80"
            style={{ color: colors.textSecondary }}
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            返回
          </button>
          <h2 className="text-lg font-semibold truncate" style={{ color: colors.textPrimary }}>
            {playlist.name}
          </h2>
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
        {!loading && !error && tracks.length > 0 && renderTrackList(tracks)}
      </div>
    );
  }

  // ── Grid view ──
  return (
    <div className="px-6 py-4 overflow-y-auto h-full" style={{ color: colors.textPrimary }}>
      {loadingPlaylists && (
        <div className="flex items-center gap-2 py-20 justify-center" style={{ color: colors.textMuted }}>
          <span className="material-symbols-outlined animate-spin">progress_activity</span>
          <span>{i18n.t('browse.loading')}</span>
        </div>
      )}
      {!loadingPlaylists && playlists.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20" style={{ color: colors.textMuted }}>
          <span className="material-symbols-outlined text-6xl">queue_music</span>
          <span className="text-sm">暂无歌单，请先登录第三方音源</span>
        </div>
      )}
      {[...grouped.entries()].map(([source, list]) => (
        <div key={source} className="mb-6">
          <h2 className="text-base font-semibold mb-3" style={{ color: colors.textSecondary }}>
            {sourceLabel(source)}
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
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
  );
};

export default PlaylistsView;
