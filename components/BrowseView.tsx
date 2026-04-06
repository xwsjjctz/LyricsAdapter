import React, { useState, useEffect, useCallback, useRef } from 'react';
import { QQMusicSong, qqMusicApi } from '../services/qqMusicApi';
import { cookieManager } from '../services/cookieManager';
import { settingsManager } from '../services/settingsManager';
import { logger } from '../services/logger';
import { libraryStorage } from '../services/libraryStorage';
import { metadataCacheService } from '../services/metadataCacheService';
import { getDesktopAPIAsync } from '../services/desktopAdapter';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';
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
  const [, setLanguageVersion] = useState(0);
  const cookiePromptShown = sessionStorage.getItem('cookiePromptShown') === 'true';
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  const colors = currentTheme.colors;

  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

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

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = i18n.subscribe(() => {
      setLanguageVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

  // Check cookie on mount
  useEffect(() => {
    const checkCookie = async () => {
      if (!cookieManager.hasCookie() || cookieManager.shouldCheckCookie()) {
        const status = await cookieManager.validateCookie();
        if (!status.valid && !cookiePromptShown) {
          sessionStorage.setItem('cookiePromptShown', 'true');
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

          if (!cookieManager.hasCookie() && !cookiePromptShown) {
            sessionStorage.setItem('cookiePromptShown', 'true');
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
              setError(i18n.t('browse.corsError'));
            } else if (errorMsg.includes('Cookie')) {
              setError(i18n.t('browse.cookieExpired'));
        if (!cookiePromptShown) {
          sessionStorage.setItem('cookiePromptShown', 'true');
          setShowSettingsDialog(true);
              }
            } else {
              setError(errorMsg || i18n.t('browse.searchFailed'));
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
      setError(i18n.t('browse.pleaseSetCookie'));
      if (!cookiePromptShown) {
        sessionStorage.setItem('cookiePromptShown', 'true');
        setShowSettingsDialog(true);
      }
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      logger.debug('[BrowseView] Loading recommendations...');
      const songs = await qqMusicApi.getRecommendedSongs();
      logger.debug('[BrowseView] Got songs:', songs.length);
      
      if (!songs || songs.length === 0) {
        setError(i18n.t('browse.noMusic'));
      } else {
        setSongs(songs);
        setHasSearched(false);
      }
    } catch (err: any) {
      logger.error('[BrowseView] Failed to load recommendations:', err);
      logger.error('[BrowseView] Failed to load recommendations:', err);
      const errorMsg = err.message || '';
      if (errorMsg.includes('CORS') || errorMsg.includes('Failed to fetch')) {
        setError(i18n.t('browse.corsError'));
      } else if (errorMsg.includes('Cookie')) {
        if (!cookiePromptShown) {
          sessionStorage.setItem('cookiePromptShown', 'true');
          setShowSettingsDialog(true);
        }
      } else {
        setError(errorMsg || i18n.t('browse.searchFailed'));
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
      if (!cookiePromptShown) {
        sessionStorage.setItem('cookiePromptShown', 'true');
        setShowSettingsDialog(true);
      }
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
        setError(i18n.t('browse.corsError'));
      } else if (errorMsg.includes('Cookie')) {
        setError(i18n.t('browse.cookieExpired'));
        if (!cookiePromptShown) {
          sessionStorage.setItem('cookiePromptShown', 'true');
          setShowSettingsDialog(true);
        }
      } else {
        setError(errorMsg || i18n.t('browse.searchFailed'));
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
      const singer = song.singer?.map(s => s.name).join(' / ') || 'Unknown';

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
      setError(i18n.t('browse.selectDownloadPath'));
      setShowSettingsDialog(true);
      return;
    }

    setDownloadProgress(prev => ({
      ...prev,
      [song.songmid]: { progress: 0, status: 'downloading' }
    }));

    try {
      logger.debug('[BrowseView] Starting download for:', song.songname, 'quality:', quality);
      const singer = song.singer?.map(s => s.name).join(' / ') || 'Unknown';
      // For filename, use & to separate multiple artists (cleaner for filesystem)
      const singerForFileName = song.singer?.map(s => s.name).join(' & ') || 'Unknown';

      // Get download URL first
      const { url } = await qqMusicApi.getMusicUrl(song.songmid, quality);
      logger.debug('[BrowseView] Got download URL:', url);

      logger.debug('[BrowseView] Download path:', downloadPath);

      const ext = quality === 'flac' ? 'flac' : quality === 'm4a' ? 'm4a' : 'mp3';
      const safeSinger = sanitizeDownloadFileName(singerForFileName);
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
          logger.info('[BrowseView] Attempting to write metadata to file:', savedFilePath);
          logger.info('[BrowseView] Metadata payload:', {
            title: song.songname,
            artist: singer,
            album: song.albumname || '',
            lyricsLength: lyrics?.length || 0,
            coverUrl: coverUrl ? `${coverUrl.substring(0, 50)}...` : undefined
          });

          const metadataResult = await window.electron.writeAudioMetadata(savedFilePath, {
            title: song.songname,
            artist: singer,
            album: song.albumname || '',
            lyrics,
            coverUrl
          });

          logger.info('[BrowseView] Metadata write result:', metadataResult);

          if (!metadataResult?.success) {
            logger.error('[BrowseView] Metadata write FAILED:', metadataResult?.error);
          } else {
            logger.info('[BrowseView] ✅ Metadata written successfully to file');
          }
        } catch (error) {
          logger.error('[BrowseView] Metadata write EXCEPTION:', error);
        }
      } else {
        logger.warn('[BrowseView] writeAudioMetadata not available or no file path');
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
        setError(i18n.t('browse.cookieExpired'));
        if (!cookiePromptShown) {
          sessionStorage.setItem('cookiePromptShown', 'true');
          setShowSettingsDialog(true);
        }
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
    <div className="w-full flex flex-col h-full">
      {/* Header */}
      <div className="mb-4 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold mb-2" style={{ color: 'var(--theme-text-primary, #fff)' }}>{i18n.t('browse.title')}</h1>
          <p style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>
            {hasSearched 
              ? `${i18n.t('browse.searchResults')} "${executedSearchQuery}"` 
              : i18n.t('browse.recommended')}
          </p>
        </div>
        <button
          onClick={() => setShowSettingsDialog(true)}
          className="w-10 h-10 rounded-xl transition-all flex items-center justify-center"
          style={{ backgroundColor: colors.backgroundCard, color: colors.textMuted }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.primary; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textMuted; }}
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
              <p style={{ color: 'var(--theme-text-secondary, rgba(255,255,255,0.6))' }}>{i18n.t('browse.loading')}</p>
            </div>
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <span className="material-symbols-outlined text-6xl text-red-400 mb-4 block">error</span>
              <p className="text-xl font-medium text-red-400 mb-2">{i18n.t('browse.error')}</p>
              <p className="text-sm mb-6" style={{ color: colors.textMuted }}>{error}</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => loadRecommendations()}
                  className="px-4 py-2 rounded-xl transition-all"
                  style={{ backgroundColor: colors.backgroundCard, color: colors.textPrimary }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
                >
                  {i18n.t('browse.retry')}
                </button>
                {!error.includes('CORS') && !error.includes('浏览器') && !error.includes('桌面端') && !error.includes('desktop') && !error.includes('browser') && (
                  <button
                    onClick={() => setShowSettingsDialog(true)}
                    className="px-4 py-2 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 transition-all"
                  >
                    {i18n.t('browse.openSettings')}
                  </button>
                )}
              </div>
              {(error.includes('CORS') || error.includes('浏览器') || error.includes('桌面端') || error.includes('desktop') || error.includes('browser')) && (
                <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                  <p className="text-xs text-yellow-400/80">
                    <span className="material-symbols-outlined text-sm align-text-bottom mr-1">lightbulb</span>
                    {i18n.t('browse.browserLimitTitle')}
                  </p>
                  <p className="text-xs text-yellow-400/60 mt-2">
                    {i18n.t('browse.buildDesktop')}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : songs.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center opacity-40">
              <span className="material-symbols-outlined text-6xl mb-4 block">music_off</span>
              <p className="text-xl font-medium">{i18n.t('browse.noMusic')}</p>
              <p className="text-sm mt-2 mb-4">
                {hasSearched ? i18n.t('browse.tryDifferentKeywords') : i18n.t('browse.setCookieToGetRecommended')}
              </p>
              <button
                onClick={() => loadRecommendations()}
                className="px-4 py-2 rounded-xl transition-all"
                style={{ backgroundColor: colors.backgroundCard, color: colors.textPrimary }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
              >
                {i18n.t('browse.refresh')}
              </button>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto no-scrollbar">
            {/* Column Headers */}
            <div className="grid gap-4 px-4 py-2 text-xs font-bold uppercase tracking-widest border-b mb-2 grid-cols-[48px_1fr_1fr_80px_100px]" style={{ color: colors.textMuted, borderColor: colors.borderLight }}>
              <span>#</span>
              <span>{i18n.t('library.titleCol')}</span>
              <span>{i18n.t('library.albumCol')}</span>
              <span className="text-right">{i18n.t('library.timeCol')}</span>
              <span className="text-right">{i18n.t('browse.actionCol')}</span>
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
                    className="grid gap-4 px-4 py-3 rounded-xl transition-all items-center grid-cols-[48px_1fr_1fr_80px_100px]"
                    style={{}}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <div className="text-sm font-medium" style={{ color: colors.textMuted }}>
                      {index + 1}
                    </div>
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={song.coverUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%23222"/></svg>'}
                        className="size-10 rounded-lg object-cover"
                        alt={song.songname}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate" style={{ color: colors.textPrimary }}>{song.songname}</p>
                        <p className="text-xs truncate" style={{ color: colors.textMuted }}>
                          {song.singer?.map(s => s.name).join(', ')}
                        </p>
                      </div>
                    </div>
                    <div className="text-sm truncate" style={{ color: colors.textMuted }}>
                      {song.albumname || '-'}
                    </div>
                    <div className="text-sm text-right tabular-nums" style={{ color: colors.textMuted }}>
                      {formatDuration(song.interval)}
                    </div>
                    <div className="flex justify-end" ref={isDropdownOpen ? dropdownRef : undefined}>
                      {isDownloading ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.backgroundCard }}>
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${progress.progress}%` }}
                            />
                          </div>
                          <span className="text-xs" style={{ color: colors.textMuted }}>{progress.progress}%</span>
                        </div>
                      ) : isCompleted ? (
                        <span className="text-xs flex items-center gap-1" style={{ color: colors.success }}>
                          <span className="material-symbols-outlined text-sm">check</span>
                          {i18n.t('browse.completed')}
                        </span>
                      ) : (
                        <div className="relative">
                          <button
                            onClick={() => toggleDropdown(song.songmid)}
                            title={i18n.t('browse.download')}
                            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                            style={{ color: colors.textMuted }}
                            onMouseEnter={e => { e.currentTarget.style.color = colors.primary; e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.1)'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <span className="material-symbols-outlined text-base">download</span>
                          </button>
                          
                          {/* Dropdown Menu */}
                          {isDropdownOpen && (
                            <div className="absolute right-0 top-full mt-1 z-50 min-w-[100px] rounded-lg shadow-xl overflow-hidden" style={{ backgroundColor: colors.backgroundCard, border: `1px solid ${colors.borderLight}` }}>
                              {qualityOptions.map((option) => (
                                <button
                                  key={option.value}
                                  onClick={() => handleDownload(song, option.value)}
                                  className="w-full px-3 py-2 text-left text-xs transition-all flex items-center justify-between"
                                  style={{ color: colors.textSecondary }}
                                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.primary; }}
                                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textSecondary; }}
                                >
                                  <span>{option.label}</span>
                                  {option.value === '128' && (
                                    <span className="text-[10px]" style={{ color: colors.textMuted }}>{i18n.t('browse.standard')}</span>
                                  )}
                                  {option.value === '320' && (
                                    <span className="text-[10px]" style={{ color: colors.textMuted }}>{i18n.t('browse.highQuality')}</span>
                                  )}
                                  {option.value === 'flac' && (
                                    <span className="text-[10px] text-primary/60">{i18n.t('browse.lossless')}</span>
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
