import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Track } from '../../types';
import type { ThemeColors } from '../../types/theme';
import { formatDuration } from '../../shared/formatDuration';
import TrackCover from '../TrackCover';
import { isPlainEnter } from '../../shared/keyboard';

interface SearchResultRowProps {
  track: Track;
  isSelected: boolean;
  colors: ThemeColors;
  /** Download progress 0–100 for an online result being saved. */
  progress?: number | undefined;
  id?: string | undefined;
  onActivate: () => void;
  onOpenMenu?: ((track: Track, x: number, y: number, trigger: HTMLElement) => void) | undefined;
}

const SOURCE_LABEL_KEYS: Partial<Record<NonNullable<Track['source']>, string>> = {
  qq: 'search.sourceQq',
  netease: 'search.sourceNetease',
};

/** Compact result row for the search dropdown (listbox option). */
function SearchResultRow({ track, isSelected, colors, progress, id, onActivate, onOpenMenu }: SearchResultRowProps) {
  const { t } = useTranslation();
  const sourceKey = track.source ? SOURCE_LABEL_KEYS[track.source] : undefined;
  return (
    <div
      id={id}
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
      className={`search-result-row${isSelected ? ' search-result-row--selected' : ''}`}
      onClick={onActivate}
      onKeyDown={event => {
        if (isPlainEnter(event) || (event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey)) {
          event.preventDefault();
          onActivate();
        }
      }}
      onContextMenu={event => {
        if (!onOpenMenu) return;
        event.preventDefault();
        onOpenMenu(track, event.clientX, event.clientY, event.currentTarget);
      }}
    >
      <TrackCover trackId={track.id} filePath={track.filePath} fallbackUrl={track.coverUrl}
        className="search-result-row__cover" />
      <span className="search-result-row__body">
        <span className="search-result-row__title" style={{ color: colors.textPrimary }}>{track.title}</span>
        <span className="search-result-row__meta" style={{ color: colors.textMuted }}>
          {sourceKey && <span className="search-result-row__badge" style={{ color: colors.warning }}>{t(sourceKey)}</span>}
          {track.artist || t('common.unknownArtist')}
        </span>
      </span>
      <span className="search-result-row__trailing tabular-nums" style={{ color: progress != null ? colors.primary : colors.textMuted }}>
        {progress != null ? `${Math.round(progress)}%` : track.duration > 0 ? formatDuration(track.duration) : ''}
      </span>
    </div>
  );
}

export default memo(SearchResultRow);
