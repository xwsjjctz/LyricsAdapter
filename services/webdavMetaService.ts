import { Track, MetaJson } from '../types';

export function generateMetaJson(track: Track): MetaJson {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    fileSize: track.fileSize ?? 0,
    fileName: track.fileName ?? `${track.artist} - ${track.title}.flac`,
    lastModified: new Date().toISOString(),
    ...(track.lyrics != null && { lyrics: track.lyrics }),
    ...(track.syncedLyrics != null && { syncedLyrics: track.syncedLyrics }),
    ...(track.coverUrl != null && { coverUrl: track.coverUrl }),
    ...(track.coverUrl != null && { coverHash: hashString(track.coverUrl) }),
  };
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export function metaJsonToTrack(meta: MetaJson, audioPath: string): Track {
  return {
    id: `webdav-${audioPath}`,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    duration: meta.duration,
    audioUrl: '',
    source: 'webdav',
    webdavPath: audioPath,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    ...(meta.lyrics != null && { lyrics: meta.lyrics }),
    ...(meta.syncedLyrics != null && { syncedLyrics: meta.syncedLyrics }),
    ...(meta.coverUrl != null && { coverUrl: meta.coverUrl }),
  };
}
