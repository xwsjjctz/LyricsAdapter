import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Track } from '../types';
import { QQMusicSong, qqMusicApi } from '../services/qqMusicApi';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';
import { logger } from '../services/logger';
import TrackCover from './TrackCover';

const QQ_DEBOUNCE_MS = 300;
const MAX_RESULTS = 8;

const qualityOptions = [
  { value: '128' as const, label: '128kbps' },
  { value: '320' as const, label: '320kbps' },
  { value: 'flac' as const, label: 'FLAC' },
];

interface SearchBoxProps {
  isFocusMode: boolean;
  isWindowFocused: boolean;
  localTracks: Track[];
  cloudTracks: Track[];
  onNavigateToTrack: (track: Track) => void;
  onQQMusicDownload: (song: QQMusicSong, quality: '128' | '320' | 'flac') => void;
  onQQMusicUpload: (song: QQMusicSong, quality: '128' | '320' | 'flac') => void;
}

const SearchBox: React.FC<SearchBoxProps> = ({
  isFocusMode,
  isWindowFocused,
  localTracks,
  cloudTracks,
  onNavigateToTrack,
  onQQMusicDownload,
  onQQMusicUpload,
}) => {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [qqResults, setQqResults] = useState<QQMusicSong[]>([]);
  const [qqLoading, setQqLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [openQualityId, setOpenQualityId] = useState<string | null>(null);
  const [openUploadQualityId, setOpenUploadQualityId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  const [, setLangVersion] = useState(0);

  useEffect(() => {
    const u1 = themeManager.subscribe(() => setCurrentTheme(themeManager.getCurrentTheme()));
    const u2 = i18n.subscribe(() => setLangVersion(v => v + 1));
    return () => { u1(); u2(); };
  }, []);

  const colors = currentTheme.colors;
  const isExpanded = isFocused && query.trim().length > 0;
  const isHidden = Boolean(isFocusMode);

  // Filter local/cloud tracks
  const filteredLocal = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return localTracks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q)
    ).slice(0, MAX_RESULTS);
  }, [localTracks, query]);

  const filteredCloud = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return cloudTracks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q)
    ).slice(0, MAX_RESULTS);
  }, [cloudTracks, query]);

  // QQ Music search (debounced)
  useEffect(() => {
    if (!query.trim() || !isExpanded) {
      setQqResults([]);
      setQqLoading(false);
      return;
    }
    setQqLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await qqMusicApi.searchMusic(query.trim(), MAX_RESULTS);
        setQqResults(results);
      } catch (err) {
        logger.warn('[SearchBox] QQ Music search failed:', err);
        setQqResults([]);
      } finally { setQqLoading(false); }
    }, QQ_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, isExpanded]);

  // Reset selections
  useEffect(() => { setSelectedIndex(-1); setOpenQualityId(null); setOpenUploadQualityId(null); }, [query]);

  // Click outside → collapse
  useEffect(() => {
    if (!isExpanded) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isExpanded]);

  // Keyboard navigation
  const totalItems = filteredLocal.length + filteredCloud.length + qqResults.length;
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQuery('');
      setIsFocused(false);
      inputRef.current?.blur();
      return;
    }
    if (!isExpanded || totalItems === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(p => Math.min(p + 1, totalItems - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(p => Math.max(p - 1, 0)); }
    else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      let offset = 0;
      if (selectedIndex < offset + filteredLocal.length) { onNavigateToTrack(filteredLocal[selectedIndex - offset]!); collapse(); return; }
      offset += filteredLocal.length;
      if (selectedIndex < offset + filteredCloud.length) { onNavigateToTrack(filteredCloud[selectedIndex - offset]!); collapse(); return; }
    }
  }, [isExpanded, totalItems, selectedIndex, filteredLocal, filteredCloud, onNavigateToTrack]);

  const collapse = () => { setIsFocused(false); setQuery(''); setSelectedIndex(-1); };

  const handleFocus = () => setIsFocused(true);
  const handleChange = (v: string) => { setQuery(v); if (!isFocused) setIsFocused(true); };

  // Reset focus when focus mode changes
  useEffect(() => { if (isFocusMode) { setIsFocused(false); } }, [isFocusMode]);

  const hasLocal = filteredLocal.length > 0;
  const hasCloud = filteredCloud.length > 0;
  const hasQQ = qqResults.length > 0 || qqLoading;
  const hasAny = hasLocal || hasCloud || hasQQ;
  let resultOffset = 0;

  return (
    <div
      ref={containerRef}
      className="flex flex-col transition-all duration-400 ease-out"
      style={{
        WebkitAppRegion: isHidden ? 'drag' : 'no-drag',
        width: isExpanded ? '440px' : '430px',
        maxWidth: 'calc(100vw - 180px)',
        opacity: isHidden ? 0 : 1,
        transform: isHidden ? 'translateY(-14px) scale(0.96)' : 'translateY(0) scale(1)',
        pointerEvents: isHidden ? 'none' : 'auto',
      } as React.CSSProperties}
    >
      {/* Input bar */}
      <div
        className="flex items-center shrink-0 relative"
        style={{
          height: '42px',
          background: `linear-gradient(180deg, ${isWindowFocused ? `${colors.backgroundDark}fa` : `${colors.backgroundDark}ee`} 0%, ${colors.backgroundSidebar} 100%)`,
          backdropFilter: 'blur(16px)',
          borderTop: `1px solid ${isFocused ? `${colors.primary}66` : isWindowFocused ? `${colors.borderHover}66` : `${colors.borderLight}44`}`,
          borderLeft: `1px solid ${isFocused ? `${colors.primary}66` : isWindowFocused ? `${colors.borderHover}66` : `${colors.borderLight}44`}`,
          borderRight: `1px solid ${isFocused ? `${colors.primary}66` : isWindowFocused ? `${colors.borderHover}66` : `${colors.borderLight}44`}`,
          borderBottom: isExpanded
            ? `1px solid ${colors.borderLight}`
            : `1px solid ${isFocused ? `${colors.primary}66` : isWindowFocused ? `${colors.borderHover}66` : `${colors.borderLight}44`}`,
          borderRadius: isExpanded ? '0px' : '0 0 18px 18px',
          boxShadow: isFocused
            ? `0 8px 20px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.04), 0 0 28px ${colors.glowColor}`
            : `0 8px 20px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.04)`,
          transition: 'border-color 0.35s ease, box-shadow 0.35s ease, border-radius 0.3s ease',
        }}
      >
        <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-base pointer-events-none transition-colors duration-350" style={{ color: isFocused ? colors.primary : colors.textMuted }}>search</span>
        <input
          ref={inputRef}
          type="text"
          placeholder={i18n.t('search.typeToSearch')}
          value={query}
          onChange={e => handleChange(e.target.value)}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          className="w-full h-full pl-11 pr-4 text-sm font-medium bg-transparent focus:outline-none"
          style={{ color: isWindowFocused ? colors.textPrimary : colors.textSecondary }}
        />
        {query && (
          <button
            onClick={collapse}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full transition-colors"
            style={{ color: colors.textMuted }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textPrimary; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.textMuted; }}
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>

      {/* Results panel (animated expand) */}
      <div
        className="overflow-hidden transition-all duration-350 ease-out"
        style={{
          maxHeight: isExpanded ? 'min(55vh, 480px)' : '0px',
          opacity: isExpanded ? 1 : 0,
          background: `linear-gradient(180deg, ${colors.backgroundSidebar}f8 0%, ${colors.backgroundDark}f2 100%)`,
          backdropFilter: 'blur(20px)',
          border: isExpanded ? `1px solid ${isFocused ? `${colors.primary}66` : colors.borderLight}` : '1px solid transparent',
          borderTop: 'none',
          borderRadius: '0 0 18px 18px',
          boxShadow: isExpanded
            ? `0 12px 28px rgba(0,0,0,0.22), 0 0 24px ${isFocused ? colors.glowColor : 'transparent'}`
            : 'none',
        }}
      >
        <div className="max-h-[min(55vh,480px)] overflow-y-auto no-scrollbar">
          {!hasAny ? (
            <div className="px-5 py-10 text-center" style={{ color: colors.textMuted }}>
              <span className="material-symbols-outlined text-3xl mb-2 block">search_off</span>
              <p className="text-sm">{i18n.t('search.noResults')}</p>
            </div>
          ) : (
            <div className="py-3">
              {hasLocal && (
                <div className="mb-2">
                  <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] flex items-center gap-2" style={{ color: colors.textMuted }}>
                    <span className="material-symbols-outlined text-xs">hard_drive</span>
                    {i18n.t('sidebar.local')}
                    <span className="opacity-50">({filteredLocal.length})</span>
                  </div>
                  {filteredLocal.map((track, idx) => (
                    <ResultRow key={track.id} track={track} source="local" isSelected={selectedIndex === resultOffset + idx} colors={colors}
                      onClick={() => { onNavigateToTrack(track); collapse(); }} />
                  ))}
                </div>
              )}
              {(() => { resultOffset += filteredLocal.length; return null; })()}

              {hasCloud && (
                <div className="mb-2">
                  <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] flex items-center gap-2" style={{ color: colors.textMuted }}>
                    <span className="material-symbols-outlined text-xs">cloud</span>
                    {i18n.t('sidebar.cloud')}
                    <span className="opacity-50">({filteredCloud.length})</span>
                  </div>
                  {filteredCloud.map((track, idx) => (
                    <ResultRow key={track.id} track={track} source="cloud" isSelected={selectedIndex === resultOffset + idx} colors={colors}
                      onClick={() => { onNavigateToTrack(track); collapse(); }} />
                  ))}
                </div>
              )}
              {(() => { resultOffset += filteredCloud.length; return null; })()}

              {hasQQ && (
                <div>
                  <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] flex items-center gap-2" style={{ color: colors.textMuted }}>
                    <span className="material-symbols-outlined text-xs">language</span>QQ Music
                    {qqLoading && <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                  </div>
                  {qqResults.length === 0 && qqLoading ? (
                    <div className="px-4 py-3 text-xs" style={{ color: colors.textMuted }}>{i18n.t('search.searching')}...</div>
                  ) : (
                    qqResults.map((song, idx) => (
                      <QQRow key={song.songmid} song={song} isSelected={selectedIndex === resultOffset + idx} colors={colors}
                        openQualityId={openQualityId} openUploadQualityId={openUploadQualityId}
                        onToggleQuality={id => setOpenQualityId(p => p === id ? null : id)}
                        onToggleUploadQuality={id => setOpenUploadQualityId(p => p === id ? null : id)}
                        onDownload={(s, q) => { onQQMusicDownload(s, q); setOpenQualityId(null); }}
                        onUpload={(s, q) => { onQQMusicUpload(s, q); setOpenUploadQualityId(null); }}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Result row for local/cloud
const ResultRow: React.FC<{
  track: Track; source: 'local' | 'cloud'; isSelected: boolean;
  colors: ThemeConfig['colors']; onClick: () => void;
}> = ({ track, source, isSelected, colors, onClick }) => (
  <div onClick={onClick}
    className="flex items-center gap-3 px-3 py-2.5 mx-2 rounded-xl transition-all cursor-pointer border"
    style={{ backgroundColor: isSelected ? colors.backgroundCardHover : 'transparent', borderColor: isSelected ? `${colors.primary}44` : 'transparent' }}
    onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.borderColor = isSelected ? `${colors.primary}44` : `${colors.borderLight}`; }}
    onMouseLeave={e => { e.currentTarget.style.backgroundColor = isSelected ? colors.backgroundCardHover : 'transparent'; e.currentTarget.style.borderColor = isSelected ? `${colors.primary}44` : 'transparent'; }}
  >
    <TrackCover trackId={track.id} filePath={track.filePath} fallbackUrl={track.coverUrl} className="size-10 rounded-lg object-cover flex-shrink-0 shadow-md" />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold truncate min-w-0" style={{ color: colors.textPrimary }}>{track.title}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0" style={{ backgroundColor: source === 'local' ? `${colors.primary}20` : `${colors.accent}20`, color: source === 'local' ? colors.primary : colors.accent }}>
          {source === 'local' ? 'Local' : 'Cloud'}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs min-w-0" style={{ color: colors.textMuted }}>
        <span className="truncate max-w-[160px]">{track.artist || 'Unknown Artist'}</span>
        <span className="opacity-30">•</span>
        <span className="truncate">{track.album || 'Unknown Album'}</span>
      </div>
    </div>
    <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: colors.textMuted }}>
      {Math.floor(track.duration / 60)}:{Math.floor(track.duration % 60).toString().padStart(2, '0')}
    </span>
  </div>
);

// Result row for QQ Music
const QQRow: React.FC<{
  song: QQMusicSong; isSelected: boolean; colors: ThemeConfig['colors'];
  openQualityId: string | null; openUploadQualityId: string | null;
  onToggleQuality: (id: string) => void; onToggleUploadQuality: (id: string) => void;
  onDownload: (song: QQMusicSong, quality: '128' | '320' | 'flac') => void;
  onUpload: (song: QQMusicSong, quality: '128' | '320' | 'flac') => void;
}> = ({ song, isSelected, colors, openQualityId, openUploadQualityId, onToggleQuality, onToggleUploadQuality, onDownload, onUpload }) => (
  <div
    className="flex items-center gap-3 px-3 py-2.5 mx-2 rounded-xl transition-all border"
    style={{ backgroundColor: isSelected ? colors.backgroundCardHover : 'transparent', borderColor: isSelected ? `${colors.warning}44` : 'transparent' }}
    onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.borderColor = isSelected ? `${colors.warning}44` : `${colors.borderLight}`; }}
    onMouseLeave={e => { e.currentTarget.style.backgroundColor = isSelected ? colors.backgroundCardHover : 'transparent'; e.currentTarget.style.borderColor = isSelected ? `${colors.warning}44` : 'transparent'; }}
  >
    <img src={song.coverUrl || `https://picsum.photos/seed/${song.songmid}/80/80`} className="size-10 rounded-lg object-cover flex-shrink-0 shadow-md" alt="" />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold truncate flex-1 min-w-0" style={{ color: colors.textPrimary }}>{song.songname}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0" style={{ backgroundColor: `${colors.warning}20`, color: colors.warning }}>QQ</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs min-w-0" style={{ color: colors.textMuted }}>
        <span className="truncate max-w-[150px]">{song.singer?.map(s => s.name).join(', ')}</span>
        <span className="opacity-30">•</span>
        <span className="truncate">{song.albumname || 'Unknown Album'}</span>
      </div>
    </div>
    <span className="text-[11px] tabular-nums mr-1 flex-shrink-0" style={{ color: colors.textMuted }}>
      {song.interval ? `${Math.floor(song.interval / 60)}:${Math.floor(song.interval % 60).toString().padStart(2, '0')}` : '--:--'}
    </span>
    {/* Download */}
    <div className="relative">
      <button onClick={e => { e.stopPropagation(); onToggleQuality(song.songmid); }}
        className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
        style={{ color: colors.textMuted }}
        onMouseEnter={e => { e.currentTarget.style.color = colors.primary; e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.backgroundColor = 'transparent'; }}
        title={i18n.t('browse.download')}>
        <span className="material-symbols-outlined text-sm">download</span>
      </button>
      {openQualityId === song.songmid && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[100px] rounded-lg shadow-xl overflow-hidden" style={{ backgroundColor: colors.backgroundCard, border: `1px solid ${colors.borderLight}` }}>
          {qualityOptions.map(opt => (
            <button key={opt.value} onClick={e => { e.stopPropagation(); onDownload(song, opt.value); }}
              className="w-full px-3 py-1.5 text-left text-xs transition-all" style={{ color: colors.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.primary; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textSecondary; }}>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
    {/* Upload */}
    <div className="relative">
      <button onClick={e => { e.stopPropagation(); onToggleUploadQuality(song.songmid); }}
        className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
        style={{ color: colors.textMuted }}
        onMouseEnter={e => { e.currentTarget.style.color = colors.accent; e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.backgroundColor = 'transparent'; }}
        title={i18n.t('browse.uploadToCloud')}>
        <span className="material-symbols-outlined text-sm">cloud_upload</span>
      </button>
      {openUploadQualityId === song.songmid && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[100px] rounded-lg shadow-xl overflow-hidden" style={{ backgroundColor: colors.backgroundCard, border: `1px solid ${colors.borderLight}` }}>
          {qualityOptions.map(opt => (
            <button key={opt.value} onClick={e => { e.stopPropagation(); onUpload(song, opt.value); }}
              className="w-full px-3 py-1.5 text-left text-xs transition-all" style={{ color: colors.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.accent; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textSecondary; }}>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  </div>
);

export default SearchBox;
