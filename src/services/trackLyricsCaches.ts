/**
 * Keeps the local metadata cache in step with user metadata edits.
 */
import type { Track } from '../types';
import { metadataCacheService } from './metadataCacheService';

/**
 * Overwrite cached metadata for an edited local track so cache hydration
 * cannot bring back the previous lyrics.
 */
export async function refreshTrackLyricsCaches(track: Track): Promise<void> {
  if (!track.filePath) return;
  await metadataCacheService.initialize();
  metadataCacheService.set(track.id, {
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    lyrics: track.lyrics ?? '',
    syncedLyrics: track.syncedLyrics,
    wordLyrics: track.wordLyrics,
    wordLyricsFormat: track.wordLyricsFormat,
    fileName: track.fileName ?? '',
    fileSize: track.fileSize ?? 0,
    lastModified: track.lastModified ?? 0,
  });
}
