import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { buildUpNext, type UpNextMode } from '../domain/upNext';
import { formatDuration } from '../shared/formatDuration';
import type { Track } from '../types';
import { useCurrentTheme } from './settings/shared';
import TrackCover from './TrackCover';
import { IconButton } from './ui';

/** Enough to see what's coming without rendering a whole library. */
const UP_NEXT_LIMIT = 50;

interface UpNextPanelProps {
  /** The playing list (active slot), not the list being browsed. */
  tracks: Track[];
  currentIndex: number;
  mode: UpNextMode;
  sourceLabel: string;
  bottomInset?: number;
  onPlayIndex: (index: number) => void;
  onClose: () => void;
}

/** Right-hand drawer showing the current track and what follows it. */
export default function UpNextPanel({
  tracks,
  currentIndex,
  mode,
  sourceLabel,
  bottomInset = 0,
  onPlayIndex,
  onClose,
}: UpNextPanelProps) {
  const { t } = useTranslation();
  const { colors } = useCurrentTheme();
  const panelRef = useRef<HTMLElement>(null);
  const { current, upcoming } = useMemo(
    () => buildUpNext(tracks, currentIndex, mode, UP_NEXT_LIMIT),
    [tracks, currentIndex, mode],
  );

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const note = mode === 'shuffle' ? t('upNext.shuffleNote')
    : mode === 'repeat-one' ? t('upNext.repeatNote')
      : current && upcoming.length === 0 ? t('upNext.endOfList') : null;

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label={t('upNext.title')}
      className="up-next-panel"
      style={{
        backgroundColor: colors.backgroundSidebar,
        borderColor: colors.borderLight,
        color: colors.textPrimary,
        bottom: bottomInset,
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="up-next-panel__header">
        <h2 className="up-next-panel__title">{t('upNext.title')}</h2>
        <IconButton icon="close" label={t('common.close')} size="sm" onClick={onClose} />
      </header>

      {!current ? (
        <p className="up-next-panel__note" style={{ color: colors.textMuted }}>{t('upNext.nothingPlaying')}</p>
      ) : (
        <>
          <section className="up-next-panel__now" aria-label={t('upNext.nowPlaying')}>
            <p className="up-next-panel__label" style={{ color: colors.textMuted }}>{t('upNext.nowPlaying')}</p>
            <div className="up-next-panel__current">
              <TrackCover trackId={current.id} filePath={current.filePath} fallbackUrl={current.coverUrl}
                className="up-next-panel__current-cover" />
              <div className="min-w-0">
                <p className="up-next-panel__track-title">{current.title}</p>
                <p className="up-next-panel__track-meta" style={{ color: colors.textMuted }}>{current.artist}</p>
              </div>
            </div>
            <p className="up-next-panel__source" style={{ color: colors.textMuted }}>
              {t('upNext.playingFrom', { source: sourceLabel })}
            </p>
          </section>

          {note && <p className="up-next-panel__note" style={{ color: colors.textMuted }}>{note}</p>}

          {upcoming.length > 0 && (
            <ol className="up-next-panel__list no-scrollbar">
              {upcoming.map(({ track, index }) => (
                <li key={`${track.id}-${index}`}>
                  <button type="button" className="up-next-panel__row" onClick={() => onPlayIndex(index)}>
                    <TrackCover trackId={track.id} filePath={track.filePath} fallbackUrl={track.coverUrl}
                      className="up-next-panel__row-cover" />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="up-next-panel__track-title block">{track.title}</span>
                      <span className="up-next-panel__track-meta block" style={{ color: colors.textMuted }}>{track.artist}</span>
                    </span>
                    <span className="up-next-panel__duration tabular-nums" style={{ color: colors.textMuted }}>
                      {formatDuration(track.duration)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </aside>
  );
}
