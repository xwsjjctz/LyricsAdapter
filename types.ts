
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
