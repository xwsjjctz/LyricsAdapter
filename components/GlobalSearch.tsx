import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Track } from '../types';
import { QQMusicSong, qqMusicApi } from '../services/qqMusicApi';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';
import { logger } from '../services/logger';
import TrackCover from './TrackCover';

const QQ_DEBOUNCE_MS = 300;
const MAX_RESULTS_PER_SECTION = 8;

const qualityOptions = [
  { value: '128' as const, label: '128kbps' },
  { value: '320' as const, label: '320kbps' },
  { value: 'flac' as const, label: 'FLAC' },
];

export interface GlobalSearchProps {
  query: string;
  isOpen: boolean;
  onClose: () => void;
  localTracks: Track[];
  cloudTracks: Track[];
  onNavigateToTrack: (track: Track) => void;
  onQQMusicDownload: (song: QQMusicSong, quality: '128' | '320' | 'flac') => void;
  onQQMusicUpload: (song: QQMusicSong, quality: '128' | '320' | 'flac') => void;
}

const GlobalSearch: React.FC<GlobalSearchProps> = ({
  query,
  isOpen,
  onClose,
  localTracks,
  cloudTracks,
  onNavigateToTrack,
  onQQMusicDownload,
  onQQMusicUpload,
}) => {
  const [qqResults, setQqResults] = useState<QQMusicSong[]>([]);
  const [qqLoading, setQqLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [openQualityId, setOpenQualityId] = useState<string | null>(null);
  const [openUploadQualityId, setOpenUploadQualityId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  const [, setLangVersion] = useState(0);

  useEffect(() => {
    const unsub1 = themeManager.subscribe(() => setCurrentTheme(themeManager.getCurrentTheme()));
    const unsub2 = i18n.subscribe(() => setLangVersion(v => v + 1));
    return () => { unsub1(); unsub2(); };
  }, []);

  const colors = currentTheme.colors;

  const filteredLocal = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return localTracks
      .filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS_PER_SECTION);
  }, [localTracks, query]);

  const filteredCloud = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return cloudTracks
      .filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS_PER_SECTION);
  }, [cloudTracks, query]);

  // Debounced QQ Music search
  useEffect(() => {
    if (!query.trim() || !isOpen) {
      setQqResults([]);
      setQqLoading(false);
      return;
    }

    setQqLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        const results = await qqMusicApi.searchMusic(query.trim(), MAX_RESULTS_PER_SECTION);
        setQqResults(results);
      } catch (err) {
        logger.warn('[GlobalSearch] QQ Music search failed:', err);
        setQqResults([]);
      } finally {
        setQqLoading(false);
      }
    }, QQ_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isOpen]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(-1);
    setOpenQualityId(null);
    setOpenUploadQualityId(null);
  }, [query]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const totalItems = filteredLocal.length + filteredCloud.length + qqResults.length;
      if (totalItems === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, totalItems - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        handleSelectByIndex(selectedIndex);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, selectedIndex, filteredLocal, filteredCloud, qqResults]);

  const handleSelectByIndex = useCallback((idx: number) => {
    let offset = 0;
    if (idx < offset + filteredLocal.length) {
      onNavigateToTrack(filteredLocal[idx - offset]!);
      onClose();
      return;
    }
    offset += filteredLocal.length;
    if (idx < offset + filteredCloud.length) {
      onNavigateToTrack(filteredCloud[idx - offset]!);
      onClose();
      return;
    }
    // QQ Music items - no direct navigation, need user action via buttons
  }, [filteredLocal, filteredCloud, onNavigateToTrack, onClose]);

  const hasLocal = filteredLocal.length > 0;
  const hasCloud = filteredCloud.length > 0;
  const hasQQ = qqResults.length > 0 || qqLoading;
  const hasAny = hasLocal || hasCloud || hasQQ;
  let resultOffset = 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex justify-center pointer-events-none">
      <div
        ref={panelRef}
        className="pointer-events-auto mx-auto mt-[42px] w-[430px] max-w-[calc(100vw-200px)] overflow-hidden rounded-b-[22px] border shadow-2xl transition-all duration-400 ease-out origin-top"
        style={{
          maxHeight: isOpen ? 'min(62vh, 560px)' : '0px',
          opacity: isOpen ? 1 : 0,
          transform: isOpen ? 'translateY(0) scaleY(1)' : 'translateY(-8px) scaleY(0.92)',
          background: `linear-gradient(180deg, color-mix(in srgb, ${colors.backgroundSidebar} 94%, transparent) 0%, color-mix(in srgb, ${colors.backgroundDark} 96%, transparent) 100%)`,
          borderColor: 'var(--theme-border-light, rgba(255,255,255,0.15))',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.38)',
        }}
      >
        <div className="max-h-[min(62vh,560px)] overflow-y-auto no-scrollbar">
        {!query.trim() ? (
          <div className="px-5 py-8 text-center" style={{ color: colors.textMuted }}>
            <span className="material-symbols-outlined text-3xl mb-2 block">search</span>
            <p className="text-xs tracking-[0.08em] uppercase">Search Library</p>
            <p className="text-sm mt-2">{i18n.t('search.typeToSearch')}</p>
          </div>
        ) : !hasAny ? (
          <div className="px-5 py-8 text-center" style={{ color: colors.textMuted }}>
            <span className="material-symbols-outlined text-3xl mb-2 block">search_off</span>
            <p className="text-sm">{i18n.t('search.noResults')}</p>
          </div>
        ) : (
          <div className="py-3">
            {/* Local results */}
            {hasLocal && (
              <div className="mb-3">
                <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] flex items-center gap-2" style={{ color: colors.textMuted }}>
                  <span className="material-symbols-outlined text-xs">hard_drive</span>
                  {i18n.t('sidebar.local')}
                  <span className="opacity-50">({filteredLocal.length})</span>
                </div>
                {filteredLocal.map((track, index) => (
                  <SearchResultRow
                    key={track.id}
                    track={track}
                    source="local"
                    isSelected={selectedIndex === resultOffset + index}
                    colors={colors}
                    onClick={() => { onNavigateToTrack(track); onClose(); }}
                  />
                ))}
              </div>
            )}
            {(() => { resultOffset += filteredLocal.length; return null; })()}

            {/* Cloud results */}
            {hasCloud && (
              <div className="mb-3">
                <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] flex items-center gap-2" style={{ color: colors.textMuted }}>
                  <span className="material-symbols-outlined text-xs">cloud</span>
                  {i18n.t('sidebar.cloud')}
                  <span className="opacity-50">({filteredCloud.length})</span>
                </div>
                {filteredCloud.map((track, index) => (
                  <SearchResultRow
                    key={track.id}
                    track={track}
                    source="cloud"
                    isSelected={selectedIndex === resultOffset + index}
                    colors={colors}
                    onClick={() => { onNavigateToTrack(track); onClose(); }}
                  />
                ))}
              </div>
            )}
            {(() => { resultOffset += filteredCloud.length; return null; })()}

            {/* QQ Music results */}
            {hasQQ && (
              <div>
                <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] flex items-center gap-2" style={{ color: colors.textMuted }}>
                  <span className="material-symbols-outlined text-xs">language</span>
                  QQ Music
                  {qqLoading && <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
                </div>
                {qqResults.length === 0 && qqLoading ? (
                  <div className="px-4 py-3 text-xs" style={{ color: colors.textMuted }}>{i18n.t('search.searching')}...</div>
                ) : (
                  qqResults.map((song, index) => (
                    <QQResultRow
                      key={song.songmid}
                      song={song}
                      isSelected={selectedIndex === resultOffset + index}
                      colors={colors}
                      openQualityId={openQualityId}
                      openUploadQualityId={openUploadQualityId}
                      onToggleQuality={(id) => setOpenQualityId(prev => prev === id ? null : id)}
                      onToggleUploadQuality={(id) => setOpenUploadQualityId(prev => prev === id ? null : id)}
                      onDownload={(song, q) => { onQQMusicDownload(song, q); setOpenQualityId(null); }}
                      onUpload={(song, q) => { onQQMusicUpload(song, q); setOpenUploadQualityId(null); }}
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

// Sub-component for local/cloud search results
const SearchResultRow: React.FC<{
  track: Track;
  source: 'local' | 'cloud';
  isSelected: boolean;
  colors: ThemeConfig['colors'];
  onClick: () => void;
}> = ({ track, source, isSelected, colors, onClick }) => (
  <div
    onClick={onClick}
    className="flex items-center gap-3 px-3 py-2.5 mx-2 rounded-xl transition-all cursor-pointer border"
    style={{
      backgroundColor: isSelected ? colors.backgroundCardHover : 'transparent',
      borderColor: isSelected ? `${colors.primary}44` : 'transparent',
    }}
    onMouseEnter={e => {
      e.currentTarget.style.backgroundColor = colors.backgroundCard;
      e.currentTarget.style.borderColor = isSelected ? `${colors.primary}44` : `${colors.borderLight}`;
    }}
    onMouseLeave={e => {
      e.currentTarget.style.backgroundColor = isSelected ? colors.backgroundCardHover : 'transparent';
      e.currentTarget.style.borderColor = isSelected ? `${colors.primary}44` : 'transparent';
    }}
  >
    <TrackCover
      trackId={track.id}
      filePath={track.filePath}
      fallbackUrl={track.coverUrl}
      className="size-10 rounded-lg object-cover flex-shrink-0 shadow-md"
    />
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

// Sub-component for QQ Music search results
const QQResultRow: React.FC<{
  song: QQMusicSong;
  isSelected: boolean;
  colors: ThemeConfig['colors'];
  openQualityId: string | null;
  openUploadQualityId: string | null;
  onToggleQuality: (id: string) => void;
  onToggleUploadQuality: (id: string) => void;
  onDownload: (song: QQMusicSong, quality: '128' | '320' | 'flac') => void;
  onUpload: (song: QQMusicSong, quality: '128' | '320' | 'flac') => void;
}> = ({ song, isSelected, colors, openQualityId, openUploadQualityId, onToggleQuality, onToggleUploadQuality, onDownload, onUpload }) => (
  <div
    className="flex items-center gap-3 px-3 py-2.5 mx-2 rounded-xl transition-all border"
    style={{
      backgroundColor: isSelected ? colors.backgroundCardHover : 'transparent',
      borderColor: isSelected ? `${colors.warning}44` : 'transparent',
    }}
    onMouseEnter={e => {
      e.currentTarget.style.backgroundColor = colors.backgroundCard;
      e.currentTarget.style.borderColor = isSelected ? `${colors.warning}44` : `${colors.borderLight}`;
    }}
    onMouseLeave={e => {
      e.currentTarget.style.backgroundColor = isSelected ? colors.backgroundCardHover : 'transparent';
      e.currentTarget.style.borderColor = isSelected ? `${colors.warning}44` : 'transparent';
    }}
  >
    <img
      src={song.coverUrl || `https://picsum.photos/seed/${song.songmid}/80/80`}
      className="size-10 rounded-lg object-cover flex-shrink-0 shadow-md"
      alt=""
    />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold truncate flex-1 min-w-0" style={{ color: colors.textPrimary }}>{song.songname}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0" style={{ backgroundColor: `${colors.warning}20`, color: colors.warning }}>
          QQ
        </span>
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
    {/* Download button */}
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); onToggleQuality(song.songmid); }}
        className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
        style={{ color: colors.textMuted }}
        onMouseEnter={e => { e.currentTarget.style.color = colors.primary; e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.backgroundColor = 'transparent'; }}
        title={i18n.t('browse.download')}
      >
        <span className="material-symbols-outlined text-sm">download</span>
      </button>
      {openQualityId === song.songmid && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[100px] rounded-lg shadow-xl overflow-hidden" style={{ backgroundColor: colors.backgroundCard, border: `1px solid ${colors.borderLight}` }}>
          {qualityOptions.map(opt => (
            <button
              key={opt.value}
              onClick={(e) => { e.stopPropagation(); onDownload(song, opt.value); }}
              className="w-full px-3 py-1.5 text-left text-xs transition-all"
              style={{ color: colors.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.primary; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textSecondary; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
    {/* Upload to WebDAV button */}
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); onToggleUploadQuality(song.songmid); }}
        className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
        style={{ color: colors.textMuted }}
        onMouseEnter={e => { e.currentTarget.style.color = colors.accent; e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.backgroundColor = 'transparent'; }}
        title={i18n.t('browse.uploadToCloud')}
      >
        <span className="material-symbols-outlined text-sm">cloud_upload</span>
      </button>
      {openUploadQualityId === song.songmid && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[100px] rounded-lg shadow-xl overflow-hidden" style={{ backgroundColor: colors.backgroundCard, border: `1px solid ${colors.borderLight}` }}>
          {qualityOptions.map(opt => (
            <button
              key={opt.value}
              onClick={(e) => { e.stopPropagation(); onUpload(song, opt.value); }}
              className="w-full px-3 py-1.5 text-left text-xs transition-all"
              style={{ color: colors.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; e.currentTarget.style.color = colors.accent; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; e.currentTarget.style.color = colors.textSecondary; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  </div>
);

export default GlobalSearch;
