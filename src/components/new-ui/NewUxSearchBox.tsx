import React from 'react';
import SearchBox from '../SearchBox';
import type { Track } from '../../types';
import type { OnlineSong, OnlineSource } from '../../services/onlineMusicProvider';

interface NewUxSearchBoxProps {
  isWindowFocused?: boolean;
  localTracks: Track[];
  cloudTracks: Track[];
  onNavigateToTrack: (track: Track) => void;
  onOnlineDownload: (song: OnlineSong, quality: '128' | '320' | 'flac') => void;
  onOnlineUpload: (song: OnlineSong, quality: '128' | '320' | 'flac') => void;
  onOnlineStreamPlay: (song: OnlineSong, source: OnlineSource) => void;
  onlineProgress: Record<string, { type: 'download' | 'upload'; percent: number }>;
}

/**
 * Global search for the New UI. A floating, horizontally-centered search field
 * near the top of the stage. It reuses the legacy SearchBox verbatim (so the
 * pinyin-aware local/cloud filter, debounced QQ/NetEase online search, grouped
 * results, and "input bar + results panel join into one card" interaction are
 * all preserved) — only the placement changes.
 */
const NewUxSearchBox: React.FC<NewUxSearchBoxProps> = (props) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  return (
    <div className={`new-ux-global-search${isExpanded ? ' new-ux-global-search--expanded' : ''}`}>
      <SearchBox {...props} variant="new-ux" onExpandedChange={setIsExpanded} />
    </div>
  );
};

export default NewUxSearchBox;
