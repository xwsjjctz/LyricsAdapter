
export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl?: string | undefined;
  lyrics?: string | undefined;
  syncedLyrics?: SyncedLyricLine[] | undefined;
  audioUrl: string;
  file?: File | undefined;
  available?: boolean | undefined;

  // Persistence fields for Electron
  filePath?: string | undefined;
  fileName?: string | undefined;
  fileSize?: number | undefined;
  lastModified?: number | undefined;
  addedAt?: string | undefined;
  playCount?: number | undefined;
  lastPlayed?: string | undefined;

  // WebDAV fields
  source?: 'local' | 'webdav' | undefined;
  webdavPath?: string | undefined;
  cdnUrl?: string | undefined;
  cdnUrlExpiry?: number | undefined;
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

export interface MetaJson {
  title: string;
  artist: string;
  album: string;
  duration: number;        // seconds
  fileSize: number;         // bytes
  fileName: string;
  lastModified: string;     // ISO 8601
  lyrics?: string;
  syncedLyrics?: SyncedLyricLine[];
  coverUrl?: string;
  coverHash?: string;
  coverMime?: string;
}

export enum ViewMode {
  PLAYER = 'player',
  LYRICS = 'lyrics',
  BROWSE = 'browse',
  METADATA = 'metadata',
  SETTINGS = 'settings',
  THEME = 'theme'
}
