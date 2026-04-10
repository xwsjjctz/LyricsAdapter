import { Track } from '../types';
import type { LibraryData, LibraryIndexData, LibrarySettings } from './libraryStorage';

function serializeTrack(track: Track): any {
  let coverUrl = track.coverUrl || '';
  if (coverUrl.startsWith('blob:') || coverUrl.startsWith('file:')) {
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
    available: track.available ?? true,
    source: track.source,
    webdavPath: track.webdavPath || '',
  };
}

export function buildLibraryData(tracks: Track[], settings: LibrarySettings): LibraryData {
  return {
    songs: tracks.map(track => {
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

export function buildLibraryIndexData(
  tracks: Track[],
  settings: LibrarySettings,
  cloudTracks?: Track[]
): LibraryIndexData {
  return {
    songs: tracks.map(serializeTrack),
    ...(cloudTracks && cloudTracks.length > 0 ? { cloudSongs: cloudTracks.map(serializeTrack) } : {}),
    settings
  };
}
