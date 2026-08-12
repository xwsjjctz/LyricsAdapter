import { Track, type SlotId } from '../types';
import type { LibraryIndexData, LibraryIndexSong, LibrarySettings } from './libraryStorage';
import { sanitizePersistedCoverUrl } from './coverUrl';
import type { UserTrackRecord } from '../domain/library-persistence/models';
import { minimalTrackToPersistedSong } from '../domain/library-persistence/trackRecords';

export type { UserTrackRecord } from '../domain/library-persistence/models';

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
    ...(track.wordLyrics != null ? { wordLyrics: track.wordLyrics } : {}),
    ...(track.wordLyricsFormat != null ? { wordLyricsFormat: track.wordLyricsFormat } : {}),
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
  onlineTracks?: Track[],
  playlistTracks?: Track[]
): LibraryIndexData {
  return {
    songs: tracks.map(serializeTrack),
    ...(cloudTracks && cloudTracks.length > 0 ? { cloudSongs: cloudTracks.map(serializeTrack) } : {}),
    ...(onlineTracks && onlineTracks.length > 0 ? { onlineSongs: onlineTracks.map(serializeTrack) } : {}),
    ...(playlistTracks && playlistTracks.length > 0 ? { playlistSongs: playlistTracks.map(serializeTrack) } : {}),
    settings
  };
}

export function buildLibraryIndexDataForSlots(
  localTracks: Track[],
  cloudTracks: Track[],
  settings: LibrarySettings,
  onlineTracks?: Track[],
  playlistTracks?: Track[]
): LibraryIndexData {
  return buildLibraryIndexData(localTracks, settings, cloudTracks, onlineTracks, playlistTracks);
}

/**
 * 从 Track[] 中提取仅用户不可重建的最小化记录（不含 title/artist/album/duration 等缓存元数据）。
 * 用于写入 ~/.la/users.json —— 缓存可清，但用户数据（"哪些歌在我的库里"）永远保留。
 */
function buildMinimalTrack(track: Track, slotId?: SlotId): UserTrackRecord {
  return {
    id: track.id,
    ...(slotId ? { slotId } : undefined),
    ...(track.filePath ? { filePath: track.filePath } : undefined),
    ...(track.webdavPath ? { webdavPath: track.webdavPath } : undefined),
    ...(track.fileName ? { fileName: track.fileName } : undefined),
    ...(track.fileSize ? { fileSize: track.fileSize } : undefined),
    ...(track.lastModified ? { lastModified: track.lastModified } : undefined),
    ...(track.source ? { source: track.source } : undefined),
    ...(track.addedAt ? { addedAt: track.addedAt } : undefined),
    ...(track.playCount != null ? { playCount: track.playCount } : undefined),
    ...(track.lastPlayed !== undefined ? { lastPlayed: track.lastPlayed } : undefined),
    ...(track.songmid ? { songmid: track.songmid } : undefined),
    ...(track.available !== undefined ? { available: track.available } : undefined),
  };
}

export function buildMinimalTracks(tracks: Track[], slotId?: SlotId): UserTrackRecord[] {
  return tracks.map(track => buildMinimalTrack(track, slotId));
}

/**
 * 将 users.json 中的最小化曲目记录转换为完整的 LibraryIndexSong。
 * title/artist/album/duration 等缓存元数据留空，后续由 metadataCacheService
 * 或文件头重新解析填充。
 */
export function minimalTrackToLibrarySong(t: UserTrackRecord): LibraryIndexSong {
  return minimalTrackToPersistedSong(t, () => new Date().toISOString());
}
