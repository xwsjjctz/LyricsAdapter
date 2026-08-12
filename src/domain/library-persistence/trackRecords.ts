import type { SlotId } from '../../types';
import type {
  PersistedLibrarySnapshot,
  PersistedLibrarySong,
  UserTrackRecord,
} from './models';

export function minimalTrackToPersistedSong(
  record: UserTrackRecord,
  createTimestamp: () => string,
): PersistedLibrarySong {
  return {
    id: record.id,
    title: '',
    artist: '',
    album: '',
    duration: 0,
    coverUrl: '',
    filePath: record.filePath || '',
    fileName: record.fileName || '',
    fileSize: record.fileSize || 0,
    lastModified: record.lastModified || 0,
    addedAt: record.addedAt || createTimestamp(),
    playCount: record.playCount || 0,
    lastPlayed: record.lastPlayed ?? null,
    available: record.available ?? true,
    source: record.source === 'webdav'
      ? 'webdav'
      : record.source === 'qq'
        ? 'qq'
        : record.source === 'netease'
          ? 'netease'
          : record.source === 'soda'
            ? 'soda'
            : 'local',
    webdavPath: record.webdavPath || '',
    songmid: record.songmid || '',
  };
}

function songsToMinimalRecords(
  songs: PersistedLibrarySong[] | undefined,
  slotId: SlotId,
): UserTrackRecord[] {
  if (!songs || songs.length === 0) return [];
  return songs.map(song => ({
    id: song.id,
    slotId,
    ...(song.filePath ? { filePath: song.filePath } : undefined),
    ...(song.webdavPath ? { webdavPath: song.webdavPath } : undefined),
    ...(song.fileName ? { fileName: song.fileName } : undefined),
    ...(song.fileSize ? { fileSize: song.fileSize } : undefined),
    ...(song.lastModified ? { lastModified: song.lastModified } : undefined),
    ...(song.source ? { source: song.source } : undefined),
    ...(song.addedAt ? { addedAt: song.addedAt } : undefined),
    ...(song.playCount != null ? { playCount: song.playCount } : undefined),
    ...(song.lastPlayed !== undefined ? { lastPlayed: song.lastPlayed } : undefined),
    ...(song.songmid ? { songmid: song.songmid } : undefined),
    ...(song.available !== undefined ? { available: song.available } : undefined),
  }));
}

/** Build the authoritative minimal membership records used to seed users.json. */
export function buildUserTracksFromLibraryCache(
  libraryData: PersistedLibrarySnapshot,
): UserTrackRecord[] {
  return [
    ...songsToMinimalRecords(libraryData.songs, 'local'),
    ...songsToMinimalRecords(libraryData.cloudSongs, 'cloud'),
    ...songsToMinimalRecords(libraryData.onlineSongs, 'online'),
    ...songsToMinimalRecords(libraryData.playlistSongs, 'playlist'),
  ];
}
