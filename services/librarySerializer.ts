import { Track } from '../types';
import type { LibraryIndexData, LibrarySettings } from './libraryStorage';
import { sanitizePersistedCoverUrl } from './coverUrl';

function serializeTrack(track: Track): any {
  const coverUrl = sanitizePersistedCoverUrl(track.coverUrl);
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
    lastPlayed: track.lastPlayed ?? undefined,
    available: track.available ?? true,
    source: track.source,
    webdavPath: track.webdavPath || '',
    songmid: track.songmid || '',
  };
}

export function buildLibraryIndexData(
  tracks: Track[],
  settings: LibrarySettings,
  cloudTracks?: Track[],
  onlineTracks?: Track[]
): LibraryIndexData {
  return {
    songs: tracks.map(serializeTrack),
    ...(cloudTracks && cloudTracks.length > 0 ? { cloudSongs: cloudTracks.map(serializeTrack) } : {}),
    ...(onlineTracks && onlineTracks.length > 0 ? { onlineSongs: onlineTracks.map(serializeTrack) } : {}),
    settings
  };
}

export function buildLibraryIndexDataForSlots(
  localTracks: Track[],
  cloudTracks: Track[],
  settings: LibrarySettings,
  onlineTracks?: Track[]
): LibraryIndexData {
  return buildLibraryIndexData(localTracks, settings, cloudTracks, onlineTracks);
}
