import React from 'react';
import SearchBox from '../SearchBox';
import type { Track } from '../../types';
import type { OnlineSong } from '../../services/onlineMusicProvider';

interface NewUxSearchBoxProps {
  isWindowFocused?: boolean;
  localTracks: Track[];
  cloudTracks: Track[];
  onNavigateToTrack: (track: Track) => void;
  onOnlineDownload: (song: OnlineSong, quality: '128' | '320' | 'flac') => void;
  onOnlineUpload: (song: OnlineSong, quality: '128' | '320' | 'flac') => void;
  onOnlineStreamPlay: (song: OnlineSong, source: 'qq' | 'netease') => void;
  onlineProgress: Record<string, { type: 'download' | 'upload'; percent: number }>;
}

/**
 * Global search for the New UI. A floating, horizontally-centered search field
 * near the top of the stage. It reuses the legacy SearchBox verbatim (so the
 * pinyin-aware local/cloud filter, debounced QQ/NetEase online search, grouped
 * results, and "input bar + results panel join into one card" interaction are
 * all preserved) — only the placement changes.
 */
const NewUxSearchBox: React.FC<NewUxSearchBoxProps> = (props) => (
  <div className="new-ux-global-search">
    <SearchBox {...props} variant="new-ux" />
  </div>
);

export default NewUxSearchBox;
