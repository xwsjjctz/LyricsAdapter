import React from 'react';
import { toCoverThumb } from '../../services/coverUrl';
import type { Track } from '../../types';
import { i18n } from '../../services/i18n';

interface FloatingPlayerPanelProps {
  track: Track | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onToggleFocus: () => void;
}

const FloatingPlayerPanel: React.FC<FloatingPlayerPanelProps> = ({
  track,
  isPlaying,
  onTogglePlay,
  onSkipNext,
  onSkipPrev,
  onToggleFocus,
}) => {
  return (
    <div className="new-ux-player">
      <button
        type="button"
        className="new-ux-button-reset new-ux-player__track"
        onClick={track ? onToggleFocus : undefined}
        aria-label="Open focus mode"
      >
        <div className="new-ux-player__cover">
          {track?.coverUrl ? (
            <img src={toCoverThumb(track.coverUrl, 128)} alt="" />
          ) : (
            <span className="material-symbols-outlined flex size-full items-center justify-center text-[24px]">music_note</span>
          )}
        </div>
        <div className="min-w-0 text-left">
          <div className="new-ux-player__title">{track?.title ?? i18n.t('controls.noTrackSelected')}</div>
          <div className="new-ux-player__artist">{track ? `${track.artist} · ${track.album}` : i18n.t('mainPlayer.importTracks')}</div>
        </div>
      </button>
      <div className="new-ux-player__controls">
        <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onSkipPrev} disabled={!track}>
          <span className="material-symbols-outlined text-[24px]">skip_previous</span>
        </button>
        <button type="button" className="new-ux-button-reset new-ux-icon-button new-ux-icon-button--primary" onClick={onTogglePlay} disabled={!track}>
          <span className="material-symbols-outlined text-[26px] fill-icon">{isPlaying ? 'pause' : 'play_arrow'}</span>
        </button>
        <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onSkipNext} disabled={!track}>
          <span className="material-symbols-outlined text-[24px]">skip_next</span>
        </button>
      </div>
    </div>
  );
};

export default FloatingPlayerPanel;
