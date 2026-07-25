
export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl?: string | undefined;
  lyrics?: string | undefined;
  syncedLyrics?: SyncedLyricLine[] | undefined;
  /**
   * Raw QRC/YRC payload (QQ's decrypted `<QrcInfos>` XML or NetEase's plain
   * YRC), persisted so the richer per-word timing can be re-parsed after a
   * cache reset / re-import. Empty for line-level-only lyrics.
   */
  wordLyrics?: string | undefined;
  wordLyricsFormat?: 'qrc' | 'yrc' | undefined;
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

  // Source: local file, WebDAV, or a third-party online stream.
  // Online tracks carry `songmid` so their `stream://` audioUrl can be rebuilt.
  source?: 'local' | 'webdav' | 'qq' | 'netease' | 'soda' | undefined;
  webdavPath?: string | undefined;
  /** Third-party song id — used by `stream://`. */
  songmid?: string | undefined;
  cdnUrl?: string | undefined;
  cdnUrlExpiry?: number | undefined;
}

export interface SyncedLyricLine {
  time: number; // in seconds
  text: string;
  /** Optional character/word-level timing, used by QRC and YRC karaoke lyrics. */
  words?: LyricWord[] | undefined;
}

export interface LyricWord {
  /** Start time in seconds. */
  time: number;
  /** Display duration in seconds. */
  duration: number;
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

export type SlotId = 'local' | 'cloud' | 'online' | 'playlist';

export interface LibrarySlot {
  id: SlotId;
  tracks: Track[];
  currentTrackIndex: number;
  currentTime: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  scrollPosition: number;
  filterType: 'default' | 'album' | 'artist';
  categorySelection: string | null;
}

export function createEmptySlot(id: SlotId): LibrarySlot {
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
  /** Raw QRC/YRC payload, persisted so cloud tracks restore per-word timing. */
  wordLyrics?: string;
  wordLyricsFormat?: 'qrc' | 'yrc';
  coverUrl?: string;
}

export enum ViewMode {
  PLAYER = 'player',
  LYRICS = 'lyrics',
  BROWSE = 'browse',
  METADATA = 'metadata',
  SETTINGS = 'settings',
  THEME = 'theme'
}
