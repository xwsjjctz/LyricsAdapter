import React from 'react';
import { toCoverThumb } from '../../services/coverUrl';
import type { PlaylistEntry } from './types';
import PlaylistCard from './PlaylistCard';

interface MainViewProps {
  entries: PlaylistEntry[];
  onOpenPlaylist: (entry: PlaylistEntry) => void;
  onPlaylistContextMenu: (entry: PlaylistEntry, event: React.MouseEvent) => void;
  onExitNewUx: () => void;
}

const MainView: React.FC<MainViewProps> = ({ entries, onOpenPlaylist, onPlaylistContextMenu, onExitNewUx }) => {
  const ambientCovers = entries.flatMap(entry => entry.coverUrls).slice(0, 14);

  return (
    <section className="new-ux-mainview new-ux-scrollbar">
      <header className="new-ux-mainview__header">
        <div>
          <h1 className="new-ux-mainview__title">Lyrics Adapter</h1>
          <p className="new-ux-mainview__subtitle">Choose a playlist space to browse, play, and organize your music.</p>
        </div>
        <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={onExitNewUx} aria-label="Exit new UI">
          <span className="material-symbols-outlined text-[22px]">logout</span>
        </button>
      </header>
      <div className="new-ux-ambient-card-field" aria-hidden="true">
        {ambientCovers.map((coverUrl, index) => (
          <div className="new-ux-ambient-card" key={`${coverUrl}-${index}`}>
            <img src={toCoverThumb(coverUrl, 256)} alt="" />
            <div className="new-ux-ambient-card__bar" />
          </div>
        ))}
      </div>
      <div className="new-ux-playlist-space">
        {entries.map(entry => (
          <PlaylistCard
            key={entry.id}
            entry={entry}
            onOpen={onOpenPlaylist}
            onContextMenu={onPlaylistContextMenu}
          />
        ))}
      </div>
    </section>
  );
};

export default MainView;
