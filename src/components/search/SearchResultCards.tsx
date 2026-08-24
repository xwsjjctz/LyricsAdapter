import React from 'react';
import { i18n } from '../../services/i18n';
import type { OnlineSong } from '../../services/onlineMusicProvider';
import type { Track } from '../../types';
import type { ThemeConfig } from '../../types/theme';
import TrackCover from '../TrackCover';

type SearchQuality = '128' | '320' | 'flac';

const qualityOptions: { value: SearchQuality; label: string }[] = [
  { value: '128', label: '128kbps' },
  { value: '320', label: '320kbps' },
  { value: 'flac', label: 'FLAC' },
];

export const SearchSectionLabel: React.FC<{
  icon: string;
  label: string;
  count?: number;
  isLoading?: boolean;
  colors: ThemeConfig['colors'];
}> = ({ icon, label, count, isLoading, colors }) => (
  <div className="search-result-section__label" style={{ color: colors.textMuted }}>
    <span className="material-symbols-outlined">{icon}</span>
    <span>{label}</span>
    {typeof count === 'number' && <span className="search-result-section__count">({count})</span>}
    {isLoading && <span className="search-result-section__spinner" aria-hidden="true" />}
  </div>
);

export const TrackSearchCard: React.FC<{
  track: Track;
  source: 'local' | 'cloud';
  isSelected: boolean;
  colors: ThemeConfig['colors'];
  onClick: () => void;
}> = ({ track, source, isSelected, colors, onClick }) => (
  <button
    type="button"
    className={`search-result-card${isSelected ? ' search-result-card--selected' : ''}`}
    style={{
      '--search-card-background': colors.backgroundCard,
      '--search-card-hover': colors.backgroundCardHover,
      '--search-card-border': colors.borderLight,
      '--search-card-highlight': source === 'local' ? colors.primary : colors.accent,
    } as React.CSSProperties}
    onClick={onClick}
  >
    <TrackCover
      trackId={track.id}
      filePath={track.filePath}
      fallbackUrl={track.coverUrl}
      thumbSize={256}
      className="search-result-card__cover"
    />
    <span className="search-result-card__body">
      <span className="search-result-card__title" style={{ color: colors.textPrimary }}>{track.title}</span>
      <span className="search-result-card__meta" style={{ color: colors.textMuted }}>
        {track.artist || i18n.t('common.unknownArtist')}
      </span>
    </span>
  </button>
);

const QualityMenu: React.FC<{
  colors: ThemeConfig['colors'];
  accent: string;
  onSelect: (quality: SearchQuality) => void;
}> = ({ colors, accent, onSelect }) => (
  <div
    className="search-quality-menu"
    style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}
    onClick={event => event.stopPropagation()}
  >
    {qualityOptions.map(option => (
      <button
        key={option.value}
        type="button"
        onClick={() => onSelect(option.value)}
        style={{ color: colors.textSecondary, '--search-quality-accent': accent } as React.CSSProperties}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export const OnlineSearchCard: React.FC<{
  song: OnlineSong;
  source: 'qq' | 'netease';
  isSelected: boolean;
  colors: ThemeConfig['colors'];
  progress?: { type: 'download' | 'upload'; percent: number };
  isDownloadMenuOpen: boolean;
  isUploadMenuOpen: boolean;
  onToggleDownloadMenu: () => void;
  onToggleUploadMenu: () => void;
  onDownload: (quality: SearchQuality) => void;
  onUpload: (quality: SearchQuality) => void;
  onStreamPlay: () => void;
}> = ({
  song,
  source,
  isSelected,
  colors,
  progress,
  isDownloadMenuOpen,
  isUploadMenuOpen,
  onToggleDownloadMenu,
  onToggleUploadMenu,
  onDownload,
  onUpload,
  onStreamPlay,
}) => {
  const badgeLabel = source === 'qq' ? i18n.t('search.sourceQq') : i18n.t('search.sourceNetease');
  const singer = song.singer?.map(item => item.name).join(', ') || i18n.t('common.unknownArtist');

  return (
    <div
      className={`search-result-card search-result-card--online${isSelected ? ' search-result-card--selected' : ''}`}
      style={{
        '--search-card-background': colors.backgroundCard,
        '--search-card-hover': colors.backgroundCardHover,
        '--search-card-border': colors.borderLight,
        '--search-card-highlight': colors.warning,
      } as React.CSSProperties}
      role="button"
      tabIndex={0}
      onClick={onStreamPlay}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onStreamPlay();
        }
      }}
    >
      <div className="search-result-card__cover-wrap">
        <img
          src={song.coverUrl || `https://picsum.photos/seed/${song.songmid}/180/180`}
          className="search-result-card__cover"
          alt=""
        />
        <span className="search-result-card__source" style={{ backgroundColor: colors.backgroundDark, color: colors.warning }}>
          {badgeLabel}
        </span>
        {progress && (
          <div className="search-result-card__progress" style={{ backgroundColor: colors.backgroundDark }}>
            <span
              style={{
                width: `${Math.max(0, Math.min(100, progress.percent))}%`,
                backgroundColor: progress.type === 'upload' ? colors.accent : colors.primary,
              }}
            />
          </div>
        )}
        {!progress && (
          <div className="search-result-card__actions">
            <div className="search-result-card__action-wrap">
              <button
                type="button"
                onClick={event => { event.stopPropagation(); onToggleDownloadMenu(); }}
                title={i18n.t('browse.download')}
                style={{ color: colors.textPrimary, backgroundColor: colors.backgroundDark }}
              >
                <span className="material-symbols-outlined">download</span>
              </button>
              {isDownloadMenuOpen && <QualityMenu colors={colors} accent={colors.primary} onSelect={onDownload} />}
            </div>
            <div className="search-result-card__action-wrap">
              <button
                type="button"
                onClick={event => { event.stopPropagation(); onToggleUploadMenu(); }}
                title={i18n.t('browse.uploadToCloud')}
                style={{ color: colors.textPrimary, backgroundColor: colors.backgroundDark }}
              >
                <span className="material-symbols-outlined">cloud_upload</span>
              </button>
              {isUploadMenuOpen && <QualityMenu colors={colors} accent={colors.accent} onSelect={onUpload} />}
            </div>
          </div>
        )}
      </div>
      <div className="search-result-card__body">
        <div className="search-result-card__title" style={{ color: colors.textPrimary }}>{song.songname}</div>
        <div className="search-result-card__meta" style={{ color: colors.textMuted }}>{singer}</div>
      </div>
    </div>
  );
};
