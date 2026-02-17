import React, { useState, useEffect, useCallback } from 'react';
import { QQMusicSong, qqMusicApi } from '../services/qqMusicApi';
import { cookieManager } from '../services/cookieManager';
import { settingsManager } from '../services/settingsManager';
import { logger } from '../services/logger';
import SettingsDialog from './SettingsDialog';

interface BrowseViewProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

interface DownloadProgress {
  [songmid: string]: {
    progress: number;
    status: 'downloading' | 'completed' | 'error';
  };
}

const BrowseView: React.FC<BrowseViewProps> = ({ searchQuery, onSearchChange }) => {
  const [songs, setSongs] = useState<QQMusicSong[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({});
  const [hasSearched, setHasSearched] = useState(false);

  // Check cookie on mount
  useEffect(() => {
    const checkCookie = async () => {
      if (!cookieManager.hasCookie() || cookieManager.shouldCheckCookie()) {
        const status = await cookieManager.validateCookie();
        if (!status.valid) {
          setShowSettingsDialog(true);
        } else {
          loadRecommendations();
        }
      } else {
        loadRecommendations();
      }
    };
    checkCookie();
  }, []);

  // Handle external search query changes
  useEffect(() => {
    if (searchQuery) {
      handleSearch(searchQuery);
    } else if (hasSearched) {
      // Clear search and go back to recommendations
      loadRecommendations();
    }
  }, [searchQuery]);

  const loadRecommendations = async () => {
    if (!cookieManager.hasCookie()) {
      setError('请先设置QQ音乐Cookie');
      setShowSettingsDialog(true);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      console.log('[BrowseView] Loading recommendations...');
      const songs = await qqMusicApi.getRecommendedSongs();
      console.log('[BrowseView] Got songs:', songs.length);
      
      if (!songs || songs.length === 0) {
        setError('未获取到推荐歌曲，请检查Cookie是否有效');
      } else {
        setSongs(songs);
        setHasSearched(false);
      }
    } catch (err: any) {
      console.error('[BrowseView] Failed to load recommendations:', err);
      logger.error('[BrowseView] Failed to load recommendations:', err);
      const errorMsg = err.message || '';
      if (errorMsg.includes('CORS') || errorMsg.includes('Failed to fetch')) {
        setError('浏览器安全限制：无法直接访问QQ音乐API。请在桌面端使用此功能。');
      } else if (errorMsg.includes('Cookie')) {
        setShowSettingsDialog(true);
      } else {
        setError(errorMsg || '加载推荐音乐失败，请检查网络连接或Cookie有效性');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      loadRecommendations();
      return;
    }

    if (!cookieManager.hasCookie()) {
      setShowSettingsDialog(true);
      return;
    }

    setIsLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const results = await qqMusicApi.searchMusic(query, 30);
      setSongs(results);
    } catch (err: any) {
      logger.error('[BrowseView] Search failed:', err);
      const errorMsg = err.message || '';
      if (errorMsg.includes('CORS') || errorMsg.includes('Failed to fetch')) {
        setError('浏览器安全限制：无法直接访问QQ音乐API。请在桌面端使用此功能。');
      } else if (errorMsg.includes('Cookie')) {
        setError('Cookie已过期，请重新设置');
        setShowSettingsDialog(true);
      } else {
        setError(errorMsg || '搜索失败，请稍后重试');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSettingsDialogClose = () => {
    setShowSettingsDialog(false);
    // Reload recommendations in case cookie was updated
    if (cookieManager.hasCookie()) {
      loadRecommendations();
    }
  };

  const handleDownload = async (song: QQMusicSong, quality: 'm4a' | '128' | '320' | 'flac' = '128') => {
    // Prevent re-download if already downloading or completed
    const currentStatus = downloadProgress[song.songmid]?.status;
    if (currentStatus === 'downloading' || currentStatus === 'completed') return;

    // Check if in Electron environment
    const isElectron = typeof window !== 'undefined' && !!(window as any).electron;

    // Get download path from settings
    const downloadPath = settingsManager.getDownloadPath();

    // Check if download path is set
    if (isElectron && !downloadPath) {
      setError('请先在设置中选择下载目录');
      setShowSettingsDialog(true);
      return;
    }

    setDownloadProgress(prev => ({
      ...prev,
      [song.songmid]: { progress: 0, status: 'downloading' }
    }));

    try {
      console.log('[BrowseView] Starting download for:', song.songname, 'quality:', quality);
      const singer = song.singer?.[0]?.name || 'Unknown';

      // Get download URL first
      const { url } = await qqMusicApi.getMusicUrl(song.songmid, quality);
      console.log('[BrowseView] Got download URL:', url);

      console.log('[BrowseView] Download path:', downloadPath);

      const ext = quality === 'flac' ? 'flac' : quality === 'm4a' ? 'm4a' : 'mp3';
      const fileName = `${singer} - ${song.songname}.${ext}`;

      let savedFilePath: string | undefined;

      if (isElectron && (window as any).electron?.downloadAndSave && downloadPath) {
        // Use new download-and-save method (non-blocking)
        // Ensure downloadPath ends with path separator
        const separator = downloadPath.endsWith('/') || downloadPath.endsWith('\\') ? '' : '/';
        const fullPath = downloadPath + separator + fileName;
        console.log('[BrowseView] Downloading directly to:', fullPath);

        const rawCookie = cookieManager.getCookie();
        const result = await (window as any).electron.downloadAndSave(url, rawCookie, fullPath);

        if (!result.success) {
          throw new Error(`下载失败: ${result.error}`);
        }

        savedFilePath = result.filePath;
        console.log('[BrowseView] File downloaded successfully to:', savedFilePath);

        // Update progress to 100%
        setDownloadProgress(prev => ({
          ...prev,
          [song.songmid]: { progress: 100, status: 'downloading' }
        }));

        // Write metadata to the saved file
        if (savedFilePath && (window as any).electron?.writeAudioMetadata) {
          console.log('[BrowseView] Writing metadata...');
          
          // Get album name from song data
          const albumName = song.albumname || '';
          
          // Build cover URL from albummid
          const coverUrl = song.albummid 
            ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${song.albummid}.jpg`
            : undefined;

          // Fetch lyrics via Electron main process (avoids CORS)
          let lyrics: string | undefined;
          try {
            console.log('[BrowseView] Fetching lyrics for:', song.songmid);
            const rawCookie = cookieManager.getCookie();
            const lyricsResult = await (window as any).electron.getQQMusicLyrics(song.songmid, rawCookie);
            if (lyricsResult && lyricsResult.success && lyricsResult.lyrics) {
              lyrics = lyricsResult.lyrics;
              console.log('[BrowseView] Lyrics fetched, length:', lyrics.length);
            } else {
              console.warn('[BrowseView] Failed to fetch lyrics:', lyricsResult?.error);
            }
          } catch (e) {
            console.warn('[BrowseView] Failed to fetch lyrics:', e);
          }

          const metadataResult = await (window as any).electron.writeAudioMetadata(
            savedFilePath,
            {
              title: song.songname,
              artist: singer,
              album: albumName,
              coverUrl: coverUrl,
              lyrics: lyrics,
            }
          );
          
          if (metadataResult.success) {
            console.log('[BrowseView] Metadata written successfully');
          } else {
            console.error('[BrowseView] Metadata write failed:', metadataResult.error);
          }
        }
      } else {
        // Browser fallback - download via blob
        try {
          const blob = await qqMusicApi.downloadAudio(song.songmid, song.songname, singer, quality);
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        } catch (e) {
          console.error('[BrowseView] Browser download failed:', e);
        }
      }

      setDownloadProgress(prev => ({
        ...prev,
        [song.songmid]: { progress: 100, status: 'completed' }
      }));

      // Clear progress after 3 seconds
      setTimeout(() => {
        setDownloadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[song.songmid];
          return newProgress;
        });
      }, 3000);
    } catch (err: any) {
      logger.error('[BrowseView] Download failed:', err);
      console.error('[BrowseView] Download error:', err);
      
      const errorMsg = err.message || '';
      // If it's a cookie error, show settings dialog
      if (errorMsg.includes('Cookie') || errorMsg.includes('cookie')) {
        setError('Cookie已过期，请重新设置');
        setShowSettingsDialog(true);
      }
      
      setDownloadProgress(prev => ({
        ...prev,
        [song.songmid]: { progress: 0, status: 'error' }
      }));

      // Clear error state after 5 seconds
      setTimeout(() => {
        setDownloadProgress(prev => {
          // Only clear if still in error state (not if user started new download)
          if (prev[song.songmid]?.status === 'error') {
            const newProgress = { ...prev };
            delete newProgress[song.songmid];
            return newProgress;
          }
          return prev;
        });
      }, 5000);
    }
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="max-w-5xl mx-auto w-full flex flex-col h-full">
      {/* Header */}
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold mb-2">Browse</h1>
          <p className="text-white/40">
            {hasSearched 
              ? `Search results for "${searchQuery}"` 
              : 'Recommended'}
          </p>
        </div>
        <button
          onClick={() => setShowSettingsDialog(true)}
          className="w-10 h-10 rounded-xl bg-white/10 text-white/60 hover:bg-primary/20 hover:text-primary transition-all flex items-center justify-center"
          title="Settings"
        >
          <span className="material-symbols-outlined">settings</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <span className="material-symbols-outlined text-4xl text-primary animate-spin">refresh</span>
              <p className="text-white/60">加载中...</p>
            </div>
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <span className="material-symbols-outlined text-6xl text-red-400 mb-4 block">error</span>
              <p className="text-xl font-medium text-red-400 mb-2">出错了</p>
              <p className="text-sm text-white/60 mb-6">{error}</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => loadRecommendations()}
                  className="px-4 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-all"
                >
                  重试
                </button>
                {!error.includes('浏览器') && !error.includes('桌面端') && (
                  <button
                    onClick={() => setShowSettingsDialog(true)}
                    className="px-4 py-2 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 transition-all"
                  >
                    打开设置
                  </button>
                )}
              </div>
              {(error.includes('CORS') || error.includes('浏览器') || error.includes('桌面端')) && (
                <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                  <p className="text-xs text-yellow-400/80">
                    <span className="material-symbols-outlined text-sm align-text-bottom mr-1">lightbulb</span>
                    提示：浏览功能需要在Electron桌面端使用，因为浏览器存在CORS跨域限制。
                  </p>
                  <p className="text-xs text-yellow-400/60 mt-2">
                    构建桌面版：npm run electron:build
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : songs.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center opacity-40">
              <span className="material-symbols-outlined text-6xl mb-4 block">music_off</span>
              <p className="text-xl font-medium">暂无音乐</p>
              <p className="text-sm mt-2 mb-4">
                {hasSearched ? '尝试其他搜索关键词' : '请设置Cookie以获取推荐'}
              </p>
              <button
                onClick={() => loadRecommendations()}
                className="px-4 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-all"
              >
                刷新
              </button>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto no-scrollbar">
            {/* Column Headers */}
            <div className="grid gap-4 px-4 py-2 text-xs font-bold text-white/30 uppercase tracking-widest border-b border-white/5 mb-2 grid-cols-[48px_1fr_1fr_80px_100px]">
              <span>#</span>
              <span>Title</span>
              <span>Album</span>
              <span className="text-right">Time</span>
              <span className="text-right">Action</span>
            </div>

            {/* Song List */}
            <div className="grid gap-2">
              {songs.map((song, index) => {
                const progress = downloadProgress[song.songmid];
                const isDownloading = progress?.status === 'downloading';
                const isCompleted = progress?.status === 'completed';

                return (
                  <div
                    key={song.songmid}
                    className="grid gap-4 px-4 py-3 rounded-xl transition-all items-center hover:bg-white/5 grid-cols-[48px_1fr_1fr_80px_100px]"
                  >
                    <div className="text-sm font-medium opacity-50">
                      {index + 1}
                    </div>
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={song.coverUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%23222"/></svg>'}
                        className="size-10 rounded-lg object-cover"
                        alt={song.songname}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{song.songname}</p>
                        <p className="text-xs opacity-50 truncate">
                          {song.singer?.map(s => s.name).join(', ')}
                        </p>
                      </div>
                    </div>
                    <div className="text-sm opacity-50 truncate">
                      {song.albumname || '-'}
                    </div>
                    <div className="text-sm opacity-50 text-right tabular-nums">
                      {formatDuration(song.interval)}
                    </div>
                    <div className="flex justify-end gap-1">
                      {isDownloading ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${progress.progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-white/50">{progress.progress}%</span>
                        </div>
                      ) : isCompleted ? (
                        <span className="text-green-400 text-xs flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">check</span>
                          完成
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => handleDownload(song, '128')}
                            title="下载 128kbps"
                            className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                          >
                            <span className="material-symbols-outlined text-base">download</span>
                          </button>
                          <button
                            onClick={() => handleDownload(song, 'flac')}
                            title="下载 FLAC"
                            className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                          >
                            <span className="material-symbols-outlined text-base">audio_file</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={showSettingsDialog}
        onClose={handleSettingsDialogClose}
      />
    </div>
  );
};

export default BrowseView;
