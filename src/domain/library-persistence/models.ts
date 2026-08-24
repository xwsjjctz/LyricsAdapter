import type {
  LibrarySlot,
  PlaybackContext,
  SlotId,
  SyncedLyricLine,
} from '../../types';

export interface PersistedLibrarySong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  lyrics?: string;
  syncedLyrics?: SyncedLyricLine[];
  wordLyrics?: string;
  wordLyricsFormat?: 'qrc' | 'yrc';
  coverUrl?: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  lastModified?: number;
  addedAt?: string;
  playCount?: number;
  lastPlayed?: string | null;
  available?: boolean;
  source?: 'local' | 'webdav' | 'qq' | 'netease';
  webdavPath?: string;
  songmid?: string;
}

export interface PersistedLibrarySettings {
  volume?: number | undefined;
  autoScroll?: boolean | undefined;
  theme?: string | undefined;
  currentTrackIndex?: number | undefined;
  currentTrackId?: string | undefined;
  currentTime?: number | undefined;
  isPlaying?: boolean | undefined;
  playbackMode?: 'order' | 'shuffle' | 'repeat-one' | undefined;
  libraryDataSource?: 'local' | 'cloud' | undefined;
  localCurrentTrackId?: string | undefined;
  cloudCurrentTrackId?: string | undefined;
  activeDataSource?: 'local' | 'cloud' | undefined;
  localPlaybackContext?: PlaybackContext | undefined;
  cloudPlaybackContext?: PlaybackContext | undefined;
  localSlot?: Omit<LibrarySlot, 'id' | 'tracks'> | undefined;
  cloudSlot?: Omit<LibrarySlot, 'id' | 'tracks'> | undefined;
  onlineSlot?: Omit<LibrarySlot, 'id' | 'tracks'> | undefined;
  playlistSlot?: Omit<LibrarySlot, 'id' | 'tracks'> | undefined;
  activeSlotId?: SlotId | undefined;
  [key: string]: any;
}

export interface PersistedLibrarySnapshot {
  songs: PersistedLibrarySong[];
  cloudSongs?: PersistedLibrarySong[];
  onlineSongs?: PersistedLibrarySong[];
  playlistSongs?: PersistedLibrarySong[];
  settings: PersistedLibrarySettings;
}

export interface UserTrackRecord {
  id: string;
  slotId?: SlotId;
  filePath?: string;
  webdavPath?: string;
  fileName?: string;
  fileSize?: number;
  lastModified?: number;
  source?: string;
  addedAt?: string;
  playCount?: number;
  lastPlayed?: string | null;
  songmid?: string;
  available?: boolean;
}
