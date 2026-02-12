import { Track } from '../types';
import type { LibraryData, LibrarySettings } from './libraryStorage';

export function buildLibraryData(tracks: Track[], settings: LibrarySettings): LibraryData {
  return {
    songs: tracks.map(track => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      lyrics: track.lyrics,
      syncedLyrics: track.syncedLyrics,
      audioUrl: track.audioUrl || '',
      filePath: (track as any).filePath || '',
      fileName: (track as any).fileName || '',
      fileSize: (track as any).fileSize || 0,
      lastModified: (track as any).lastModified || 0,
      addedAt: (track as any).addedAt || new Date().toISOString(),
      playCount: (track as any).playCount || 0,
      lastPlayed: (track as any).lastPlayed || null,
      available: track.available ?? true
    })),
    settings
  };
}
