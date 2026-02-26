import React, { useState, useEffect, useCallback, useRef } from 'react';
import { QQMusicSong, qqMusicApi } from '../services/qqMusicApi';
import { cookieManager } from '../services/cookieManager';
import { settingsManager } from '../services/settingsManager';
import { logger } from '../services/logger';
import { libraryStorage } from '../services/libraryStorage';
import { metadataCacheService } from '../services/metadataCacheService';
import { getDesktopAPIAsync } from '../services/desktopAdapter';
import SettingsDialog from './SettingsDialog';
import { Track } from '../types';

interface BrowseViewProps {
  inputValue?: string; // Search input value from parent (shared between views)
  searchTrigger?: number; // Trigger to execute search
  onDownloadComplete?: (track: Track) => void;
}

interface DownloadProgress {
  [songmid: string]: {
    progress: number;
    status: 'downloading' | 'completed' | 'error';
  };
}

type QualityOption = {
  value: '128' | '320' | 'flac';
  label: string;
};

const qualityOptions: QualityOption[] = [
  { value: '128', label: '128kbps' },
  { value: '320', label: '320kbps' },
  { value: 'flac', label: 'FLAC' },
];

function sanitizeDownloadFileName(input: string): string {
  const sanitized = input
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || 'Unknown Track';
}

function parseLRCLyrics(lrc: string): { plainText: string; syncedLyrics?: { time: number; text: string }[] } {
  const lines = lrc.split(/\r?\n/);
  const syncedLyrics: { time: number; text: string }[] = [];
  const plainTextLines: string[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const matches = [...trimmedLine.matchAll(timeRegex)];
    const textWithoutTimestamps = trimmedLine.replace(timeRegex, '').trim();
    if (!textWithoutTimestamps || textWithoutTimestamps === '//') continue;

    if (matches.length > 0) {
      for (const match of matches) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
        syncedLyrics.push({
          time: minutes * 60 + seconds + milliseconds / 1000,
          text: textWithoutTimestamps
        });
      }
    }
    plainTextLines.push(textWithoutTimestamps);
  }

  syncedLyrics.sort((a, b) => a.time - b.time);
  return {
    plainText: plainTextLines.join('\n'),
    syncedLyrics: syncedLyrics.length > 0 ? syncedLyrics : undefined
  };
}

