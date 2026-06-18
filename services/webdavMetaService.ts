import { Track, MetaJson } from '../types';
import { parseLRCLyrics } from './metadataService';

export function generateMetaJson(track: Track): MetaJson {
  // Parse LRC lyrics into synced format if available
  let syncedLyrics = track.syncedLyrics;
  if (!syncedLyrics && track.lyrics) {
    const parsed = parseLRCLyrics(track.lyrics);
    if (parsed.syncedLyrics) syncedLyrics = parsed.syncedLyrics;
  }

  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    fileSize: track.fileSize ?? 0,
    fileName: track.fileName ?? `${track.artist} - ${track.title}.flac`,
    lastModified: new Date().toISOString(),
    ...(track.lyrics != null && { lyrics: track.lyrics }),
    ...(syncedLyrics != null && { syncedLyrics }),
    ...(track.coverUrl != null && { coverUrl: track.coverUrl }),
  };
}
