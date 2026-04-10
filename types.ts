
export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // in seconds
  coverUrl?: string;
  lyrics?: string;
  syncedLyrics?: SyncedLyricLine[]; // Time-synced lyrics
  audioUrl: string;
  file?: File;
  available?: boolean; // Whether the audio file is currently available

  // Persistence fields for Electron
  filePath?: string; // Original file path on disk
  fileName?: string; // Original file name
  fileSize?: number; // File size in bytes
  lastModified?: number; // File last modified timestamp
  addedAt?: string; // ISO timestamp when added to library
  playCount?: number; // Number of times played
  lastPlayed?: string; // ISO timestamp of last play

  // WebDAV fields
  source?: 'local' | 'webdav';
  webdavPath?: string;
  cdnUrl?: string;
  cdnUrlExpiry?: number;
}

export interface SyncedLyricLine {
  time: number; // in seconds
  text: string;
}

export interface PlaybackContext {
  trackIndex: number;
  trackId?: string;
  currentTime: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  isPlaying: boolean;
}

export interface LibrarySlot {
  id: 'local' | 'cloud';
  tracks: Track[];
  currentTrackIndex: number;
  currentTime: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  scrollPosition: number;
  filterType: 'default' | 'album' | 'artist';
  categorySelection: string | null;
}

export function createEmptySlot(id: 'local' | 'cloud'): LibrarySlot {
  return {
    id,
    tracks: [],
    currentTrackIndex: -1,
    currentTime: 0,
    volume: 0.5,
    playbackMode: 'order',
    scrollPosition: 0,
    filterType: 'default',
    categorySelection: null,
  };
}

export enum ViewMode {
  PLAYER = 'player',
  LYRICS = 'lyrics',
  BROWSE = 'browse',
  METADATA = 'metadata',
  SETTINGS = 'settings',
  THEME = 'theme'
}
