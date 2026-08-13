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
    ...(typeof song.filePath === 'string' && song.filePath ? { filePath: song.filePath } : undefined),
    ...(typeof song.webdavPath === 'string' && song.webdavPath ? { webdavPath: song.webdavPath } : undefined),
    ...(typeof song.fileName === 'string' && song.fileName ? { fileName: song.fileName } : undefined),
    ...(typeof song.fileSize === 'number' && Number.isFinite(song.fileSize) ? { fileSize: song.fileSize } : undefined),
    ...(typeof song.lastModified === 'number' && Number.isFinite(song.lastModified) ? { lastModified: song.lastModified } : undefined),
    ...(typeof song.source === 'string' ? { source: song.source } : undefined),
    ...(typeof song.addedAt === 'string' && song.addedAt ? { addedAt: song.addedAt } : undefined),
    ...(typeof song.playCount === 'number' && Number.isFinite(song.playCount) ? { playCount: song.playCount } : undefined),
    ...((typeof song.lastPlayed === 'string' || song.lastPlayed === null) ? { lastPlayed: song.lastPlayed } : undefined),
    ...(typeof song.songmid === 'string' && song.songmid ? { songmid: song.songmid } : undefined),
    ...(typeof song.available === 'boolean' ? { available: song.available } : undefined),
  }));
}

/** Build the authoritative minimal membership records used to seed SQLite. */
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
