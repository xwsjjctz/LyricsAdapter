
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
}

export interface SyncedLyricLine {
  time: number; // in seconds
  text: string;
}

export enum ViewMode {
  PLAYER = 'player',
  LYRICS = 'lyrics',
  BROWSE = 'browse'
}
