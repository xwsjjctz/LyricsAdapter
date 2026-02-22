import { Track } from '../types';
import type { LibraryData, LibraryIndexData, LibrarySettings } from './libraryStorage';

export function buildLibraryData(tracks: Track[], settings: LibrarySettings): LibraryData {
  return {
    songs: tracks.map(track => {
      // Filter out file:// URLs - only keep blob:, data:, cover://, and https:// URLs
      let coverUrl = track.coverUrl || '';
      if (coverUrl.startsWith('file:')) {
        coverUrl = '';
      }
      return {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        lyrics: track.lyrics,
        syncedLyrics: track.syncedLyrics,
        audioUrl: '',
        coverUrl,
        filePath: track.filePath || '',
        fileName: track.fileName || '',
        fileSize: track.fileSize || 0,
        lastModified: track.lastModified || 0,
        addedAt: track.addedAt || new Date().toISOString(),
        playCount: track.playCount || 0,
        lastPlayed: track.lastPlayed || null,
        available: track.available ?? true
      };
    }),
    settings
  };
}

export function buildLibraryIndexData(tracks: Track[], settings: LibrarySettings): LibraryIndexData {
  return {
    songs: tracks.map(track => {
      // Filter out blob:, data:, and file:// URLs - only keep cover:// and https:// URLs
      let coverUrl = track.coverUrl || '';
      if (coverUrl.startsWith('blob:') || coverUrl.startsWith('data:') || coverUrl.startsWith('file:')) {
        coverUrl = '';
      }
      return {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        lyrics: track.lyrics,
        syncedLyrics: track.syncedLyrics,
        coverUrl,
        filePath: track.filePath || '',
        fileName: track.fileName || '',
        fileSize: track.fileSize || 0,
        lastModified: track.lastModified || 0,
        addedAt: track.addedAt || new Date().toISOString(),
        playCount: track.playCount || 0,
        lastPlayed: track.lastPlayed || null,
        available: track.available ?? true
      };
    }),
    settings
  };
}
