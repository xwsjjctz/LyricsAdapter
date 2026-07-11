import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getOnlineProvider,
  getActiveCookieManager,
  type OnlineSong,
} from '../services/onlineMusicProvider';
import { logger } from '../services/logger';
import { notify } from '../services/notificationService';
import { useTranslation } from 'react-i18next';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';
import type { OnlineProgressEntry } from '../hooks/useOnlineMusicIntegration';

interface BrowseViewProps {
  /** Online-music download/upload progress + action callbacks. */
  online: {
    progress: Record<string, OnlineProgressEntry>;
    download: (song: OnlineSong, quality: '128' | '320' | 'flac' | 'm4a') => Promise<void>;
    upload: (song: OnlineSong, quality: '128' | '320' | 'flac' | 'm4a') => Promise<void>;
  };
  onNavigateToSettings?: () => void;
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

const ONLINE_SEARCH_DEBOUNCE_MS = 500;

const BrowseView: React.FC<BrowseViewProps> = ({ online, onNavigateToSettings }) => {
  const [songs, setSongs] = useState<OnlineSong[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [executedSearchQuery, setExecutedSearchQuery] = useState('');
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [openUploadDropdownId, setOpenUploadDropdownId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useTranslation();
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

  // Check cookie on mount — only sources that require login (e.g. QQ Music).
  // NetEase search works anonymously, so it skips straight to loading recommendations.
  useEffect(() => {
    const checkCookie = async () => {
      const provider = getOnlineProvider();
      const cookieStore = getActiveCookieManager();
      if (provider.requiresCookie() && (!cookieStore.hasCookie() || cookieStore.shouldCheckCookie())) {
        const status = await cookieStore.validateCookie();
        if (!status.valid && !cookiePromptShown) {
          sessionStorage.setItem('cookiePromptShown', 'true');
          notify(t('browse.cookieExpired'), t('browse.pleaseSetCookie'));
          onNavigateToSettings?.();
          return;
        }
      }
      loadRecommendations();
    };
    checkCookie();
  }, []);

  // Debounced search: execute 1 second after typing stops
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setExecutedSearchQuery(searchQuery);

      if (searchQuery.trim()) {
        const doSearch = async () => {
          const provider = getOnlineProvider();
          if (provider.requiresCookie() && !provider.hasCookie() && !cookiePromptShown) {
            sessionStorage.setItem('cookiePromptShown', 'true');
            notify(t('browse.cookieExpired'), t('browse.pleaseSetCookie'));
            onNavigateToSettings?.();
            return;
          }

          setIsLoading(true);
          setError(null);
          setHasSearched(true);

          try {
            const results = await provider.searchMusic(searchQuery, 30);
            setSongs(results);
          } catch (err: any) {
            logger.error('[BrowseView] Search failed:', err);
            const errorMsg = err.message || '';
            if (errorMsg.includes('CORS') || errorMsg.includes('Failed to fetch')) {
              setError(t('browse.corsError'));
            } else if (errorMsg.includes('Cookie')) {
              setError(t('browse.cookieExpired'));
              if (!cookiePromptShown) {
                sessionStorage.setItem('cookiePromptShown', 'true');
                notify(t('browse.cookieExpired'), t('browse.pleaseSetCookie'));
                onNavigateToSettings?.();
              }
            } else {
              setError(errorMsg || t('browse.searchFailed'));
            }
          } finally {
            setIsLoading(false);
          }
        };
        doSearch();
      } else if (hasSearched) {
        loadRecommendations();
      }
    }, ONLINE_SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const loadRecommendations = useCallback(async () => {
    const provider = getOnlineProvider();
    if (provider.requiresCookie() && !provider.hasCookie()) {
      setError(t('browse.pleaseSetCookie'));
      if (!cookiePromptShown) {
        sessionStorage.setItem('cookiePromptShown', 'true');
        notify(t('browse.cookieExpired'), t('browse.pleaseSetCookie'));
        onNavigateToSettings?.();
      }
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      logger.debug('[BrowseView] Loading recommendations...');
      const songs = await provider.getRecommendedSongs();
      logger.debug('[BrowseView] Got songs:', songs.length);
      
      if (!songs || songs.length === 0) {
        setError(t('browse.noMusic'));
      } else {
        setSongs(songs);
        setHasSearched(false);
      }
    } catch (err: any) {
      logger.error('[BrowseView] Failed to load recommendations:', err);
      logger.error('[BrowseView] Failed to load recommendations:', err);
      const errorMsg = err.message || '';
      if (errorMsg.includes('CORS') || errorMsg.includes('Failed to fetch')) {
        setError(t('browse.corsError'));
      } else if (errorMsg.includes('Cookie')) {
        if (!cookiePromptShown) {
          sessionStorage.setItem('cookiePromptShown', 'true');
          onNavigateToSettings?.();
        }
      } else {
        setError(errorMsg || t('browse.searchFailed'));
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Download, upload, lyrics fetching and track-creation are handled by the
  // online-music hook (useOnlineMusicIntegration), exposed via `online` VM prop.

  const handleDownload = async (song: OnlineSong, quality: 'm4a' | '128' | '320' | 'flac' = '128') => {
    await online.download(song, quality);
  };

  const handleUploadToWebdav = async (song: OnlineSong, quality: 'm4a' | '128' | '320' | 'flac' = 'flac') => {
    await online.upload(song, quality);
  };
  const toggleDropdown = (songmid: string) => {
    setOpenDropdownId(openDropdownId === songmid ? null : songmid);
  };

  const toggleUploadDropdown = (songmid: string) => {
    setOpenUploadDropdownId(openUploadDropdownId === songmid ? null : songmid);
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
          <h1 className="text-3xl font-extrabold" style={{ color: 'var(--theme-text-primary, #fff)' }}>{t('browse.title')}</h1>
          <p style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>
            {hasSearched
              ? `${t('browse.searchResults')} "${executedSearchQuery}"`
              : t('browse.recommended')}
          </p>
        </div>
        <div className="relative flex-1 max-w-[200px]" style={{ minWidth: 0 }}>
          <span
            className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-lg"
            style={{ color: colors.textMuted }}
          >
            search
          </span>
          <input
            type="text"
            placeholder={t('sidebar.searchOnline')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-xl h-[38px] pl-10 pr-9 text-sm transition-all focus:outline-none focus:ring-0"
            style={{
              backgroundColor: colors.backgroundCard,
              border: `1px solid ${colors.borderLight}`,
              color: colors.textPrimary,
            }}
            onFocus={e => { e.currentTarget.style.boxShadow = `0 0 20px ${colors.glowColor}`; }}
            onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-[55%] -translate-y-1/2 transition-colors"
              style={{ color: colors.textMuted }}
              onMouseEnter={e => { e.currentTarget.style.color = colors.textPrimary; }}
              onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; }}
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <span className="material-symbols-outlined text-4xl text-primary animate-spin">refresh</span>
              <p style={{ color: 'var(--theme-text-secondary, rgba(255,255,255,0.6))' }}>{t('browse.loading')}</p>
            </div>
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <span className="material-symbols-outlined text-6xl text-red-400 mb-4 block">error</span>
              <p className="text-xl font-medium text-red-400 mb-2">{t('browse.error')}</p>
              <p className="text-sm mb-6" style={{ color: colors.textMuted }}>{error}</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => loadRecommendations()}
                  className="px-4 py-2 rounded-xl transition-all"
                  style={{ backgroundColor: colors.backgroundCard, color: colors.textPrimary }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
                >
                  {t('browse.retry')}
                </button>
                {!error.includes('CORS') && !error.includes('浏览器') && !error.includes('桌面端') && !error.includes('desktop') && !error.includes('browser') && (
                  <button
                    onClick={() => onNavigateToSettings?.()}
                    className="px-4 py-2 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 transition-all"
                  >
                    {t('browse.openSettings')}
                  </button>
                )}
              </div>
              {(error.includes('CORS') || error.includes('浏览器') || error.includes('桌面端') || error.includes('desktop') || error.includes('browser')) && (
                <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                  <p className="text-xs text-yellow-400/80">
                    <span className="material-symbols-outlined text-sm align-text-bottom mr-1">lightbulb</span>
                    {t('browse.browserLimitTitle')}
                  </p>
                  <p className="text-xs text-yellow-400/60 mt-2">
                    {t('browse.buildDesktop')}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : songs.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <span className="material-symbols-outlined text-6xl mb-4 block">music_off</span>
              <p className="text-xl font-medium">{t('browse.noMusic')}</p>
              <p className="text-sm mt-2 mb-4">
                {hasSearched ? t('browse.tryDifferentKeywords') : t('browse.setCookieToGetRecommended')}
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => loadRecommendations()}
                  className="px-4 py-2 rounded-xl transition-all"
                  style={{ backgroundColor: colors.backgroundCard, color: colors.textPrimary }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
                >
                  {t('browse.refresh')}
                </button>
                {!hasSearched && onNavigateToSettings && (
                  <button
                    onClick={() => onNavigateToSettings()}
                    className="px-4 py-2 rounded-xl transition-all"
                    style={{ backgroundColor: colors.primary, color: '#fff' }}
                  >
                    {t('browse.openSettings')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto no-scrollbar">
            {/* Column Headers */}
            <div className="grid gap-4 px-4 py-2 text-xs font-bold uppercase tracking-widest border-b mb-2 grid-cols-[48px_1fr_1fr_80px_140px]" style={{ color: colors.textMuted, borderColor: colors.borderLight }}>
              <span>#</span>
              <span>{t('library.titleCol')}</span>
              <span>{t('library.albumCol')}</span>
              <span className="text-right">{t('library.timeCol')}</span>
              <span className="text-right">{t('browse.actionCol')}</span>
            </div>

            {/* Song List */}
            <div className="grid gap-2">
              {songs.map((song, index) => {
                const prog = online.progress[song.songmid];
                const isDownloading = prog?.type === 'download' && !prog.status;
                const isDlCompleted = prog?.type === 'download' && prog.status === 'completed';
                const isDropdownOpen = openDropdownId === song.songmid;

                const isUploading = prog?.type === 'upload' && !prog.status;
                const isUlCompleted = prog?.type === 'upload' && prog.status === 'completed';
                const isUploadDropdownOpen = openUploadDropdownId === song.songmid;

                return (
                  <div
                    key={song.songmid}
                    className="grid gap-4 px-4 py-3 rounded-xl transition-all items-center grid-cols-[48px_1fr_1fr_80px_140px]"
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
                    <div className="flex justify-end gap-1" ref={isDropdownOpen || isUploadDropdownOpen ? dropdownRef : undefined}>
                      {/* Download button + progress */}
                      {isDownloading ? (
                        <div className="flex items-center gap-1">
                          <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.backgroundCard }}>
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${prog.percent}%` }} />
                          </div>
                          <span className="text-xs" style={{ color: colors.textMuted }}>{prog.percent}%</span>
                        </div>
                      ) : isDlCompleted ? (
                        <span className="text-xs flex items-center gap-1" style={{ color: colors.success }}>
                          <span className="material-symbols-outlined text-sm">check</span>
                        </span>
                      ) : (
                        <div className="relative">
                          <button
                            onClick={() => toggleDropdown(song.songmid)}
                            title={t('browse.download')}
                            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                            style={{ color: colors.textMuted }}
                            onMouseEnter={e => { e.currentTarget.style.color = colors.primary; e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.1)'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <span className="material-symbols-outlined text-base">download</span>
                          </button>
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
                                  {option.value === '128' && <span className="text-[10px]" style={{ color: colors.textMuted }}>{t('browse.standard')}</span>}
                                  {option.value === '320' && <span className="text-[10px]" style={{ color: colors.textMuted }}>{t('browse.highQuality')}</span>}
                                  {option.value === 'flac' && <span className="text-[10px] text-primary/60">{t('browse.lossless')}</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Upload to WebDAV button + progress */}
                      {isUploading ? (
                        <div className="flex items-center gap-1">
                          <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.backgroundCard }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${prog.percent}%`, backgroundColor: colors.accent }} />
                          </div>
                          <span className="text-xs" style={{ color: colors.textMuted }}>{prog.percent}%</span>
                        </div>
                      ) : isUlCompleted ? (
                        <span className="text-xs flex items-center gap-1" style={{ color: colors.accent }}>
                          <span className="material-symbols-outlined text-sm">cloud_done</span>
                        </span>
                      ) : (
                        <div className="relative">
                          <button
                            onClick={() => toggleUploadDropdown(song.songmid)}
                            title={t('browse.uploadToCloud')}
                            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                            style={{ color: colors.textMuted }}
                            onMouseEnter={e => { e.currentTarget.style.color = colors.accent; e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.1)'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <span className="material-symbols-outlined text-base">cloud_upload</span>
                          </button>
                          {isUploadDropdownOpen && (
                            <div className="absolute right-0 top-full mt-1 z-50 min-w-[100px] rounded-lg shadow-xl overflow-hidden" style={{ backgroundColor: colors.backgroundCard, border: `1px solid ${colors.borderLight}` }}>
                              {qualityOptions.map((option) => (
                                <button
                                  key={option.value}
                                  onClick={() => handleUploadToWebdav(song, option.value)}
                                  className="w-full px-3 py-2 text-left text-xs transition-all flex items-center justify-between"
                                  style={{ color: colors.textSecondary }}
                                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.accent; }}
                                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textSecondary; }}
                                >
                                  <span>{option.label}</span>
                                  {option.value === '128' && <span className="text-[10px]" style={{ color: colors.textMuted }}>{t('browse.standard')}</span>}
                                  {option.value === '320' && <span className="text-[10px]" style={{ color: colors.textMuted }}>{t('browse.highQuality')}</span>}
                                  {option.value === 'flac' && <span className="text-[10px] text-primary/60">{t('browse.lossless')}</span>}
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
    </div>
  );
};

export default BrowseView;