const BrowseView: React.FC<BrowseViewProps> = ({ inputValue = '', searchTrigger = 0, onDownloadComplete }) => {
  const [songs, setSongs] = useState<QQMusicSong[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({});
  const [hasSearched, setHasSearched] = useState(false);
  const [executedSearchQuery, setExecutedSearchQuery] = useState(''); // Local executed search query
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const previousTrigger = useRef(searchTrigger);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  // Execute search when trigger changes (from Enter key in Sidebar)
  useEffect(() => {
    if (searchTrigger !== previousTrigger.current) {
      previousTrigger.current = searchTrigger;
      setExecutedSearchQuery(inputValue);
      
      if (inputValue) {
        // Execute search directly
        const doSearch = async () => {
          if (!inputValue.trim()) {
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
            const results = await qqMusicApi.searchMusic(inputValue, 30);
            setSongs(results);
          } catch (err: any) {
            logger.error('[BrowseView] Search failed:', err);
            const errorMsg = err.message || '';
            if (errorMsg.includes('CORS') || errorMsg.includes('Failed to fetch')) {
              setError('浏览器安全限制：无法直接访问音乐服务API。请在桌面端使用此功能。');
            } else if (errorMsg.includes('Cookie')) {
              setError('访问凭证已过期，请重新设置');
              setShowSettingsDialog(true);
            } else {
              setError(errorMsg || '搜索失败，请稍后重试');
            }
          } finally {
            setIsLoading(false);
          }
        };
        doSearch();
      } else if (hasSearched) {
        // Clear search and go back to recommendations
        loadRecommendations();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger, inputValue]);

  const loadRecommendations = useCallback(async () => {
    if (!cookieManager.hasCookie()) {
      setError('请先设置访问凭证');
      setShowSettingsDialog(true);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      logger.debug('[BrowseView] Loading recommendations...');
      const songs = await qqMusicApi.getRecommendedSongs();
      logger.debug('[BrowseView] Got songs:', songs.length);
      
      if (!songs || songs.length === 0) {
        setError('未获取到推荐歌曲，请检查访问凭证是否有效');
      } else {
        setSongs(songs);
        setHasSearched(false);
      }
    } catch (err: any) {
      logger.error('[BrowseView] Failed to load recommendations:', err);
      logger.error('[BrowseView] Failed to load recommendations:', err);
      const errorMsg = err.message || '';
      if (errorMsg.includes('CORS') || errorMsg.includes('Failed to fetch')) {
        setError('浏览器安全限制：无法直接访问音乐服务API。请在桌面端使用此功能。');
      } else if (errorMsg.includes('Cookie')) {
        setShowSettingsDialog(true);
      } else {
        setError(errorMsg || '加载推荐音乐失败，请检查网络连接或访问凭证有效性');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

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
        setError('浏览器安全限制：无法直接访问音乐服务API。请在桌面端使用此功能。');
      } else if (errorMsg.includes('Cookie')) {
        setError('访问凭证已过期，请重新设置');
        setShowSettingsDialog(true);
      } else {
        setError(errorMsg || '搜索失败，请稍后重试');
      }
    } finally {
      setIsLoading(false);
    }
  }, [loadRecommendations]);

  const handleSettingsDialogClose = () => {
    setShowSettingsDialog(false);
    // Reload recommendations in case cookie was updated
    if (cookieManager.hasCookie()) {
      loadRecommendations();
    }
  };

  const createTrackFromDownloadedFile = async (
    filePath: string,
    fileName: string,
    song: QQMusicSong,
    lyrics?: string
  ): Promise<Track | null> => {
    try {
      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI) {
        logger.error('[BrowseView] Desktop API not available');
        return null;
      }

      // Parse metadata from the downloaded file
      let metadata;
      try {
        const parseResult = await desktopAPI.parseAudioMetadata(filePath);
        if (parseResult.success && parseResult.metadata) {
          metadata = parseResult.metadata;
        }
      } catch (error) {
        logger.error('[BrowseView] Failed to parse metadata:', error);
      }

      const parsedLyrics = lyrics ? parseLRCLyrics(lyrics) : null;
      const finalLyrics = parsedLyrics?.plainText || metadata?.lyrics || lyrics || '';
      const finalSyncedLyrics = parsedLyrics?.syncedLyrics || metadata?.syncedLyrics;

      const trackId = Math.random().toString(36).substr(2, 9);
      const singer = song.singer?.[0]?.name || 'Unknown';

      // Build cover URL from albummid
      const coverUrl = song.albummid
        ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${song.albummid}.jpg`
        : `https://picsum.photos/seed/${encodeURIComponent(fileName)}/1000/1000`;

      // Save cover thumbnail if possible
      let finalCoverUrl = coverUrl;
      if (song.albummid && desktopAPI.saveCoverThumbnail) {
        try {
          // Fetch cover image and convert to base64
          const coverResponse = await fetch(coverUrl);
          if (coverResponse.ok) {
            const coverBlob = await coverResponse.blob();
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
              reader.onloadend = () => {
                const base64 = reader.result as string;
                resolve(base64.split(',')[1]);
              };
            });
            reader.readAsDataURL(coverBlob);
            const base64Data = await base64Promise;
            
            const coverResult = await desktopAPI.saveCoverThumbnail({
              id: trackId,
              data: base64Data,
              mime: 'image/jpeg'
            });
            if (coverResult?.success && coverResult.coverUrl) {
              finalCoverUrl = coverResult.coverUrl;
            }
          }
        } catch (error) {
          logger.warn('[BrowseView] Failed to save cover thumbnail:', error);
        }
      }

      // Cache metadata
      metadataCacheService.set(trackId, {
        title: song.songname,
        artist: singer,
        album: song.albumname || '',
        duration: metadata?.duration || song.interval || 0,
        lyrics: finalLyrics,
        syncedLyrics: finalSyncedLyrics,
        fileName: fileName,
        fileSize: metadata?.fileSize || 0,
        lastModified: Date.now(),
      });

      const track: Track = {
        id: trackId,
        title: song.songname,
        artist: singer,
        album: song.albumname || 'Unknown Album',
        duration: metadata?.duration || song.interval || 0,
        lyrics: finalLyrics,
        syncedLyrics: finalSyncedLyrics,
        coverUrl: finalCoverUrl,
        audioUrl: '',
        fileName: fileName,
        filePath: filePath,
        fileSize: metadata?.fileSize || 0,
        lastModified: Date.now(),
        addedAt: new Date().toISOString(),
        available: true
      };

      return track;
    } catch (error) {
      logger.error('[BrowseView] Failed to create track:', error);
      return null;
    }
  };

  const handleDownload = async (song: QQMusicSong, quality: 'm4a' | '128' | '320' | 'flac' = '128') => {
    // Prevent re-download if already downloading or completed
    const currentStatus = downloadProgress[song.songmid]?.status;
    if (currentStatus === 'downloading' || currentStatus === 'completed') return;

    // Close dropdown
    setOpenDropdownId(null);

    // Get download path from settings
    const downloadPath = settingsManager.getDownloadPath();

    // Check if download path is set
    if (!downloadPath) {
      setError('请先在设置中选择下载目录');
      setShowSettingsDialog(true);
      return;
    }

    setDownloadProgress(prev => ({
      ...prev,
      [song.songmid]: { progress: 0, status: 'downloading' }
    }));

    try {
      logger.debug('[BrowseView] Starting download for:', song.songname, 'quality:', quality);
      const singer = song.singer?.[0]?.name || 'Unknown';

      // Get download URL first
      const { url } = await qqMusicApi.getMusicUrl(song.songmid, quality);
      logger.debug('[BrowseView] Got download URL:', url);

      logger.debug('[BrowseView] Download path:', downloadPath);

      const ext = quality === 'flac' ? 'flac' : quality === 'm4a' ? 'm4a' : 'mp3';
      const safeSinger = sanitizeDownloadFileName(singer);
      const safeSongName = sanitizeDownloadFileName(song.songname);
      const fileName = `${safeSinger} - ${safeSongName}.${ext}`;

      let savedFilePath: string | undefined;
      let lyrics: string | undefined;

      // Use Electron to download - ensure downloadPath ends with path separator
      const separator = downloadPath.endsWith('/') || downloadPath.endsWith('\\') ? '' : '/';
      const fullPath = downloadPath + separator + fileName;
      logger.debug('[BrowseView] Downloading directly to:', fullPath);

      const rawCookie = cookieManager.getCookie();
      const coverUrl = song.albummid
        ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${song.albummid}.jpg`
        : song.coverUrl;

      const lyricsPromise = (async (): Promise<string | undefined> => {
        try {
          if (window.electron?.getQQMusicLyrics) {
            const lyricResult = await window.electron.getQQMusicLyrics(song.songmid, rawCookie);
            if (lyricResult?.success && lyricResult.lyrics) {
              return lyricResult.lyrics;
            }
          }
        } catch (error) {
          logger.warn('[BrowseView] Failed to get lyrics via main process:', error);
        }

        try {
          return (await qqMusicApi.getLyrics(song.songmid)) || undefined;
        } catch (error) {
          logger.warn('[BrowseView] Failed to get lyrics via renderer API:', error);
          return undefined;
        }
      })();

      // Download and save via Electron main process
      try {
        const downloadResult = await window.electron!.downloadAndSave(url, rawCookie, fullPath);

        if (!downloadResult.success) {
          throw new Error(`下载失败: ${downloadResult.error}`);
        }

        savedFilePath = downloadResult.filePath;
        logger.debug('[BrowseView] File saved successfully to:', savedFilePath);

        // Update progress to 100%
        setDownloadProgress(prev => ({
          ...prev,
          [song.songmid]: { progress: 100, status: 'downloading' }
        }));
      } catch (error) {
        logger.error('[BrowseView] Download failed:', error);
        throw error;
      }

      lyrics = await lyricsPromise;

      if (savedFilePath && window.electron?.writeAudioMetadata) {
        try {
          const metadataResult = await window.electron.writeAudioMetadata(savedFilePath, {
            title: song.songname,
            artist: singer,
            album: song.albumname || '',
            lyrics,
            coverUrl
          });

          if (!metadataResult?.success) {
            logger.warn('[BrowseView] Metadata write failed:', metadataResult?.error);
          }
        } catch (error) {
          logger.warn('[BrowseView] Metadata write error:', error);
        }
      }

      // Create track and add to library
      if (savedFilePath && onDownloadComplete) {
        logger.debug('[BrowseView] Creating track from downloaded file...');
        const track = await createTrackFromDownloadedFile(savedFilePath, fileName, song, lyrics);
        if (track) {
          onDownloadComplete(track);
          logger.debug('[BrowseView] Track added to library:', track.title);
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
      logger.error('[BrowseView] Download error:', err);
      
      const errorMsg = err.message || '';
      // If it's a cookie error, show settings dialog
      if (errorMsg.includes('Cookie') || errorMsg.includes('cookie')) {
        setError('访问凭证已过期，请重新设置');
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

  const toggleDropdown = (songmid: string) => {
    setOpenDropdownId(openDropdownId === songmid ? null : songmid);
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
              ? `Search results for "${executedSearchQuery}"` 
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
                    提示：浏览功能需要在桌面端使用，因为浏览器存在跨域限制。
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
                {hasSearched ? '尝试其他搜索关键词' : '请设置访问凭证以获取推荐'}
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
                const isDropdownOpen = openDropdownId === song.songmid;

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
                    <div className="flex justify-end" ref={isDropdownOpen ? dropdownRef : undefined}>
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
                        <div className="relative">
                          <button
                            onClick={() => toggleDropdown(song.songmid)}
                            title="下载"
                            className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                          >
                            <span className="material-symbols-outlined text-base">download</span>
                          </button>
                          
                          {/* Dropdown Menu */}
                          {isDropdownOpen && (
                            <div className="absolute right-0 top-full mt-1 z-50 min-w-[100px] bg-[#1a2533] border border-white/10 rounded-lg shadow-xl overflow-hidden">
                              {qualityOptions.map((option) => (
                                <button
                                  key={option.value}
                                  onClick={() => handleDownload(song, option.value)}
                                  className="w-full px-3 py-2 text-left text-xs text-white/70 hover:bg-primary/20 hover:text-primary transition-all flex items-center justify-between"
                                >
                                  <span>{option.label}</span>
                                  {option.value === '128' && (
                                    <span className="text-[10px] text-white/30">标准</span>
                                  )}
                                  {option.value === '320' && (
                                    <span className="text-[10px] text-white/30">高品质</span>
                                  )}
                                  {option.value === 'flac' && (
                                    <span className="text-[10px] text-primary/60">无损</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
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
